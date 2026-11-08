// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Lower a fixture's use() boundary into explicit setup and teardown frames.
// No test-specific adapter and no execution of source during planning.
use super::*;
use serde_json::{Value as Json, json};

fn bound(n: Node, s: &str, out: &mut BTreeSet<String>) {
    if matches!(
        n.kind(),
        "identifier" | "shorthand_property_identifier_pattern"
    ) {
        out.insert(text(n, s).into());
    } else if n.kind() == "pair_pattern" {
        if let Some(value) = field(n, "value") {
            bound(value, s, out);
        }
    } else {
        for c in children(n) {
            bound(c, s, out);
        }
    }
}
fn locals(n: Node, s: &str, out: &mut BTreeSet<String>) {
    if let Some(parameters) = field(n, "parameters") {
        bound(parameters, s, out);
    }
    if let Some(parameter) = field(n, "parameter") {
        bound(parameter, s, out);
    }
    if matches!(
        n.kind(),
        "variable_declarator" | "function_declaration" | "class_declaration"
    ) && let Some(name) = field(n, "name")
    {
        bound(name, s, out);
    }
    for c in children(n) {
        locals(c, s, out);
    }
}
fn refs(n: Node, s: &str, out: &mut BTreeSet<String>) {
    if n.kind() == "call_expression"
        && [".evaluate", ".evaluateAll", ".waitForFunction"]
            .iter()
            .any(|suffix| crate::function_name(n, s).ends_with(suffix))
    {
        if let Some(function) = field(n, "function") {
            refs(function, s, out);
        }
        if let Some(args) = field(n, "arguments") {
            for (i, arg) in children(args).into_iter().enumerate() {
                if i != 0
                    || !matches!(
                        normalize::untyped(arg).kind(),
                        "arrow_function" | "function_expression"
                    )
                {
                    refs(arg, s, out);
                }
            }
        }
        return;
    }
    if matches!(n.kind(), "identifier" | "shorthand_property_identifier") {
        out.insert(text(n, s).into());
    }
    for c in children(n) {
        refs(c, s, out);
    }
}
fn safe(n: Node, s: &str) -> bool {
    !crate::contains(n, &|c| {
        (c.kind() == "identifier"
            && [
                "process",
                "globalThis",
                "global",
                "require",
                "module",
                "exports",
                "setTimeout",
                "setInterval",
                "queueMicrotask",
                "eval",
                "Function",
                "WeakMap",
                "WeakSet",
                "SharedArrayBuffer",
                "Atomics",
                "WebSocket",
            ]
            .contains(&text(c, s)))
            || (matches!(
                c.kind(),
                "public_field_definition" | "field_definition" | "method_definition"
            ) && (0..c.child_count()).any(|i| c.child(i).is_some_and(|n| n.kind() == "static")))
            || matches!(
                c.kind(),
                "private_property_identifier" | "yield_expression" | "static_block"
            )
            || (c.kind() == "call_expression" && {
                let name = crate::function_name(c, s);
                [
                    ".on",
                    ".once",
                    ".route",
                    ".routeWebSocket",
                    ".addInitScript",
                    ".evaluateHandle",
                    ".waitForEvent",
                    ".newPage",
                    ".newContext",
                    ".connect",
                ]
                .iter()
                .any(|suffix| name.ends_with(suffix))
            })
    })
}

fn use_boundary<'a>(statement: Node<'a>, s: &str, name: &str) -> Option<(Node<'a>, Vec<Node<'a>>)> {
    if statement.kind() == "try_statement" {
        if field(statement, "handler").is_some() {
            return None;
        }
        let body = children(field(statement, "body")?);
        if body.len() != 1 {
            return None;
        }
        let (value, extra) = use_boundary(body[0], s, name)?;
        if !extra.is_empty() {
            return None;
        }
        if !matches!(
            value.kind(),
            "identifier" | "null" | "true" | "false" | "string" | "number"
        ) {
            return None;
        }
        let finally = field(statement, "finalizer")?;
        return Some((value, children(field(finally, "body")?)));
    }
    if statement.kind() != "expression_statement" {
        return None;
    }
    let expression = statement.named_child(0)?;
    if expression.kind() != "await_expression" {
        return None;
    }
    let call = expression.named_child(0)?;
    if crate::function_name(call, s) != name {
        return None;
    }
    let args = children(field(call, "arguments")?);
    (args.len() == 1).then(|| (args[0], vec![]))
}

struct Builder<'a> {
    project: &'a Project,
    functions: BTreeMap<String, Json>,
    active: BTreeSet<String>,
}
impl Builder<'_> {
    fn function(&mut self, r: &Reference) -> Option<String> {
        let key = hash(format!("{}:{}:{}", r.file, r.start, r.end));
        if self.functions.contains_key(&key) {
            return Some(key);
        }
        if !self.active.insert(key.clone()) || self.active.len() > points::CALL_LIMIT {
            return None;
        }
        let n = self.project.node(r)?;
        let source = &self.project.modules[&r.file].source;
        if !safe(n, source) {
            return None;
        }
        let mut declared = BTreeSet::new();
        locals(n, source, &mut declared);
        let mut references = BTreeSet::new();
        refs(n, source, &mut references);
        let mut bindings = BTreeMap::new();
        for name in references.difference(&declared) {
            let value = self
                .project
                .value(&r.file, name, &Env::new(), &mut Context::default());
            let binding = match value {
                Value::Function(target, _) | Value::Class(target) => {
                    json!({"ref":self.function(&target)?})
                }
                Value::Expect => json!({"builtin":"expect"}),
                Value::Undefined => json!({"builtin":"undefined"}),
                Value::Builtin(ref name)
                    if [
                        "Object",
                        "Array",
                        "JSON",
                        "Number",
                        "String",
                        "Boolean",
                        "RegExp",
                        "URL",
                        "Error",
                        "TypeError",
                        "Map",
                        "Set",
                        "Promise",
                        "parseInt",
                        "parseFloat",
                        "Date",
                        "Math",
                    ]
                    .contains(&name.as_str()) =>
                {
                    continue;
                }
                value => {
                    if self
                        .project
                        .symbol(&r.file, name, 0)
                        .is_some_and(|r| self.project.mutable_binding(&r))
                    {
                        return None;
                    }
                    let value = value.json()?;
                    // Shared mutable module objects require their own frame.
                    // Keep them native until that boundary is modeled too.
                    if value.is_object() || value.is_array() {
                        return None;
                    }
                    json!({"value":value})
                }
            };
            bindings.insert(name.clone(), binding);
        }
        self.functions.insert(
            key.clone(),
            json!({"code":text(n,source),"bindings":bindings}),
        );
        self.active.remove(&key);
        Some(key)
    }
    fn fixture(
        &mut self,
        name: &str,
        definitions: &BTreeMap<String, Fixture>,
        done: &mut BTreeSet<String>,
        visiting: &mut BTreeSet<String>,
        frames: &mut Vec<Json>,
    ) -> Option<()> {
        if done.contains(name) {
            return Some(());
        }
        let Some(fixture) = definitions.get(name) else {
            return ["page", "context", "request", "baseURL"]
                .contains(&name)
                .then_some(());
        };
        if fixture.worker
            || [
                "page",
                "context",
                "request",
                "browser",
                "storageState",
                "baseURL",
            ]
            .contains(&name)
            || !visiting.insert(name.into())
        {
            return None;
        }
        let r = &fixture.reference;
        let node = self.project.node(r)?;
        let s = &self.project.modules[&r.file].source;
        if !matches!(node.kind(), "arrow_function" | "function_expression") {
            let value = self
                .project
                .eval(&r.file, node, &mut Env::new(), &mut Context::default())
                .value
                .json()?;
            frames.push(json!({"name":name,"value":value}));
        } else {
            let parameters = params(node);
            if parameters.len() != 2
                || pattern(parameters[0]).kind() != "object_pattern"
                || pattern(parameters[1]).kind() != "identifier"
            {
                return None;
            }
            let deps = names(parameters[0], s);
            for dep in &deps {
                self.fixture(dep, definitions, done, visiting, frames)?;
            }
            let body = field(node, "body")?;
            if body.kind() != "statement_block" {
                return None;
            }
            let statements = children(body);
            let use_name = text(pattern(parameters[1]), s);
            let mut boundary = None;
            for (index, statement) in statements.iter().enumerate() {
                if let Some((value, finally)) = use_boundary(*statement, s, use_name) {
                    if boundary.is_some() {
                        return None;
                    }
                    boundary = Some((index, value, finally));
                }
            }
            let (index, value, mut teardown) = boundary?;
            teardown.extend_from_slice(&statements[index + 1..]);
            let mut retained = BTreeSet::new();
            for statement in &statements[..index] {
                if matches!(
                    statement.kind(),
                    "lexical_declaration" | "variable_declaration"
                ) {
                    for declaration in children(*statement) {
                        let name = field(declaration, "name")?;
                        if name.kind() != "identifier" {
                            return None;
                        }
                        retained.insert(text(name, s).to_string());
                    }
                }
                if crate::contains(*statement, &|n| n.kind() == "return_statement") {
                    return None;
                }
            }
            // A use() call nested in control flow or another callback cannot be
            // reconstructed by these straight-line continuation frames.
            let count = statements
                .iter()
                .filter(|n| {
                    crate::contains(**n, &|n| n.kind() == "identifier" && text(n, s) == use_name)
                })
                .count();
            if count != 1 {
                return None;
            }
            let key = self.function(r)?;
            let mut teardown_references = BTreeSet::new();
            for statement in &teardown {
                refs(*statement, s, &mut teardown_references);
            }
            retained.retain(|name| teardown_references.contains(name));
            frames.push(json!({"name":name,"function":key,"dependencies":deps,"parameters":text(parameters[0],s),
                "setup":statements[..index].iter().map(|n|text(*n,s)).collect::<Vec<_>>().join("\n"),
                "valueExpression":text(value,s),"locals":retained,
                "teardown":teardown.iter().map(|n|text(*n,s)).collect::<Vec<_>>().join("\n")}));
        }
        visiting.remove(name);
        done.insert(name.into());
        Some(())
    }
}
impl Project {
    fn restoration_module_safe(&self, file: &str, seen: &mut BTreeSet<String>) -> Option<()> {
        if !seen.insert(file.into()) {
            return Some(());
        }
        if seen.len() > points::CALL_LIMIT {
            return None;
        }
        let module = self.modules.get(file)?;
        let s = &module.source;
        for node in children(module.tree.root_node()) {
            let node = field(node, "declaration").unwrap_or(node);
            match node.kind() {
                "import_statement" => {
                    let name = field(node, "source").and_then(|n| normalize::string(n, s))?;
                    if name != "@playwright/test" {
                        self.restoration_module_safe(&self.resolve(file, &name)?, seen)?;
                    }
                }
                "function_declaration"
                | "class_declaration"
                | "interface_declaration"
                | "type_alias_declaration" => {}
                "lexical_declaration" => {
                    for declaration in children(node) {
                        let value = field(declaration, "value")?;
                        if matches!(value.kind(), "arrow_function" | "function_expression") {
                            continue;
                        }
                        if self
                            .provider_node(file, value, &mut BTreeSet::new())
                            .is_some()
                        {
                            continue;
                        }
                        if crate::contains(value, &|n| {
                            matches!(
                                n.kind(),
                                "call_expression" | "new_expression" | "await_expression"
                            )
                        }) {
                            return None;
                        }
                        self.eval(file, value, &mut Env::new(), &mut Context::default())
                            .value
                            .json()?;
                    }
                }
                "expression_statement" => {
                    fn registration(
                        n: Node,
                        s: &str,
                        aliases: &BTreeMap<String, String>,
                    ) -> Option<()> {
                        let call = crate::call(n)?;
                        let name = crate::function_name(call, s);
                        if aliases.contains_key(&name) {
                            return Some(());
                        }
                        let base = name.strip_suffix(".describe")?;
                        if !aliases.contains_key(base) {
                            return None;
                        }
                        let body = field(crate::callback(call)?, "body")?;
                        for statement in children(body) {
                            registration(statement, s, aliases)?;
                        }
                        Some(())
                    }
                    registration(node, s, &self.test_aliases(file))?;
                }
                _ => return None,
            }
        }
        Some(())
    }
    pub(crate) fn restoration(&self, test: &Test) -> std::result::Result<Json, &'static str> {
        self.restoration_recipe(test)
            .ok_or("Fixture lifecycle requires native execution")
    }
    fn restoration_recipe(&self, test: &Test) -> Option<Json> {
        self.restoration_module_safe(&test.file, &mut BTreeSet::new())?;
        if test.fixture == "@playwright/test:test"
            || test.steps.iter().any(|s| s.kind != "statement")
        {
            return None;
        }
        if test.reasons.iter().any(|r| {
            ![
                "Project imports or custom fixtures require an execution adapter",
                "Fixture parameters beyond { page } require an execution adapter",
                "Custom fixture lifecycle is not equivalent to a bare page",
                "Module/suite setup or dynamic registration requires an execution adapter",
            ]
            .contains(&r.as_str())
        }) {
            return None;
        }
        let alias = self
            .test_aliases(&test.file)
            .into_iter()
            .find(|(_, v)| v == &test.fixture)?
            .0;
        let definitions = self.provider(&test.file, &alias, &mut BTreeSet::new())?;
        if definitions.is_empty() {
            return None;
        }
        let r = Reference {
            file: test.file.clone(),
            start: test.callback_start,
            end: test.callback_end,
        };
        let node = self.node(&r)?;
        let parameters = params(node);
        if parameters.len() != 1 || pattern(parameters[0]).kind() != "object_pattern" {
            return None;
        }
        let mut builder = Builder {
            project: self,
            functions: BTreeMap::new(),
            active: BTreeSet::new(),
        };
        // Playwright sets up automatic fixtures in registration order, then
        // requested fixtures in parameter order, visiting dependencies first.
        let mut automatic: Vec<_> = definitions.iter().filter(|(_, f)| f.auto).collect();
        automatic.sort_by_key(|(_, f)| f.order);
        let targets = automatic
            .into_iter()
            .map(|(name, _)| name.clone())
            .chain(names(parameters[0], &self.modules[&test.file].source));
        let mut frames = vec![];
        let mut done = BTreeSet::new();
        for target in targets {
            builder.fixture(
                &target,
                &definitions,
                &mut done,
                &mut BTreeSet::new(),
                &mut frames,
            )?;
        }
        if frames.is_empty() {
            return None;
        }
        let callback = builder.function(&r)?;
        Some(
            json!({"version":1,"fixtures":frames,"functions":builder.functions,"callback":callback}),
        )
    }
}
