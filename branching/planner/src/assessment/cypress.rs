// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

use super::*;

impl Project {
    fn node_tasks(&self, ctx: &mut Context) -> Env {
        let configurations: Vec<_> = self
            .modules
            .keys()
            .filter(|file| {
                let name = std::path::Path::new(file)
                    .file_name()
                    .unwrap()
                    .to_string_lossy();
                name.starts_with("cypress.config.")
                    && !file.split('/').any(|part| part == "node_modules")
            })
            .collect();
        if configurations.len() != 1 {
            return Env::new();
        }
        let file = configurations[0];
        let module = &self.modules[file];
        let mut nodes = vec![module.tree.root_node()];
        let mut tasks = Env::new();
        while let Some(node) = nodes.pop() {
            if node.kind() == "method_definition"
                && field(node, "name")
                    .is_some_and(|name| text(name, &module.source) == "setupNodeEvents")
            {
                let Some(on) = params(node)
                    .first()
                    .map(|parameter| text(pattern(*parameter), &module.source))
                else {
                    continue;
                };
                let Some(body) = field(node, "body") else {
                    continue;
                };
                let mut pending = vec![body];
                while let Some(call) = pending.pop() {
                    if matches!(
                        call.kind(),
                        "arrow_function"
                            | "function_expression"
                            | "function_declaration"
                            | "method_definition"
                    ) {
                        continue;
                    }
                    if call.kind() == "call_expression"
                        && field(call, "function")
                            .is_some_and(|target| text(target, &module.source) == on)
                    {
                        let arguments = field(call, "arguments").map(children).unwrap_or_default();
                        if arguments
                            .first()
                            .and_then(|arg| normalize::string(*arg, &module.source))
                            .as_deref()
                            == Some("task")
                        {
                            if let Some(argument) = arguments.get(1) {
                                if argument.kind() == "object" {
                                    for entry in children(*argument) {
                                        if entry.kind() == "method_definition" {
                                            if let Some(name) = field(entry, "name") {
                                                tasks.insert(
                                                    normalize::string(name, &module.source)
                                                        .unwrap_or_else(|| {
                                                            text(name, &module.source).into()
                                                        }),
                                                    Value::Function(
                                                        self.reference(file, entry),
                                                        Box::new(Env::new()),
                                                    ),
                                                );
                                            }
                                        } else if entry.kind() == "pair" {
                                            if let (Some(key), Some(value)) =
                                                (field(entry, "key"), field(entry, "value"))
                                            {
                                                tasks.insert(
                                                    normalize::string(key, &module.source)
                                                        .unwrap_or_else(|| {
                                                            text(key, &module.source).into()
                                                        }),
                                                    self.eval(file, value, &mut Env::new(), ctx)
                                                        .value,
                                                );
                                            }
                                        } else if entry.kind() == "spread_element" {
                                            if let Value::Object(fields) =
                                                self.eval(file, entry, &mut Env::new(), ctx).value
                                            {
                                                tasks.extend(fields);
                                            } else {
                                                tasks.clear();
                                            }
                                        }
                                    }
                                } else if let Value::Object(fields) =
                                    self.eval(file, *argument, &mut Env::new(), ctx).value
                                {
                                    tasks.extend(fields);
                                }
                            }
                        }
                    }
                    let mut children = children(call);
                    children.reverse();
                    pending.extend(children);
                }
                continue;
            }
            nodes.extend(children(node));
        }
        tasks
    }
    fn cypress_task(&self, args: &[Value], ctx: &mut Context) -> Eval {
        if ctx.node_tasks.is_none() {
            // Mark initialization before evaluating factories, which may recurse.
            ctx.node_tasks = Some(Env::new());
            ctx.node_tasks = Some(self.node_tasks(ctx));
        }
        if let Some(Value::String(name)) = args.first()
            && let Some(Value::Function(reference, closure)) = ctx
                .node_tasks
                .as_ref()
                .and_then(|tasks| tasks.get(name))
                .cloned()
        {
            let browser_context = ctx.cypress;
            ctx.cypress = false;
            let result = self.invoke(
                &reference,
                &closure,
                vec![args.get(1).cloned().unwrap_or(Value::Null)],
                None,
                ctx,
            );
            ctx.cypress = browser_context;
            return result;
        }
        Eval::cost(Estimate::unknown(
            "Unresolved Cypress task registration or runtime task name",
        ))
    }
    pub(super) fn cypress_call(
        &self,
        target: &str,
        method: &str,
        args: &[Value],
        ctx: &mut Context,
    ) -> Eval {
        if target == "Cypress" {
            return match method {
                "env" | "expose" | "config" => Eval::value(Value::Data),
                "$" => Eval::value(Value::Dom),
                _ => Eval::cost(Estimate::unknown(format!(
                    "Unsupported Cypress API: {method}"
                ))),
            };
        }
        self.cypress_chain_call(&Value::Undefined, method, args, ctx)
    }
    pub(super) fn cypress_chain_call(
        &self,
        subject: &Value,
        method: &str,
        args: &[Value],
        ctx: &mut Context,
    ) -> Eval {
        let mut cost = match method {
            "visit" | "reload" | "go" => Estimate::operation("navigation", points::NAVIGATION),
            "click"
            | "dblclick"
            | "rightclick"
            | "type"
            | "clear"
            | "check"
            | "uncheck"
            | "select"
            | "focus"
            | "blur"
            | "scrollIntoView"
            | "scrollTo"
            | "trigger"
            | "setCookie"
            | "clearCookie"
            | "clearCookies"
            | "clearAllCookies"
            | "clearLocalStorage"
            | "clearAllLocalStorage"
            | "clearAllSessionStorage" => Estimate::operation("interaction", points::INTERACTION),
            "should" | "and" => Estimate::operation("assertion", points::ASSERTION),
            "request" => {
                let payload = if matches!(args.first(), Some(Value::Object(_))) {
                    vec![Value::Undefined, args[0].clone()]
                } else if args.len() >= 3 {
                    vec![Value::Undefined, args[2].clone()]
                } else {
                    vec![Value::Undefined, Value::Undefined]
                };
                runtime::request_cost(&payload)
            }
            "wait" => match args.first() {
                Some(Value::Number(ms)) if *ms >= 0 => Estimate::operation(
                    "explicit-wait",
                    (*ms as f64 / crate::baseline::PLAYWRIGHT_BRANCHING.unit_ms).ceil() as u64,
                ),
                _ => Estimate::operation("wait", points::WAIT)
                    .uncertain("Network wait duration depends on the response"),
            },
            "task" => self.cypress_task(args, ctx).cost,
            "exec" => {
                self.platform_call("child_process.exec", args, ctx)
                    .unwrap()
                    .cost
            }
            "fixture" | "readFile" | "writeFile" => {
                Estimate::operation("local-io", points::LOCAL_IO)
            }
            "get"
            | "contains"
            | "find"
            | "filter"
            | "first"
            | "last"
            | "eq"
            | "children"
            | "parent"
            | "parents"
            | "closest"
            | "next"
            | "prev"
            | "root"
            | "url"
            | "location"
            | "title"
            | "its"
            | "wrap"
            | "then"
            | "each"
            | "within"
            | "window"
            | "document"
            | "getCookie"
            | "getCookies"
            | "getAllCookies"
            | "getAllLocalStorage"
            | "getAllSessionStorage"
            | "as"
            | "log"
            | "intercept"
            | "env"
            | "invoke" => Estimate::default(),
            _ => Estimate::unknown(format!("Unsupported Cypress command: {method}")),
        };
        let mut value = match method {
            "get" | "contains" | "find" | "filter" | "first" | "last" | "eq" | "children"
            | "parent" | "parents" | "closest" | "next" | "prev" | "root" | "document"
            | "window" => Value::Dom,
            "url" | "title" => Value::Text,
            "wrap" => args.first().cloned().unwrap_or(Value::Undefined),
            "request"
            | "wait"
            | "task"
            | "exec"
            | "fixture"
            | "readFile"
            | "location"
            | "getCookie"
            | "getCookies"
            | "getAllCookies"
            | "getAllLocalStorage"
            | "getAllSessionStorage"
            | "env" => Value::Data,
            "its" => {
                let mut value = subject.clone();
                if let Some(Value::String(path)) = args.first() {
                    for key in path.split('.') {
                        value = self.property(value, key, ctx).value;
                    }
                    value
                } else {
                    Value::Data
                }
            }
            _ => subject.clone(),
        };
        if method == "invoke" {
            if let Some(Value::String(name)) = args.first() {
                if let Some(result) = self.value_call(&mut value, name, &args[1..], ctx) {
                    cost.add(result.cost);
                    value = result.value;
                } else {
                    cost.add(Estimate::unknown(format!(
                        "Unresolved Cypress subject method: {name}"
                    )));
                    value = Value::Unknown;
                }
            } else {
                cost.add(Estimate::unknown(
                    "Cypress invoke method depends on runtime data",
                ));
            }
        }
        // Cypress queues callbacks serially. Preserve their yielded subjects so
        // DOM queries, response reads and helper returns retain their types.
        if !ctx.return_probe && ["then", "each", "within", "should", "and"].contains(&method) {
            if let Some(Value::Function(reference, closure)) = args.last() {
                if method == "each" {
                    let (items, exact) = match subject {
                        Value::Array(items) => (items.clone(), true),
                        Value::Sequence(item) => (vec![*item.clone()], false),
                        Value::Dom => (vec![Value::Dom], false),
                        _ => (vec![Value::Data], false),
                    };
                    for (index, item) in items.into_iter().enumerate() {
                        let result = self.invoke(
                            reference,
                            closure,
                            vec![item, Value::Number(index as i64), subject.clone()],
                            None,
                            ctx,
                        );
                        cost.add(if exact {
                            result.cost
                        } else {
                            result.cost.unknown_repetitions()
                        });
                    }
                } else {
                    let result = self.invoke(reference, closure, vec![subject.clone()], None, ctx);
                    cost.add(result.cost);
                    if method == "then" {
                        value = match result.value {
                            Value::CypressChain(subject) => *subject,
                            Value::Undefined | Value::Null => subject.clone(),
                            value => value,
                        };
                    }
                }
            }
        }
        Eval {
            value: Value::CypressChain(Box::new(value)),
            cost,
            ..Eval::default()
        }
    }
    pub(super) fn dom_call(&self, method: &str, args: &[Value], ctx: &mut Context) -> Option<Eval> {
        if [
            "setTimeout",
            "setInterval",
            "queueMicrotask",
            "clearTimeout",
            "clearInterval",
        ]
        .contains(&method)
        {
            return self.platform_call(method, args, ctx);
        }
        if matches!(method, "require" | "requirejs") {
            let Some(Value::Array(modules)) = args.first() else {
                return None;
            };
            if !modules
                .iter()
                .all(|module| matches!(module, Value::String(_)))
            {
                return None;
            }
            let mut cost = Estimate::operation(
                "browser-module-load",
                points::REQUEST.saturating_mul(modules.len() as u64),
            )
            .uncertain("Browser module loading and initialization require runtime measurement");
            if let Some(Value::Function(reference, closure)) = args.get(1) {
                cost.add(
                    self.invoke(
                        reference,
                        closure,
                        vec![Value::Data; modules.len()],
                        None,
                        ctx,
                    )
                    .cost,
                );
            }
            if let Some(Value::Function(reference, closure)) = args.get(2) {
                cost.add(
                    self.invoke(reference, closure, vec![Value::Data], None, ctx)
                        .cost
                        .optional("Module loading failure callback is conditional"),
                );
            }
            return Some(Eval::cost(cost));
        }
        let value = match method {
            "find" | "filter" | "first" | "last" | "eq" | "children" | "parent" | "parents"
            | "closest" | "next" | "prev" | "siblings" | "not" | "add" | "clone" => Value::Dom,
            "createElement" | "querySelector" | "querySelectorAll" | "getElementById"
            | "appendChild" | "removeChild" => Value::Dom,
            "dispatchEvent" | "setAttribute" | "removeAttribute" => Value::Data,
            "is" | "hasClass" | "css" | "attr" | "prop" | "data" | "val" | "text" | "html"
            | "width" | "height" | "get" | "toArray" => Value::Data,
            "each" | "map" => {
                if let Some(Value::Function(reference, closure)) = args.first() {
                    let mut result = self.invoke(
                        reference,
                        closure,
                        vec![Value::Data, Value::Dom],
                        Some(Value::Dom),
                        ctx,
                    );
                    result.cost = result.cost.unknown_repetitions();
                    result.value = Value::Dom;
                    return Some(result);
                }
                return None;
            }
            _ => return None,
        };
        Some(Eval::value(value))
    }
    pub(super) fn chai_call(&self, method: &str) -> Option<Eval> {
        if [
            "a",
            "an",
            "equal",
            "equals",
            "eq",
            "eql",
            "eqls",
            "include",
            "includes",
            "contain",
            "contains",
            "property",
            "ownProperty",
            "length",
            "lengthOf",
            "match",
            "matches",
            "greaterThan",
            "gt",
            "above",
            "least",
            "gte",
            "lessThan",
            "lt",
            "below",
            "most",
            "lte",
            "within",
            "closeTo",
            "approximately",
            "members",
            "keys",
            "oneOf",
            "instanceOf",
            "throw",
            "throws",
            "satisfy",
            "attr",
            "class",
            "css",
            "id",
            "text",
            "html",
            "value",
            "data",
            "descendants",
        ]
        .contains(&method)
        {
            Some(Eval::value(Value::Chai))
        } else {
            None
        }
    }
}
