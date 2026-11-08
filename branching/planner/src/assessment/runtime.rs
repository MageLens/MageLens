// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Abstract values for platform primitives. These operations never execute test
// code, read environment values, open fixture files, or contact a browser.
use super::*;
impl Project {
    pub(super) fn property(&self, value: Value, key: &str, ctx: &mut Context) -> Eval {
        match value {
            Value::DataLibrary(file) => Eval::value(Value::DataLibrary(file)),
            Value::MissingDependency(module) => Eval::value(Value::MissingDependency(module)),
            Value::Object(v) => Eval::value(v.get(key).cloned().unwrap_or(Value::Undefined)),
            Value::Sequence(_) if key == "length" => Eval::value(Value::Data),
            Value::Class(class) => {
                if let Some(body) = self.node(&class).and_then(|n| field(n, "body")) {
                    let source = &self.modules[&class.file].source;
                    if let Some(member) = children(body).into_iter().find(|n| {
                        n.kind() == "public_field_definition"
                            && field(*n, "name").is_some_and(|n| text(n, source) == key)
                            && text(*n, source).split_whitespace().any(|v| v == "static")
                    }) && let Some(value) = field(member, "value")
                    {
                        let value = self
                            .eval(&class.file, value, &mut Env::new(), ctx)
                            .value
                            .widen();
                        return Eval::value(value);
                    }
                }
                Eval::value(Value::Unknown)
            }
            Value::RetryAssertion(r, closure) if key == "not" => {
                Eval::value(Value::RetryAssertion(r, closure))
            }
            Value::Array(v) if key == "length" => Eval::value(Value::Number(v.len() as i64)),
            Value::String(v) if key == "length" => {
                Eval::value(Value::Number(v.encode_utf16().count() as i64))
            }
            Value::Sequence(_) | Value::Data | Value::Text | Value::Response | Value::TestInfo => {
                Eval::value(Value::Data)
            }
            Value::Builtin(name) if name == "URL.instance" => {
                Eval::value(if key == "searchParams" {
                    Value::Builtin("URLSearchParams".into())
                } else {
                    Value::Text
                })
            }
            Value::Builtin(name) => Eval::value(if name == "process.env" {
                Value::Data
            } else {
                Value::Builtin(format!("{name}.{key}"))
            }),
            Value::Browser if key == "request" => Eval::value(Value::Request),
            Value::Assertion(browser) if key == "not" => Eval::value(Value::Assertion(browser)),
            Value::Map(v) if key == "size" => Eval::value(
                v.map(|v| Value::Number(v.len() as i64))
                    .unwrap_or(Value::Data),
            ),
            Value::Set(v) if key == "size" => Eval::value(
                v.map(|v| Value::Number(v.len() as i64))
                    .unwrap_or(Value::Data),
            ),
            Value::Namespace(file) => Eval::value(self.value(&file, key, &Env::new(), ctx)),
            Value::Instance(class, fields) => {
                if let Some(value) = fields.get(key) {
                    return Eval::value(value.clone());
                }
                if let Some(method) = self.class_method(&class, key, 0) {
                    let n = self.node(&method).unwrap();
                    let s = &self.modules[&method.file].source;
                    if text(n, s).trim_start().starts_with("get ") {
                        return self.invoke(
                            &method,
                            &Env::new(),
                            vec![],
                            Some(Value::Instance(class, fields)),
                            ctx,
                        );
                    }
                }
                Eval::value(Value::Unknown)
            }
            _ => Eval::value(Value::Unknown),
        }
    }
    pub(super) fn platform_call(
        &self,
        target: &str,
        args: &[Value],
        ctx: &mut Context,
    ) -> Option<Eval> {
        let value = match target {
            "String" => args
                .first()
                .map(|v| match v {
                    Value::String(v) => Value::String(v.clone()),
                    Value::Number(v) => Value::String(v.to_string()),
                    Value::Bool(v) => Value::String(v.to_string()),
                    _ => Value::Text,
                })
                .unwrap_or(Value::String(String::new())),
            "parseInt" | "parseFloat" | "Date.now" => Value::Data,
            "Number" => args
                .first()
                .map(|v| match v {
                    Value::Number(v) => Value::Number(*v),
                    Value::String(v) => v.parse().map(Value::Number).unwrap_or(Value::Data),
                    _ => Value::Data,
                })
                .unwrap_or(Value::Number(0)),
            "Boolean" => args
                .first()
                .and_then(Value::truth)
                .map(Value::Bool)
                .unwrap_or(Value::Data),
            "JSON.parse" => match args.first() {
                Some(Value::String(s)) => serde_json::from_str(s)
                    .ok()
                    .map(|v| Value::from_json(&v))
                    .unwrap_or(Value::Data),
                _ => Value::Data,
            },
            "JSON.stringify" => args
                .first()
                .and_then(Value::json)
                .map(|v| Value::String(v.to_string()))
                .unwrap_or(Value::Text),
            "Object.entries" | "Object.keys" | "Object.values" => {
                if let Some(Value::Object(items)) = args.first() {
                    Value::Array(
                        items
                            .iter()
                            .map(|(k, v)| match target {
                                "Object.entries" => {
                                    Value::Array(vec![Value::String(k.clone()), v.clone()])
                                }
                                "Object.keys" => Value::String(k.clone()),
                                _ => v.clone(),
                            })
                            .collect(),
                    )
                } else {
                    Value::Sequence(Box::new(if target == "Object.entries" {
                        Value::Array(vec![Value::Text, Value::Data])
                    } else {
                        Value::Data
                    }))
                }
            }
            "Object.assign" => {
                if let Some(Value::DataLibrary(file)) = args.first()
                    && args[1..].iter().any(|v| !v.data_only())
                {
                    ctx.tainted_libraries.extend(self.dependency_closure(file));
                }
                let mut object = Env::new();
                for arg in args {
                    if let Value::Object(fields) = arg {
                        object.extend(fields.clone());
                    } else {
                        return Some(Eval::value(Value::Data));
                    }
                }
                Value::Object(object)
            }
            "Array.isArray" => match args.first() {
                Some(Value::Array(_) | Value::Sequence(_)) => Value::Bool(true),
                Some(
                    Value::Object(_)
                    | Value::String(_)
                    | Value::Number(_)
                    | Value::Bool(_)
                    | Value::Null
                    | Value::Undefined,
                ) => Value::Bool(false),
                _ => Value::Data,
            },
            "Object.prototype.hasOwnProperty.call" | "Number.isFinite" | "Number.isNaN" => {
                Value::Data
            }
            "Promise" => {
                let mut result = if let Some(Value::Function(r, closure)) = args.first() {
                    self.invoke(
                        r,
                        closure,
                        vec![
                            Value::Builtin("Promise.resolve".into()),
                            Value::Builtin("Promise.reject".into()),
                        ],
                        None,
                        ctx,
                    )
                } else {
                    Eval::cost(Estimate::unknown("Unresolved Promise executor"))
                };
                result.value = Value::Promise(Box::new(Value::Data));
                return Some(result);
            }
            "setTimeout" | "setInterval" | "queueMicrotask" => {
                let mut result = if let Some(Value::Function(r, closure)) = args.first() {
                    self.invoke(
                        r,
                        closure,
                        args.iter().skip(2).cloned().collect(),
                        None,
                        ctx,
                    )
                } else {
                    Eval::cost(Estimate::unknown("Unresolved scheduled callback"))
                };
                if result.cost.upper_bound_points != Some(0) {
                    result.cost = result
                        .cost
                        .uncertain("Scheduled callback may overlap other work");
                }
                result.value = Value::Data;
                return Some(result);
            }
            "clearTimeout" | "clearInterval" => Value::Undefined,
            "assert"
            | "assert/strict"
            | "assert.ok"
            | "assert.equal"
            | "assert.strictEqual"
            | "assert.deepEqual"
            | "assert.deepStrictEqual" => {
                return Some(Eval {
                    value: Value::Undefined,
                    cost: Estimate::operation("assertion", points::ASSERTION),
                    ..Eval::default()
                });
            }
            "Promise.allSettled" => Value::Promise(Box::new(match args.first() {
                Some(Value::Array(values)) => {
                    Value::Array(values.iter().map(|_| Value::settled()).collect())
                }
                _ => Value::Sequence(Box::new(Value::settled())),
            })),
            "Promise.all" => Value::Promise(Box::new(match args.first() {
                Some(Value::Array(values)) => {
                    Value::Array(values.iter().cloned().map(Value::resolved).collect())
                }
                Some(Value::Sequence(value)) => {
                    Value::Sequence(Box::new(value.as_ref().clone().resolved()))
                }
                _ => Value::Sequence(Box::new(Value::Data)),
            })),
            "Promise.race" | "Promise.any" => Value::Promise(Box::new(Value::Data)),
            "Promise.reject" | "Promise.resolve" => {
                Value::Promise(Box::new(args.first().cloned().unwrap_or(Value::Undefined)))
            }
            "Date" => Value::Builtin("Date.instance".into()),
            "Date.instance.getTime"
            | "Date.instance.valueOf"
            | "Date.instance.getDate"
            | "Date.instance.getMonth"
            | "Date.instance.getFullYear"
            | "Date.instance.getHours"
            | "Date.instance.getMinutes"
            | "Date.instance.getSeconds"
            | "Date.instance.getMilliseconds"
            | "Date.instance.getDay"
            | "Date.instance.getUTCDate"
            | "Date.instance.getUTCMonth"
            | "Date.instance.getUTCFullYear" => Value::Data,
            "Date.instance.toISOString"
            | "Date.instance.toJSON"
            | "Date.instance.toString"
            | "Date.instance.toUTCString"
            | "Date.instance.toDateString" => Value::Text,
            "RegExp" => Value::Builtin("RegExp.instance".into()),
            "URL" => Value::Builtin("URL.instance".into()),
            "URL.instance.toString" | "URL.instance.toJSON" => Value::Text,
            "Error" | "TypeError" => Value::Object(Env::from([("message".into(), Value::Text)])),
            "Map" | "WeakMap" => Value::Map(Some(vec![])),
            "Set" | "WeakSet" => Value::Set(match args.first() {
                Some(Value::Array(v)) => Some(v.clone()),
                None => Some(vec![]),
                _ => None,
            }),
            "console.log" | "console.warn" | "console.error" | "console.info" | "console.debug"
            | "console.table" => Value::Undefined,
            "path.join" | "path.resolve" | "path.dirname" | "path.basename" | "path.extname"
            | "path.relative" | "path.normalize" | "os.tmpdir" | "os.homedir" => Value::Text,
            _ if target.starts_with("fs.") || target.starts_with("fs/promises.") => {
                let method = target.rsplit('.').next().unwrap_or("");
                let value = match method {
                    "existsSync" => Value::Data,
                    "readFileSync" | "readFile" | "mkdtempSync" | "mkdtemp" => Value::Text,
                    "mkdirSync" | "mkdir" | "writeFileSync" | "writeFile" | "unlinkSync"
                    | "rmSync" | "appendFileSync" => Value::Undefined,
                    "readdirSync" | "readdir" => Value::Sequence(Box::new(Value::Text)),
                    "statSync" | "stat" => Value::Data,
                    _ => return None,
                };
                return Some(Eval {
                    value: if method.ends_with("Sync") {
                        value
                    } else {
                        Value::Promise(Box::new(value))
                    },
                    cost: Estimate::operation("local-io", points::LOCAL_IO),
                    ..Eval::default()
                });
            }
            _ if target.starts_with("Math.") => Value::Data,
            _ => return None,
        };
        let _ = ctx;
        Some(Eval::value(value))
    }
    pub(super) fn value_call(
        &self,
        receiver: &mut Value,
        method: &str,
        args: &[Value],
        ctx: &mut Context,
    ) -> Option<Eval> {
        match receiver {
            Value::DataLibrary(file) => {
                if self
                    .dependency_closure(file)
                    .iter()
                    .any(|file| ctx.tainted_libraries.contains(file))
                {
                    return Some(Eval::cost(Estimate::unknown(
                        "Library state contains injected runtime capabilities",
                    )));
                }
                let targets = self.data_method_targets(file, method);
                if targets.is_empty() {
                    return None;
                }
                let asynchronous = targets
                    .iter()
                    .any(|r| self.node(r).is_some_and(function_async));
                let value = if asynchronous {
                    Value::Promise(Box::new(Value::Data))
                } else {
                    Value::Data
                };
                if args.iter().all(Value::data_only) {
                    return Some(Eval::value(value));
                }
                let mut cost = None;
                for target in targets {
                    let evaluated = self.invoke(
                        &target,
                        &Env::new(),
                        args.to_vec(),
                        Some(Value::DataLibrary(file.clone())),
                        ctx,
                    );
                    cost = Some(if let Some(prior) = cost {
                        Estimate::choice(
                            prior,
                            evaluated.cost,
                            "Library method dispatch depends on runtime data",
                        )
                    } else {
                        evaluated.cost
                    });
                }
                return Some(Eval {
                    value,
                    cost: cost.unwrap(),
                    ..Eval::default()
                });
            }
            Value::Expect if method == "soft" => {
                return Some(Eval::value(Value::Assertion(
                    args.first().is_some_and(|v| matches!(v, Value::Browser)),
                )));
            }
            Value::Expect if method == "configure" => return Some(Eval::value(Value::Expect)),
            Value::Expect if method == "poll" => {
                if let Some(Value::Function(r, closure)) = args.first() {
                    return Some(Eval::value(Value::RetryAssertion(
                        r.clone(),
                        closure.clone(),
                    )));
                }
                return None;
            }
            Value::Expect
                if matches!(
                    method,
                    "stringContaining"
                        | "stringMatching"
                        | "objectContaining"
                        | "arrayContaining"
                        | "any"
                        | "anything"
                ) =>
            {
                return Some(Eval::value(Value::Data));
            }
            Value::TestInfo if method == "attach" => {
                return Some(Eval {
                    value: Value::Promise(Box::new(Value::Undefined)),
                    cost: Estimate::operation("report-attachment", points::LOCAL_IO),
                    ..Eval::default()
                });
            }
            Value::TestInfo if matches!(method, "outputPath" | "snapshotPath") => {
                return Some(Eval::value(Value::Text));
            }
            Value::Request if method == "newContext" => {
                return Some(Eval {
                    value: Value::Promise(Box::new(Value::Request)),
                    cost: Estimate::operation("request-context", points::INTERACTION),
                    ..Eval::default()
                });
            }
            Value::Request if method == "dispose" => {
                return Some(Eval {
                    value: Value::Promise(Box::new(Value::Undefined)),
                    cost: Estimate::operation("request-context", points::INTERACTION),
                    ..Eval::default()
                });
            }
            Value::Builtin(target) => {
                return self.platform_call(&format!("{target}.{method}"), args, ctx);
            }
            Value::TestApi => {
                return match method {
                    "info" => Some(Eval::value(Value::TestInfo)),
                    "skip" | "fixme" | "fail" | "slow" | "setTimeout" => {
                        Some(Eval::value(Value::Undefined))
                    }
                    _ => None,
                };
            }
            Value::Promise(value) if matches!(method, "then" | "catch" | "finally") => {
                let mut result = if let Some(Value::Function(r, closure)) = args.first() {
                    self.invoke(r, closure, vec![*value.clone()], None, ctx)
                } else {
                    Eval::value(*value.clone())
                };
                if method == "catch" {
                    result.cost = result
                        .cost
                        .optional("Promise rejection callback is conditional");
                    result.value = Value::Data;
                }
                if method == "finally" {
                    result.value = *value.clone();
                }
                result.value = Value::Promise(Box::new(result.value.resolved()));
                return Some(result);
            }
            Value::Response => {
                return Some(Eval::value(match method {
                    "ok" | "status" | "headers" => Value::Data,
                    "url" | "statusText" => Value::Text,
                    "text" => Value::Promise(Box::new(Value::Text)),
                    "json" => Value::Promise(Box::new(Value::Data)),
                    "body" => Value::Promise(Box::new(Value::Data)),
                    "request" => Value::Response,
                    _ => return None,
                }));
            }
            Value::Map(items) => {
                let first = args.first().cloned().unwrap_or(Value::Undefined);
                let value = match method {
                    "get" => items
                        .as_ref()
                        .map(|v| {
                            v.iter()
                                .find(|(k, _)| k == &first)
                                .map(|(_, v)| v.clone())
                                .unwrap_or(Value::Undefined)
                        })
                        .unwrap_or(Value::Data),
                    "has" => items
                        .as_ref()
                        .map(|v| Value::Bool(v.iter().any(|(k, _)| k == &first)))
                        .unwrap_or(Value::Data),
                    "set" => {
                        if let Some(items) = items {
                            if let Some((_, v)) = items.iter_mut().find(|(k, _)| k == &first) {
                                *v = args.get(1).cloned().unwrap_or(Value::Undefined);
                            } else {
                                items.push((
                                    first,
                                    args.get(1).cloned().unwrap_or(Value::Undefined),
                                ));
                            }
                        }
                        Value::Undefined
                    }
                    "entries" => items
                        .as_ref()
                        .map(|v| {
                            Value::Array(
                                v.iter()
                                    .map(|(k, v)| Value::Array(vec![k.clone(), v.clone()]))
                                    .collect(),
                            )
                        })
                        .unwrap_or(Value::Sequence(Box::new(Value::Array(vec![
                            Value::Data,
                            Value::Data,
                        ])))),
                    "clear" | "delete" => {
                        *items = None;
                        Value::Data
                    }
                    _ => return None,
                };
                return Some(Eval::value(value));
            }
            Value::Set(items) => {
                let value = match method {
                    "has" => items
                        .as_ref()
                        .map(|v| Value::Bool(args.first().is_some_and(|a| v.contains(a))))
                        .unwrap_or(Value::Data),
                    "add" => {
                        if let (Some(items), Some(arg)) = (items, args.first()) {
                            items.push(arg.clone());
                        }
                        Value::Undefined
                    }
                    _ => return None,
                };
                return Some(Eval::value(value));
            }
            _ => {}
        }
        if matches!(receiver, Value::String(_) | Value::Text | Value::Data) {
            let first = args.first();
            let value = match method {
                "trim" | "toLowerCase" | "toUpperCase" => match receiver {
                    Value::String(v) => Value::String(match method {
                        "trim" => v.trim().into(),
                        "toLowerCase" => v.to_lowercase(),
                        _ => v.to_uppercase(),
                    }),
                    _ => Value::Text,
                },
                "includes" | "startsWith" | "endsWith" => match (&receiver, first) {
                    (Value::String(s), Some(Value::String(p))) => Value::Bool(match method {
                        "includes" => s.contains(p),
                        "startsWith" => s.starts_with(p),
                        _ => s.ends_with(p),
                    }),
                    _ => Value::Data,
                },
                "replace" | "replaceAll" => match (&receiver, first, args.get(1)) {
                    (Value::String(s), Some(Value::String(from)), Some(Value::String(to))) => {
                        Value::String(if method == "replaceAll" {
                            s.replace(from, to)
                        } else {
                            s.replacen(from, to, 1)
                        })
                    }
                    _ => Value::Text,
                },
                "slice" | "substring" | "substr" | "padStart" | "padEnd" | "toFixed" => Value::Text,
                "split" => Value::Sequence(Box::new(Value::Text)),
                "match" => Value::Sequence(Box::new(Value::Text)),
                "indexOf" | "lastIndexOf" | "charCodeAt" => Value::Data,
                _ => Value::Unknown,
            };
            if !matches!(value, Value::Unknown) {
                return Some(Eval::value(value));
            }
        }
        if matches!(receiver, Value::Array(_) | Value::Sequence(_) | Value::Data) {
            if method == "flat" {
                let depth = match args.first() {
                    None => 1,
                    Some(Value::Number(n)) if *n <= 0 => 0,
                    Some(Value::Number(n)) if *n <= points::CALL_LIMIT as i64 => *n as usize,
                    _ => return Some(Eval::value(Value::Sequence(Box::new(Value::Data)))),
                };
                fn flatten(value: &Value, depth: usize, output: &mut Vec<Value>) -> bool {
                    if depth > 0
                        && let Value::Array(items) = value
                    {
                        return items.iter().all(|item| flatten(item, depth - 1, output));
                    }
                    if matches!(value, Value::Sequence(_)) {
                        return false;
                    }
                    output.push(value.clone());
                    true
                }
                let mut output = vec![];
                let exact = if let Value::Array(items) = receiver {
                    items.iter().all(|item| flatten(item, depth, &mut output))
                } else {
                    false
                };
                return Some(Eval::value(if exact {
                    Value::Array(output)
                } else {
                    Value::Sequence(Box::new(Value::Data))
                }));
            }
            if method == "join" {
                return Some(Eval::value(Value::Text));
            }
            if matches!(
                method,
                "push" | "pop" | "shift" | "unshift" | "splice" | "sort" | "reverse"
            ) {
                if let Value::Array(items) = receiver {
                    if method == "push" {
                        items.extend_from_slice(args);
                    } else {
                        *receiver = Value::Sequence(Box::new(Value::Data));
                    }
                }
                return Some(Eval::value(Value::Data));
            }
            if method == "includes" {
                return Some(Eval::value(if let Value::Array(items) = receiver {
                    args.first()
                        .map(|v| Value::Bool(items.contains(v)))
                        .unwrap_or(Value::Bool(false))
                } else {
                    Value::Data
                }));
            }
            if matches!(
                method,
                "map" | "forEach" | "filter" | "find" | "some" | "every" | "reduce"
            ) {
                let Some(Value::Function(r, closure)) = args.first() else {
                    return None;
                };
                let bounded = matches!(receiver,Value::Array(v) if v.len()<=points::LOOP_LIMIT);
                let items = match receiver {
                    Value::Array(items) if bounded => items.clone(),
                    Value::Sequence(item) => vec![*item.clone()],
                    _ => vec![Value::Data],
                };
                let mut cost = Estimate::default();
                let mut results = vec![];
                let mut selected = vec![];
                let mut uncertain_filter = false;
                let mut optional = false;
                let mut accumulator = args.get(1).cloned();
                for (i, item) in items.into_iter().enumerate() {
                    if method == "reduce" && accumulator.is_none() {
                        accumulator = Some(item);
                        continue;
                    }
                    let arguments = if method == "reduce" {
                        vec![
                            accumulator.clone().unwrap_or(Value::Data),
                            item.clone(),
                            Value::Number(i as i64),
                        ]
                    } else {
                        vec![item.clone(), Value::Number(i as i64)]
                    };
                    let result = self.invoke(r, closure, arguments, None, ctx);
                    cost.add(if optional {
                        result
                            .cost
                            .optional("Collection callback may short-circuit")
                    } else {
                        result.cost
                    });
                    let truth = result.value.truth();
                    accumulator = Some(result.value.clone());
                    if truth == Some(true) {
                        selected.push(item);
                    } else if result.value.truth().is_none() {
                        uncertain_filter = true;
                    }
                    results.push(result.value);
                    if matches!(method, "some" | "find") && truth == Some(true)
                        || method == "every" && truth == Some(false)
                    {
                        break;
                    }
                    if matches!(method, "some" | "find" | "every") && truth.is_none() {
                        optional = true;
                    }
                }
                if !bounded {
                    cost = cost.unknown_repetitions();
                }
                let value = match method {
                    "forEach" => Value::Undefined,
                    "reduce" if bounded => accumulator.unwrap_or(Value::Undefined),
                    "some" | "every" => Value::Data,
                    "find" => selected.first().cloned().unwrap_or(Value::Data),
                    "filter" if bounded && !uncertain_filter => Value::Array(selected),
                    "filter" => Value::Sequence(Box::new(Value::Data)),
                    "map" if bounded => Value::Array(results),
                    "map" => Value::Sequence(Box::new(Value::Data)),
                    _ => Value::Data,
                };
                if self.node(r).is_some_and(function_async) {
                    cost = cost.optional("Async array callbacks may overlap");
                }
                return Some(Eval {
                    value,
                    cost,
                    ..Eval::default()
                });
            }
        }
        None
    }
}
impl Project {
    // A recursion back-edge has an unknown operation count, but it does not
    // erase a provable async/class return type. No body is executed here.
    pub(super) fn recursive_return(&self, reference: &Reference, this: Option<&Value>) -> Value {
        let Some(function) = self.node(reference) else {
            return Value::Unknown;
        };
        let source = &self.modules[&reference.file].source;
        let mut value = Value::Data;
        if let Some(body) = field(function, "body") {
            fn returns(n: Node, out: &mut Vec<usize>) {
                if matches!(
                    n.kind(),
                    "function_declaration"
                        | "function_expression"
                        | "arrow_function"
                        | "method_definition"
                        | "class"
                        | "class_declaration"
                ) {
                    return;
                }
                if n.kind() == "return_statement" {
                    out.push(n.start_byte());
                }
                for child in children(n) {
                    returns(child, out);
                }
            }
            let mut exits = vec![];
            returns(body, &mut exits);
            if let Some(last) = children(body).last().copied()
                && last.kind() == "return_statement"
                && exits == [last.start_byte()]
                && let Some(mut returned) = children(last).first().copied()
            {
                if returned.kind() == "this" {
                    value = this.map(Value::widen).unwrap_or(Value::Data);
                } else {
                    if returned.kind() == "identifier"
                        && let Some(initializer) = children(body)
                            .into_iter()
                            .filter(|n| {
                                matches!(n.kind(), "lexical_declaration" | "variable_declaration")
                            })
                            .flat_map(children)
                            .find_map(|declaration| {
                                field(declaration, "name")
                                    .filter(|name| text(*name, source) == text(returned, source))
                                    .and_then(|_| field(declaration, "value"))
                            })
                    {
                        returned = initializer;
                    }
                    if returned.kind() == "new_expression"
                        && let Some(constructor) = field(returned, "constructor")
                        && let Some(class) =
                            self.symbol(&reference.file, text(constructor, source), 0)
                        && self
                            .node(&class)
                            .is_some_and(|n| matches!(n.kind(), "class" | "class_declaration"))
                    {
                        value = Value::Instance(class, Env::new());
                    }
                }
            }
        }
        if function_async(function) {
            Value::Promise(Box::new(value))
        } else {
            value
        }
    }
    pub(super) fn class_base(&self, class: &Reference) -> Option<Reference> {
        let n = self.node(class)?;
        let s = &self.modules[&class.file].source;
        let base = children(n)
            .into_iter()
            .find(|n| n.kind() == "class_heritage")
            .and_then(|n| {
                children(n)
                    .into_iter()
                    .find(|n| n.kind() == "extends_clause")
            })
            .and_then(|n| field(n, "value"))?;
        self.symbol(&class.file, text(base, s), 0)
    }
    pub(super) fn class_method(
        &self,
        class: &Reference,
        name: &str,
        depth: usize,
    ) -> Option<Reference> {
        if depth > points::CALL_LIMIT {
            return None;
        }
        let body = self.node(class).and_then(|n| field(n, "body"))?;
        let s = &self.modules[&class.file].source;
        if let Some(n) = children(body).into_iter().find(|n| {
            n.kind() == "method_definition" && field(*n, "name").is_some_and(|n| text(n, s) == name)
        }) {
            return Some(self.reference(&class.file, n));
        }
        self.class_base(class)
            .and_then(|base| self.class_method(&base, name, depth + 1))
    }
    pub(super) fn initialize_fields(
        &self,
        class: &Reference,
        env: &mut Env,
        ctx: &mut Context,
    ) -> Estimate {
        let Some(body) = self.node(class).and_then(|n| field(n, "body")) else {
            return Estimate::unknown("Unresolved class fields");
        };
        let s = &self.modules[&class.file].source;
        let mut cost = Estimate::default();
        for member in children(body).into_iter().filter(|n| {
            n.kind() == "public_field_definition"
                && !text(*n, s).split_whitespace().any(|v| v == "static")
        }) {
            if let (Some(name), Some(value)) = (field(member, "name"), field(member, "value")) {
                let r = self.eval(&class.file, value, env, ctx);
                cost.add(r.cost);
                if let Some(Value::Instance(_, fields)) = env.get_mut("this") {
                    fields.insert(text(name, s).into(), r.value);
                }
            }
        }
        cost
    }
    pub(super) fn parameter_properties(&self, class: &Reference, env: &mut Env) {
        if let Some(constructor) = self
            .class_method(class, "constructor", 0)
            .and_then(|r| self.node(&r))
        {
            let s = &self.modules[&class.file].source;
            for param in params(constructor) {
                if children(param)
                    .iter()
                    .any(|n| n.kind() == "accessibility_modifier" || text(*n, s) == "readonly")
                {
                    let name = text(pattern(param), s);
                    let value = env.get(name).cloned().unwrap_or(Value::Data);
                    if let Some(Value::Instance(_, fields)) = env.get_mut("this") {
                        fields.insert(name.into(), value);
                    }
                }
            }
        }
    }
    pub(super) fn construct(
        &self,
        class: &Reference,
        args: &[Value],
        ctx: &mut Context,
        depth: usize,
    ) -> Eval {
        if depth > points::CALL_LIMIT {
            return Eval::cost(Estimate::unknown("Class inheritance depth exceeded"));
        }
        let Some(body) = self.node(class).and_then(|n| field(n, "body")) else {
            return Eval::cost(Estimate::unknown("Unresolved class body"));
        };
        let s = &self.modules[&class.file].source;
        let constructor = children(body).into_iter().find(|n| {
            n.kind() == "method_definition"
                && field(*n, "name").is_some_and(|n| text(n, s) == "constructor")
        });
        let mut fields = Env::new();
        let mut cost = Estimate::default();
        if constructor.is_none()
            && let Some(base) = self.class_base(class)
        {
            let parent = self.construct(&base, args, ctx, depth + 1);
            cost.add(parent.cost);
            if let Value::Instance(_, values) = parent.value {
                fields = values;
            }
        }
        let mut env = Env::from([("this".into(), Value::Instance(class.clone(), fields))]);
        if self.class_base(class).is_none() || constructor.is_none() {
            cost.add(self.initialize_fields(class, &mut env, ctx));
        }
        if let Some(constructor) = constructor {
            for (i, param) in params(constructor).into_iter().enumerate() {
                let value = args.get(i).cloned().unwrap_or(Value::Undefined);
                bind(param, value.clone(), s, &mut env);
            }
            if self.class_base(class).is_none() {
                self.parameter_properties(class, &mut env);
            }
            if let Some(body) = field(constructor, "body") {
                cost.add(self.eval(&class.file, body, &mut env, ctx).cost);
            }
        }

        Eval {
            value: env.remove("this").unwrap(),
            cost,
            ..Eval::default()
        }
    }
}
pub(super) fn binary(a: Value, b: Value, op: &str) -> Value {
    match (&a, &b, op) {
        (Value::Number(a), Value::Number(b), "+" | "-" | "*" | "/" | "%") => match op {
            "+" => a.checked_add(*b),
            "-" => a.checked_sub(*b),
            "*" => a.checked_mul(*b),
            "/" => a
                .checked_rem(*b)
                .filter(|v| *v == 0)
                .and_then(|_| a.checked_div(*b)),
            _ => a.checked_rem(*b),
        }
        .map(Value::Number)
        .unwrap_or(Value::Data),
        (Value::Number(a), Value::Number(b), "<") => Value::Bool(a < b),
        (Value::Number(a), Value::Number(b), "<=") => Value::Bool(a <= b),
        (Value::Number(a), Value::Number(b), ">") => Value::Bool(a > b),
        (Value::Number(a), Value::Number(b), ">=") => Value::Bool(a >= b),
        (Value::String(a), Value::String(b), "+") => Value::String(format!("{a}{b}")),
        (Value::String(_) | Value::Text, _, "+") | (_, Value::String(_) | Value::Text, "+") => {
            Value::Text
        }
        (_, _, "===" | "!==" | "==" | "!=")
            if matches!(
                a,
                Value::Bool(_)
                    | Value::Number(_)
                    | Value::String(_)
                    | Value::Null
                    | Value::Undefined
            ) && matches!(
                b,
                Value::Bool(_)
                    | Value::Number(_)
                    | Value::String(_)
                    | Value::Null
                    | Value::Undefined
            ) =>
        {
            if matches!(op, "==" | "!=") && std::mem::discriminant(&a) != std::mem::discriminant(&b)
            {
                return Value::Data;
            }
            Value::Bool(if matches!(op, "!==" | "!=") {
                a != b
            } else {
                a == b
            })
        }
        _ => Value::Data,
    }
}
