// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

use crate::{
    Manifest, Test, children, field, hash, normalize,
    points::{self, Estimate},
    project::{Project, Reference},
    text,
};
use std::collections::{BTreeMap, BTreeSet};
use tree_sitter::Node;
mod collection;
mod restoration;
mod runtime;
pub(crate) use collection::Bindings;
type Env = BTreeMap<String, Value>;
#[derive(Clone, Debug, Default, PartialEq)]
enum Value {
    #[default]
    Unknown,
    Data,
    Text,
    Null,
    Undefined,
    Number(i64),
    Bool(bool),
    String(String),
    Array(Vec<Value>),
    Sequence(Box<Value>),
    Object(Env),
    Builtin(String),
    Promise(Box<Value>),
    Response,
    TestApi,
    TestInfo,
    Map(Option<Vec<(Value, Value)>>),
    Set(Option<Vec<Value>>),
    Browser,
    Request,
    Expect,
    Assertion(bool),
    RetryAssertion(Reference, Box<Env>),
    Use,
    Function(Reference, Box<Env>),
    Class(Reference),
    Instance(Reference, Env),
    Namespace(String),
    MissingDependency(String),
    DataLibrary(String),
}
impl Value {
    fn settled() -> Self {
        Self::Object(Env::from([
            ("status".into(), Self::Text),
            ("value".into(), Self::Data),
            ("reason".into(), Self::Data),
        ]))
    }
    fn data_only(&self) -> bool {
        match self {
            Self::Null
            | Self::Undefined
            | Self::Bool(_)
            | Self::Number(_)
            | Self::String(_)
            | Self::Text
            | Self::Data => true,
            Self::Array(v) => v.iter().all(Self::data_only),
            Self::Object(v) => v.values().all(Self::data_only),
            Self::Sequence(v) => v.data_only(),
            _ => false,
        }
    }
    fn widen(&self) -> Self {
        match self {
            Self::String(_) | Self::Text => Self::Text,
            Self::Array(v) => {
                Self::Sequence(Box::new(v.first().map(Self::widen).unwrap_or(Self::Data)))
            }
            Self::Sequence(v) => Self::Sequence(v.clone()),
            Self::Promise(v) => Self::Promise(Box::new(v.widen())),
            Self::Map(_) => Self::Map(None),
            Self::Set(_) => Self::Set(None),
            Self::Object(v) => {
                Self::Object(v.iter().map(|(k, v)| (k.clone(), v.widen())).collect())
            }
            Self::Instance(c, v) => Self::Instance(
                c.clone(),
                v.iter().map(|(k, v)| (k.clone(), v.widen())).collect(),
            ),
            Self::Browser
            | Self::Request
            | Self::Function(..)
            | Self::Class(_)
            | Self::TestInfo
            | Self::TestApi
            | Self::Expect
            | Self::Use
            | Self::Builtin(_)
            | Self::Namespace(_)
            | Self::DataLibrary(_)
            | Self::MissingDependency(_)
            | Self::Response
            | Self::Assertion(_)
            | Self::RetryAssertion(..) => self.clone(),
            _ => Self::Data,
        }
    }
    fn resolved(self) -> Self {
        if let Self::Promise(value) = self {
            *value
        } else {
            self
        }
    }
    fn truth(&self) -> Option<bool> {
        match self {
            Self::Bool(v) => Some(*v),
            Self::Number(v) => Some(*v != 0),
            Self::String(v) => Some(!v.is_empty()),
            Self::Null | Self::Undefined => Some(false),
            Self::Array(_)
            | Self::Object(_)
            | Self::Map(_)
            | Self::Set(_)
            | Self::Instance(..)
            | Self::Function(..)
            | Self::Class(_)
            | Self::Browser
            | Self::Request => Some(true),
            _ => None,
        }
    }
    fn from_json(value: &serde_json::Value) -> Self {
        match value {
            serde_json::Value::Null => Self::Null,
            serde_json::Value::Bool(v) => Self::Bool(*v),
            serde_json::Value::String(v) => Self::String(v.clone()),
            serde_json::Value::Number(v) => v.as_i64().map(Self::Number).unwrap_or(Self::Data),
            serde_json::Value::Array(v) => Self::Array(v.iter().map(Self::from_json).collect()),
            serde_json::Value::Object(v) => Self::Object(
                v.iter()
                    .map(|(k, v)| (k.clone(), Self::from_json(v)))
                    .collect(),
            ),
        }
    }
    fn json(&self) -> Option<serde_json::Value> {
        match self {
            Self::Null => Some(serde_json::Value::Null),
            Self::Bool(v) => Some((*v).into()),
            Self::Number(v) => Some((*v).into()),
            Self::String(v) => Some(v.clone().into()),
            Self::Array(v) => v
                .iter()
                .map(Self::json)
                .collect::<Option<Vec<_>>>()
                .map(serde_json::Value::Array),
            Self::Object(v) => v
                .iter()
                .map(|(k, v)| Some((k.clone(), v.json()?)))
                .collect::<Option<serde_json::Map<_, _>>>()
                .map(serde_json::Value::Object),
            _ => None,
        }
    }
}
#[derive(Clone, Copy, PartialEq, Default)]
enum Flow {
    #[default]
    Continue,
    Return,
    Use,
    Break,
    Next,
    Throw,
    Maybe,
}
#[derive(Default)]
struct Eval {
    value: Value,
    cost: Estimate,
    flow: Flow,
    this: Option<Value>,
    writes: Env,
}
impl Eval {
    fn value(value: Value) -> Self {
        Self {
            value,
            ..Self::default()
        }
    }
    fn cost(cost: Estimate) -> Self {
        Self {
            cost,
            ..Self::default()
        }
    }
}
struct Context {
    budget: usize,
    stack: Vec<String>,
    module_values: BTreeMap<(String, usize), Value>,
    tainted_libraries: BTreeSet<String>,
    lexical_envs: BTreeMap<(String, usize), Env>,
}
impl Default for Context {
    fn default() -> Self {
        Self {
            budget: points::NODE_LIMIT,
            stack: vec![],
            module_values: BTreeMap::new(),
            tainted_libraries: BTreeSet::new(),
            lexical_envs: BTreeMap::new(),
        }
    }
}
fn function_async(n: Node) -> bool {
    (0..n.child_count()).any(|i| n.child(i).is_some_and(|n| n.kind() == "async"))
}
fn params(n: Node) -> Vec<Node> {
    field(n, "parameters")
        .map(children)
        .unwrap_or_else(|| field(n, "parameter").into_iter().collect())
}
fn pattern(n: Node) -> Node {
    field(n, "pattern")
        .or_else(|| field(n, "name"))
        .unwrap_or(n)
}
fn names(n: Node, s: &str) -> Vec<String> {
    let n = pattern(n);
    if n.kind() == "identifier" {
        return vec![text(n, s).into()];
    }
    children(n)
        .into_iter()
        .filter_map(|c| match c.kind() {
            "shorthand_property_identifier_pattern" => Some(text(c, s).into()),
            "pair_pattern" => field(c, "key").map(|k| text(k, s).into()),
            "object_assignment_pattern" => field(c, "left").map(|k| text(k, s).into()),
            _ => None,
        })
        .collect()
}
fn bind(n: Node, value: Value, s: &str, env: &mut Env) {
    let n = pattern(n);
    match n.kind() {
        "identifier" | "shorthand_property_identifier_pattern" => {
            env.insert(text(n, s).into(), value);
        }
        "object_pattern" => {
            let object = if let Value::Object(v) | Value::Instance(_, v) = value {
                v
            } else {
                Env::new()
            };
            for item in children(n) {
                match item.kind() {
                    "shorthand_property_identifier_pattern" => bind(
                        item,
                        object.get(text(item, s)).cloned().unwrap_or_default(),
                        s,
                        env,
                    ),
                    "pair_pattern" => {
                        if let (Some(key), Some(target)) =
                            (field(item, "key"), field(item, "value"))
                        {
                            bind(
                                target,
                                object.get(text(key, s)).cloned().unwrap_or_default(),
                                s,
                                env,
                            );
                        }
                    }
                    _ => {}
                }
            }
        }
        "array_pattern" => {
            let values = if let Value::Array(v) = value {
                v
            } else {
                vec![]
            };
            for (i, n) in children(n).into_iter().enumerate() {
                bind(n, values.get(i).cloned().unwrap_or_default(), s, env);
            }
        }
        _ => {}
    }
}
fn builtin(name: &str) -> Value {
    match name {
        "page" | "context" | "browser" => Value::Browser,
        "request" => Value::Request,
        "expect" => Value::Expect,
        "browserName" | "baseURL" => Value::Text,
        "testInfo" => Value::TestInfo,
        "playwright" => Value::Object(Env::from([("request".into(), Value::Request)])),
        _ => Value::Unknown,
    }
}
fn invalidate_changed(env: &mut Env, branch: &Env) {
    // Branch assignments may change subsequent loop bounds or receivers. Keep
    // only bindings whose abstract value is unchanged on the optional path.
    for (name, value) in branch {
        if env.get(name).is_none_or(|prior| prior != value) {
            env.insert(name.clone(), value.widen());
        }
    }
}
// Without heap identities, equal abstract objects may alias. Widen the other
// references on mutation rather than inventing a concrete value for them.
fn invalidate_aliases(env: &mut Env, old: &Value, except: &str) {
    if !matches!(
        old,
        Value::Object(_) | Value::Instance(..) | Value::Array(_) | Value::Map(_) | Value::Set(_)
    ) {
        return;
    }
    fn invalidate(value: &mut Value, old: &Value) {
        if value == old {
            *value = value.widen();
        } else {
            match value {
                Value::Object(fields) | Value::Instance(_, fields) => {
                    for value in fields.values_mut() {
                        invalidate(value, old);
                    }
                }
                Value::Array(items) => {
                    for value in items {
                        invalidate(value, old);
                    }
                }
                _ => {}
            }
        }
    }
    for (name, value) in env.iter_mut() {
        if name != except {
            invalidate(value, old);
        }
    }
}
fn store_mutation(target: Node, value: Value, source: &str, env: &mut Env) {
    if let Some(old) = env.get(text(target, source)).cloned() {
        if old == value {
            return;
        }
        invalidate_aliases(env, &old, text(target, source));
    }
    store_value(target, value, source, env);
}
fn store_value(target: Node, value: Value, source: &str, env: &mut Env) {
    if matches!(target.kind(), "identifier" | "this") {
        env.insert(text(target, source).into(), value);
    } else if target.kind() == "member_expression"
        && let (Some(object), Some(property)) = (field(target, "object"), field(target, "property"))
    {
        if let Some(old) = env.get(text(object, source)).cloned() {
            invalidate_aliases(env, &old, text(object, source));
        }
        if let Some(Value::Object(fields) | Value::Instance(_, fields)) =
            env.get_mut(text(object, source))
        {
            fields.insert(text(property, source).into(), value);
        }
    } else {
        // Dynamic or nested writes can change values used by later branches.
        for value in env.values_mut() {
            *value = value.widen();
        }
    }
}
fn invalidate_call(env: &mut Env, result: &Eval) {
    if result
        .cost
        .reasons
        .iter()
        .any(|r| r == "Helper mutates state outside its local bindings")
    {
        for value in env.values_mut() {
            *value = value.widen();
        }
    }
}
fn escaped_writes(body: Node, source: &str, parameters: &[Node]) -> Vec<String> {
    let mut locals = BTreeSet::new();
    fn bindings(n: Node, s: &str, locals: &mut BTreeSet<String>) {
        if matches!(
            n.kind(),
            "identifier" | "shorthand_property_identifier_pattern"
        ) {
            locals.insert(text(n, s).into());
        } else {
            for child in children(n) {
                bindings(child, s, locals);
            }
        }
    }
    for p in parameters {
        bindings(pattern(*p), source, &mut locals);
    }
    let mut writes = vec![];
    fn visit<'a>(n: Node<'a>, s: &str, locals: &mut BTreeSet<String>, writes: &mut Vec<Node<'a>>) {
        if matches!(
            n.kind(),
            "arrow_function" | "function_expression" | "function_declaration"
        ) {
            return;
        }
        if n.kind() == "variable_declarator"
            && let Some(name) = field(n, "name")
        {
            bindings(name, s, locals);
        }
        if matches!(
            n.kind(),
            "assignment_expression" | "augmented_assignment_expression" | "update_expression"
        ) && let Some(target) = field(n, "left").or_else(|| field(n, "argument"))
        {
            writes.push(target);
        }
        for child in children(n) {
            visit(child, s, locals, writes);
        }
    }
    visit(body, source, &mut locals, &mut writes);
    writes
        .iter()
        .filter(|n| n.kind() != "identifier" || !locals.contains(text(**n, source)))
        .map(|n| text(*n, source).to_string())
        .collect()
}
impl Project {
    fn value(&self, file: &str, name: &str, env: &Env, ctx: &mut Context) -> Value {
        if let Some(v) = env.get(name) {
            return v.clone();
        }
        // A star re-export exposes names to importers, not new local bindings.
        // In particular it must not turn JSON, Set or Promise into fake runner exports.
        if !self.imports(file).contains_key(name) && self.declaration(file, name).is_none() {
            match name {
                "process" | "console" | "Object" | "Array" | "JSON" | "Math" | "Number"
                | "String" | "Boolean" | "RegExp" | "URL" | "Error" | "TypeError" | "Map"
                | "Set" | "WeakMap" | "WeakSet" | "Promise" | "parseInt" | "parseFloat"
                | "Date" | "setTimeout" | "setInterval" | "clearTimeout" | "clearInterval"
                | "queueMicrotask" | "fetch" => return Value::Builtin(name.into()),
                "undefined" => return Value::Undefined,
                "__dirname" | "__filename" => return Value::Text,
                _ => {}
            }
        }
        if let Some((module, export)) = self.external(file, name, 0) {
            if module == "@playwright/test" {
                return match export.as_str() {
                    "test" => Value::TestApi,
                    "expect" => Value::Expect,
                    "request" => Value::Request,
                    _ => Value::Unknown,
                };
            }
            let module = module.strip_prefix("node:").unwrap_or(&module);
            if matches!(
                module,
                "fs" | "fs/promises" | "path" | "url" | "os" | "assert" | "assert/strict"
            ) {
                return Value::Builtin(if matches!(export.as_str(), "default" | "*") {
                    module.into()
                } else {
                    format!("{module}.{export}")
                });
            }
            if self.resolve_import(file, name, module).is_none() {
                return Value::MissingDependency(module.into());
            }
        }
        if let Some((module, export)) = self.imports(file).get(name) {
            if module == "@playwright/test" && export == "expect" {
                return Value::Expect;
            }
            if export == "*"
                && let Some(target) = self.resolve_import(file, name, module)
            {
                return Value::Namespace(target);
            }
            if let Some(target) = self.resolve_import(file, name, module)
                && let Some(data) = self.data.get(&target)
            {
                return Value::from_json(data);
            }
        }
        let Some(r) = self.symbol(file, name, 0) else {
            return match name {
                "process" | "console" | "Object" | "Array" | "JSON" | "Math" | "Number"
                | "String" | "Boolean" | "RegExp" | "URL" | "Error" | "TypeError" | "Map"
                | "Set" | "WeakMap" | "WeakSet" | "Promise" | "parseInt" | "parseFloat"
                | "Date" | "setTimeout" | "setInterval" | "clearTimeout" | "clearInterval"
                | "queueMicrotask" | "fetch" => Value::Builtin(name.into()),
                "undefined" => Value::Undefined,
                "__dirname" | "__filename" => Value::Text,
                _ => Value::Unknown,
            };
        };
        if self.node(&r).is_some_and(|n| n.kind() == "call_expression")
            && self.provider(file, name, &mut BTreeSet::new()).is_some()
        {
            return Value::TestApi;
        }
        if self.data_modules.contains(&r.file)
            && self
                .node(&r)
                .is_some_and(|n| matches!(n.kind(), "new_expression" | "call_expression"))
        {
            return Value::DataLibrary(r.file);
        }
        if self.mutable_binding(&r) {
            return Value::Data;
        }
        let cache_key = (r.file.clone(), r.start);
        if let Some(value) = ctx.module_values.get(&cache_key) {
            return value.clone();
        }
        let key = format!("binding:{}:{}", r.file, r.start);
        if ctx.stack.contains(&key) || ctx.stack.len() >= points::CALL_LIMIT {
            return Value::Unknown;
        }
        ctx.stack.push(key);
        let mut v = self
            .node(&r)
            .map(|n| self.eval(&r.file, n, &mut Env::new(), ctx).value)
            .unwrap_or_default();
        ctx.stack.pop();
        // Module collections survive between tests; their contents cannot be
        // assumed to match construction-time values on every reuse.
        match &mut v {
            Value::Map(v) => *v = None,
            Value::Set(v) => *v = None,
            _ => {}
        }
        ctx.module_values.insert(cache_key, v.clone());
        v
    }
    fn invoke(
        &self,
        r: &Reference,
        closure: &Env,
        args: Vec<Value>,
        this: Option<Value>,
        ctx: &mut Context,
    ) -> Eval {
        let key = format!("call:{}:{}:{}", r.file, r.start, hash(format!("{args:?}")));
        let call_prefix = format!("call:{}:{}:", r.file, r.start);
        if ctx.stack.contains(&key)
            || args.iter().all(|v| v.json().is_none())
                && ctx.stack.iter().any(|key| key.starts_with(&call_prefix))
        {
            return Eval {
                value: self.recursive_return(r, this.as_ref()),
                cost: Estimate::unknown("Recursive helper depends on runtime data"),
                ..Eval::default()
            };
        }
        if ctx.stack.len() >= points::CALL_LIMIT {
            return Eval::cost(Estimate::unknown("Static helper call-depth limit"));
        }
        let Some(n) = self.node(r) else {
            return Eval::cost(Estimate::unknown("Unresolved helper body"));
        };
        let s = &self.modules[&r.file].source;
        let mut env = closure.clone();
        // Closures capture bindings, not their values at declaration time. A
        // nested helper can read locals initialized later in its lexical block.
        let mut parent = n.parent();
        while let Some(scope) = parent {
            if matches!(scope.kind(), "statement_block" | "program") {
                if let Some(active) = ctx.lexical_envs.get(&(r.file.clone(), scope.start_byte())) {
                    env.extend(active.clone());
                }
                break;
            }
            parent = scope.parent();
        }
        if let Some(this) = this {
            env.insert("this".into(), this);
        }
        ctx.stack.push(key);
        let mut defaults = Estimate::default();
        for (i, param) in params(n).into_iter().enumerate() {
            let mut value = if let Some(value) = args.get(i) {
                value.clone()
            } else if let Some(value) = field(param, "value") {
                let r = self.eval(&r.file, value, &mut env, ctx);
                defaults.add(r.cost);
                r.value
            } else {
                Value::Unknown
            };
            if matches!(value, Value::Unknown)
                && let Some(annotation) = field(param, "type")
            {
                let annotation = text(annotation, s).trim_start_matches(':').trim();
                value = match annotation {
                    "string" => Value::Text,
                    "number" | "boolean" | "unknown" => Value::Data,
                    _ => {
                        if annotation.ends_with("[]") {
                            Value::Sequence(Box::new(Value::Data))
                        } else {
                            value
                        }
                    }
                };
            }
            bind(param, value, s, &mut env);
        }
        let mut result = field(n, "body")
            .map(|n| self.eval(&r.file, n, &mut env, ctx))
            .unwrap_or_default();
        ctx.stack.pop();
        result.cost.add(defaults);
        let writes = field(n, "body")
            .map(|body| escaped_writes(body, s, &params(n)))
            .unwrap_or_default();
        if !writes.is_empty() && args.iter().any(|v| !v.data_only()) {
            for name in &writes {
                let root = name.split(['.', '[']).next().unwrap_or(name);
                let target = self
                    .imports(&r.file)
                    .get(root)
                    .and_then(|(module, _)| self.resolve_import(&r.file, root, module))
                    .or_else(|| self.data_modules.contains(&r.file).then(|| r.file.clone()));
                if let Some(target) = target {
                    ctx.tainted_libraries
                        .extend(self.dependency_closure(&target));
                }
            }
        }
        for name in &writes {
            if let Some(value) = env.get(name) {
                result.writes.insert(name.clone(), value.clone());
            }
        }
        if !writes.is_empty() {
            result.cost.complete = false;
            result
                .cost
                .reasons
                .push("Helper mutates state outside its local bindings".into());
        }
        result.this = env.get("this").cloned();
        if matches!(result.flow, Flow::Return | Flow::Maybe) {
            result.flow = Flow::Continue;
        }
        if function_async(n) && result.flow != Flow::Use {
            result.value = Value::Promise(Box::new(result.value.resolved()));
        }
        result
    }
    fn eval(&self, file: &str, node: Node, env: &mut Env, ctx: &mut Context) -> Eval {
        if ctx.budget == 0 {
            return Eval::cost(Estimate::unknown("Static analysis node budget exceeded"));
        }
        ctx.budget -= 1;
        let n = normalize::untyped(node);
        let s = &self.modules[file].source;
        let eval_field = |name: &str, env: &mut Env, ctx: &mut Context| {
            field(n, name)
                .map(|n| self.eval(file, n, env, ctx))
                .unwrap_or_default()
        };
        match n.kind() {
            "comment"
            | "type_annotation"
            | "interface_declaration"
            | "type_alias_declaration"
            | "empty_statement" => Eval::default(),
            "identifier" | "shorthand_property_identifier" | "this" => {
                Eval::value(self.value(file, text(n, s), env, ctx))
            }
            "number" => Eval::value(
                text(n, s)
                    .replace('_', "")
                    .parse()
                    .map(Value::Number)
                    .unwrap_or_default(),
            ),
            "true" => Eval::value(Value::Bool(true)),
            "false" => Eval::value(Value::Bool(false)),
            "string" => Eval::value(
                normalize::string(n, s)
                    .map(Value::String)
                    .unwrap_or_default(),
            ),
            "null" => Eval::value(Value::Null),
            "undefined" => Eval::value(Value::Undefined),
            "regex" => Eval::value(Value::Builtin("RegExp.instance".into())),
            "string_fragment" | "escape_sequence" => Eval::default(),
            "template_substitution" => children(n)
                .first()
                .map(|n| self.eval(file, *n, env, ctx))
                .unwrap_or_default(),
            "template_string" => {
                let mut cost = Estimate::default();
                let mut value = String::new();
                let mut known = true;
                for child in children(n) {
                    let part = if child.kind() == "template_substitution" {
                        let result = self.eval(file, child, env, ctx);
                        cost.add(result.cost);
                        match result.value {
                            Value::String(s) => Some(s),
                            Value::Number(n) => Some(n.to_string()),
                            Value::Bool(b) => Some(b.to_string()),
                            Value::Null => Some("null".into()),
                            Value::Undefined => Some("undefined".into()),
                            _ => None,
                        }
                    } else {
                        normalize::decode(text(child, s))
                    };
                    if let Some(part) = part {
                        value.push_str(&part);
                    } else {
                        known = false;
                    }
                }
                Eval {
                    cost,
                    value: if known {
                        Value::String(value)
                    } else {
                        Value::Text
                    },
                    ..Eval::default()
                }
            }
            "arrow_function"
            | "function_expression"
            | "function_declaration"
            | "method_definition" => Eval::value(Value::Function(
                self.reference(file, n),
                Box::new(env.clone()),
            )),
            "class_declaration" | "class" => Eval::value(Value::Class(self.reference(file, n))),
            "array" => {
                let mut cost = Estimate::default();
                let mut values = vec![];
                let mut dynamic = false;
                for c in children(n) {
                    let r = self.eval(file, c, env, ctx);
                    cost.add(r.cost);
                    if c.kind() == "spread_element" {
                        if let Value::Array(items) = r.value {
                            values.extend(items);
                        } else {
                            dynamic = true;
                        }
                    } else {
                        values.push(r.value);
                    }
                }
                Eval {
                    cost,
                    value: if dynamic {
                        Value::Sequence(Box::new(Value::Data))
                    } else {
                        Value::Array(values)
                    },
                    ..Eval::default()
                }
            }
            "object" => {
                let mut cost = Estimate::default();
                let mut values = Env::new();
                let mut dynamic = false;
                for c in children(n) {
                    if c.kind() == "pair" {
                        if let (Some(k), Some(v)) = (field(c, "key"), field(c, "value")) {
                            let r = self.eval(file, v, env, ctx);
                            cost.add(r.cost);
                            values.insert(
                                normalize::string(k, s).unwrap_or_else(|| text(k, s).into()),
                                r.value,
                            );
                        }
                    } else if c.kind() == "method_definition"
                        && let Some(name) = field(c, "name")
                    {
                        values.insert(
                            text(name, s).into(),
                            Value::Function(self.reference(file, c), Box::new(env.clone())),
                        );
                    } else if c.kind() == "spread_element" {
                        let r = self.eval(file, c, env, ctx);
                        cost.add(r.cost);
                        if let Value::Object(fields) = r.value {
                            values.extend(fields);
                        } else {
                            dynamic = true;
                        }
                    } else if c.kind() == "shorthand_property_identifier" {
                        let r = self.eval(file, c, env, ctx);
                        cost.add(r.cost);
                        values.insert(text(c, s).into(), r.value);
                    } else {
                        cost.add(Estimate::unknown("Dynamic object property"));
                    }
                }
                Eval {
                    cost,
                    value: if dynamic {
                        Value::Data
                    } else {
                        Value::Object(values)
                    },
                    ..Eval::default()
                }
            }
            "spread_element" => {
                let mut r = children(n)
                    .first()
                    .map(|n| self.eval(file, *n, env, ctx))
                    .unwrap_or_default();
                r.value = match r.value {
                    Value::Map(Some(v)) => Value::Array(
                        v.into_iter()
                            .map(|(k, v)| Value::Array(vec![k, v]))
                            .collect(),
                    ),
                    Value::Map(None) => {
                        Value::Sequence(Box::new(Value::Array(vec![Value::Data, Value::Data])))
                    }
                    Value::Set(Some(v)) => Value::Array(v),
                    Value::Set(None) => Value::Sequence(Box::new(Value::Data)),
                    v => v,
                };
                r
            }
            "expression_statement" | "await_expression" => {
                let child = children(n).into_iter().next();
                let mut r = child
                    .map(|n| self.eval(file, n, env, ctx))
                    .unwrap_or_default();
                if n.kind() == "await_expression" {
                    r.value = r.value.resolved();
                }
                if n.kind() == "expression_statement"
                    && child.is_some_and(|n| n.kind() == "call_expression")
                    && matches!(r.value, Value::Promise(_))
                    && r.cost.points > 0
                {
                    r.cost = r
                        .cost
                        .uncertain("Unawaited operation may overlap subsequent work");
                }
                r
            }
            "statement_block" | "program" => {
                let scope_key = (file.to_string(), n.start_byte());
                let prior_scope = ctx.lexical_envs.remove(&scope_key);
                let mut result = Eval::default();
                let mut scoped = BTreeMap::new();
                for declaration in children(n)
                    .into_iter()
                    .filter(|n| n.kind() == "lexical_declaration")
                {
                    for item in children(declaration) {
                        if let Some(name) = field(item, "name") {
                            let mut names = Env::new();
                            bind(name, Value::Unknown, s, &mut names);
                            for name in names.into_keys() {
                                scoped
                                    .entry(name.clone())
                                    .or_insert_with(|| env.get(&name).cloned());
                            }
                        }
                    }
                }
                // Function declarations are hoisted within this lexical body.
                for c in children(n)
                    .into_iter()
                    .filter(|c| c.kind() == "function_declaration")
                {
                    if let Some(name) = field(c, "name") {
                        env.insert(
                            text(name, s).into(),
                            Value::Function(self.reference(file, c), Box::new(env.clone())),
                        );
                    }
                }
                for c in children(n) {
                    if c.kind() == "function_declaration" {
                        continue;
                    }
                    ctx.lexical_envs.insert(scope_key.clone(), env.clone());
                    let r = self.eval(file, c, env, ctx);
                    result.cost.add(if result.flow == Flow::Maybe {
                        r.cost.optional("A prior branch may exit before this work")
                    } else {
                        r.cost
                    });
                    result.value = if result.flow == Flow::Maybe {
                        Value::Data
                    } else {
                        r.value
                    };
                    if result.flow != Flow::Maybe {
                        result.flow = r.flow;
                    }
                    if !matches!(result.flow, Flow::Continue | Flow::Maybe) {
                        break;
                    }
                }
                ctx.lexical_envs.remove(&scope_key);
                if let Some(prior) = prior_scope {
                    ctx.lexical_envs.insert(scope_key, prior);
                }
                for (name, previous) in scoped {
                    if let Some(previous) = previous {
                        env.insert(name, previous);
                    } else {
                        env.remove(&name);
                    }
                }
                result
            }
            "lexical_declaration" | "variable_declaration" => {
                let mut cost = Estimate::default();
                for c in children(n) {
                    let r = self.eval(file, c, env, ctx);
                    cost.add(r.cost);
                }
                Eval::cost(cost)
            }
            "variable_declarator" => {
                let r = eval_field("value", env, ctx);
                if let Some(name) = field(n, "name") {
                    bind(name, r.value.clone(), s, env);
                }
                r
            }
            "unary_expression" => {
                let mut r = eval_field("argument", env, ctx);
                let op = field(n, "operator").map(|n| text(n, s)).unwrap_or("");
                r.value = match (op, r.value) {
                    ("!", v) => v.truth().map(|v| Value::Bool(!v)).unwrap_or(Value::Data),
                    ("-", Value::Number(v)) => {
                        v.checked_neg().map(Value::Number).unwrap_or(Value::Data)
                    }
                    ("+", v) => v,
                    ("void", _) => Value::Undefined,
                    ("typeof", v) => match v {
                        Value::String(_) | Value::Text => Value::String("string".into()),
                        Value::Number(_) => Value::String("number".into()),
                        Value::Bool(_) => Value::String("boolean".into()),
                        Value::Object(_)
                        | Value::Array(_)
                        | Value::Map(_)
                        | Value::Set(_)
                        | Value::Null => Value::String("object".into()),
                        Value::Undefined => Value::String("undefined".into()),
                        _ => Value::Text,
                    },
                    _ => Value::Data,
                };
                r
            }
            "break_statement" => Eval {
                flow: Flow::Break,
                ..Eval::default()
            },
            "continue_statement" => Eval {
                flow: Flow::Next,
                ..Eval::default()
            },
            "throw_statement" => {
                let mut r = children(n)
                    .first()
                    .map(|n| self.eval(file, *n, env, ctx))
                    .unwrap_or_default();
                r.flow = Flow::Throw;
                r
            }
            "return_statement" => {
                let mut r = n
                    .named_child(0)
                    .map(|n| self.eval(file, n, env, ctx))
                    .unwrap_or_default();
                r.flow = Flow::Return;
                r
            }
            "member_expression" => {
                let mut result = eval_field("object", env, ctx);
                let key = field(n, "property").map(|n| text(n, s)).unwrap_or("");
                let property = self.property(result.value, key, ctx);
                result.cost.add(property.cost);
                result.value = property.value;
                result
            }
            "subscript_expression" => {
                let mut obj = eval_field("object", env, ctx);
                let index = eval_field("index", env, ctx);
                obj.cost.add(index.cost);
                obj.value = match (obj.value, index.value) {
                    (Value::Array(v), Value::Number(i)) if i >= 0 => {
                        v.get(i as usize).cloned().unwrap_or_default()
                    }
                    (Value::Object(v), Value::String(s)) => v.get(&s).cloned().unwrap_or_default(),
                    (Value::Sequence(v), _) => *v,
                    (Value::Data | Value::Text | Value::Builtin(_), _) => Value::Data,
                    _ => Value::Unknown,
                };
                obj
            }
            "binary_expression" => {
                let a = eval_field("left", env, ctx);
                let op = field(n, "operator").map(|n| text(n, s)).unwrap_or("");
                if matches!(op, "&&" | "||" | "??") {
                    let execute = match (&a.value, op) {
                        (value, "&&") => value.truth(),
                        (value, "||") => value.truth().map(|v| !v),
                        (Value::Null | Value::Undefined, "??") => Some(true),
                        (Value::Unknown | Value::Data | Value::Text | Value::Sequence(_), "??") => {
                            None
                        }
                        (_, "??") => Some(false),
                        _ => None,
                    };
                    if execute == Some(false) {
                        return a;
                    }
                    let mut branch_env = env.clone();
                    let mut b = eval_field("right", &mut branch_env, ctx);
                    if execute.is_none() {
                        b.cost = b
                            .cost
                            .optional("Short-circuit operation depends on runtime data");
                        b.value = Value::Data;
                        invalidate_changed(env, &branch_env);
                    } else {
                        *env = branch_env;
                    }
                    b.cost.add(a.cost);
                    return b;
                }
                let b = eval_field("right", env, ctx);
                let mut cost = a.cost;
                cost.add(b.cost);
                let value = runtime::binary(a.value, b.value, op);
                Eval {
                    cost,
                    value,
                    ..Eval::default()
                }
            }
            "assignment_expression" | "augmented_assignment_expression" => {
                let mut target = None;
                let mut target_cost = Estimate::default();
                if n.kind() == "assignment_expression"
                    && let Some(left) = field(n, "left")
                    && let Some(object) = field(left, "object")
                {
                    let result = self.eval(file, object, env, ctx);
                    target_cost.add(result.cost);
                    target = Some(result.value);
                    if left.kind() == "subscript_expression"
                        && let Some(index) = field(left, "index")
                    {
                        target_cost.add(self.eval(file, index, env, ctx).cost);
                    }
                }
                let mut r = eval_field("right", env, ctx);
                r.cost.add(target_cost);
                if !r.value.data_only()
                    && let Some(Value::DataLibrary(file)) = target
                {
                    ctx.tainted_libraries.extend(self.dependency_closure(&file));
                }
                if let Some(left) = field(n, "left") {
                    if n.kind() == "augmented_assignment_expression" {
                        let prior = self.eval(file, left, env, ctx);
                        r.cost.add(prior.cost);
                        r.value = match (
                            prior.value,
                            r.value,
                            field(n, "operator").map(|n| text(n, s)),
                        ) {
                            (Value::Number(a), Value::Number(b), Some("+=")) => {
                                a.checked_add(b).map(Value::Number).unwrap_or_default()
                            }
                            (Value::Number(a), Value::Number(b), Some("-=")) => {
                                a.checked_sub(b).map(Value::Number).unwrap_or_default()
                            }
                            _ => Value::Unknown,
                        };
                    }
                    store_value(left, r.value.clone(), s, env);
                }
                r
            }
            "update_expression" => {
                if let Some(arg) = field(n, "argument")
                    && let Some(Value::Number(value)) = env.get_mut(text(arg, s))
                {
                    let delta = if text(n, s).contains("++") { 1 } else { -1 };
                    let old = *value;
                    *value = value.saturating_add(delta);
                    return Eval::value(Value::Number(
                        if text(n, s).trim_start().starts_with("++")
                            || text(n, s).trim_start().starts_with("--")
                        {
                            *value
                        } else {
                            old
                        },
                    ));
                }
                Eval::default()
            }
            "if_statement" | "ternary_expression" => {
                let condition = eval_field("condition", env, ctx);
                let branch = match condition.value.truth() {
                    Some(true) => Some("consequence"),
                    Some(false) => Some("alternative"),
                    _ => None,
                };
                if let Some(branch) = branch {
                    let mut r = eval_field(branch, env, ctx);
                    r.cost.add(condition.cost);
                    r
                } else {
                    let mut a_env = env.clone();
                    let mut b_env = env.clone();
                    let a = eval_field("consequence", &mut a_env, ctx);
                    let b = eval_field("alternative", &mut b_env, ctx);
                    invalidate_changed(env, &a_env);
                    invalidate_changed(env, &b_env);
                    let flow = if a.flow == b.flow {
                        a.flow
                    } else {
                        Flow::Maybe
                    };
                    let value = if a.value == b.value {
                        a.value
                    } else {
                        Value::Data
                    };
                    let mut cost = Estimate::choice(
                        a.cost,
                        b.cost,
                        "Data-dependent branch; costs cover both paths",
                    );
                    cost.add(condition.cost);
                    Eval {
                        cost,
                        value,
                        flow,
                        ..Eval::default()
                    }
                }
            }
            "else_clause" => n
                .named_child(0)
                .map(|n| self.eval(file, n, env, ctx))
                .unwrap_or_default(),
            "for_statement" => {
                let mut cost = eval_field("initializer", env, ctx).cost;
                for iteration in 0..=points::LOOP_LIMIT {
                    let condition = eval_field("condition", env, ctx);
                    cost.add(condition.cost);
                    match condition.value {
                        Value::Bool(false) => return Eval::cost(cost),
                        Value::Bool(true) if iteration < points::LOOP_LIMIT => {}
                        _ => {
                            let body = eval_field("body", &mut env.clone(), ctx);
                            cost.add(body.cost.unknown_repetitions());
                            return Eval::cost(cost);
                        }
                    }
                    let body = eval_field("body", env, ctx);
                    cost.add(body.cost);
                    if body.flow == Flow::Break {
                        return Eval::cost(cost);
                    }
                    if body.flow == Flow::Maybe {
                        return Eval {
                            cost: cost.unknown_repetitions(),
                            flow: Flow::Maybe,
                            ..Eval::default()
                        };
                    }
                    if !matches!(body.flow, Flow::Continue | Flow::Next) {
                        return Eval {
                            cost,
                            value: body.value,
                            flow: body.flow,
                            ..Eval::default()
                        };
                    }
                    cost.add(eval_field("increment", env, ctx).cost);
                }
                unreachable!()
            }
            "for_in_statement" => {
                let values = eval_field("right", env, ctx);
                let mut cost = values.cost;
                if let Value::Array(items) = values.value.clone()
                    && field(n, "operator").is_some_and(|n| text(n, s) == "of")
                    && items.len() <= points::LOOP_LIMIT
                {
                    for item in items {
                        if let Some(left) = field(n, "left") {
                            bind(left, item, s, env);
                        }
                        let r = eval_field("body", env, ctx);
                        cost.add(r.cost);
                        if r.flow == Flow::Break {
                            return Eval::cost(cost);
                        }
                        if r.flow == Flow::Maybe {
                            return Eval {
                                cost: cost.unknown_repetitions(),
                                flow: Flow::Maybe,
                                ..Eval::default()
                            };
                        }
                        if !matches!(r.flow, Flow::Continue | Flow::Next) {
                            return Eval {
                                cost,
                                value: r.value,
                                flow: r.flow,
                                ..Eval::default()
                            };
                        }
                    }
                    return Eval::cost(cost);
                }
                let mut loop_env = env.clone();
                if let Some(left) = field(n, "left") {
                    bind(
                        left,
                        match values.value {
                            Value::Sequence(v) => *v,
                            _ => Value::Data,
                        },
                        s,
                        &mut loop_env,
                    );
                }
                let body = eval_field("body", &mut loop_env, ctx);
                cost.add(body.cost.unknown_repetitions());
                invalidate_changed(env, &loop_env);
                Eval {
                    cost,
                    flow: if matches!(body.flow, Flow::Continue | Flow::Next | Flow::Break) {
                        Flow::Continue
                    } else {
                        Flow::Maybe
                    },
                    ..Eval::default()
                }
            }
            "while_statement" | "do_statement" => {
                let mut cost = Estimate::default();
                for i in 0..=points::LOOP_LIMIT {
                    let condition = if i == 0 && n.kind() == "do_statement" {
                        Eval::value(Value::Bool(true))
                    } else {
                        eval_field("condition", env, ctx)
                    };
                    cost.add(condition.cost);
                    if condition.value.truth() == Some(false) {
                        return Eval::cost(cost);
                    }
                    if condition.value.truth() != Some(true) || i == points::LOOP_LIMIT {
                        let mut loop_env = env.clone();
                        let body = eval_field("body", &mut loop_env, ctx);
                        cost.add(body.cost.unknown_repetitions());
                        invalidate_changed(env, &loop_env);
                        return Eval {
                            cost,
                            flow: if matches!(body.flow, Flow::Continue | Flow::Next | Flow::Break)
                            {
                                Flow::Continue
                            } else {
                                Flow::Maybe
                            },
                            ..Eval::default()
                        };
                    }
                    let r = eval_field("body", env, ctx);
                    cost.add(r.cost);
                    if r.flow == Flow::Break {
                        return Eval::cost(cost);
                    }
                    if r.flow == Flow::Maybe {
                        return Eval {
                            cost: cost.unknown_repetitions(),
                            flow: Flow::Maybe,
                            ..Eval::default()
                        };
                    }
                    if !matches!(r.flow, Flow::Continue | Flow::Next) {
                        return Eval {
                            cost,
                            value: r.value,
                            flow: r.flow,
                            ..Eval::default()
                        };
                    }
                }
                unreachable!()
            }
            "switch_statement" => {
                let discriminant = eval_field("value", env, ctx);
                let cases = field(n, "body").map(children).unwrap_or_default();
                let known = !matches!(
                    discriminant.value,
                    Value::Unknown | Value::Data | Value::Text
                );
                let chosen = cases
                    .iter()
                    .position(|case| {
                        field(*case, "value").is_some_and(|v| {
                            self.eval(file, v, env, ctx).value == discriminant.value
                        })
                    })
                    .or_else(|| cases.iter().position(|n| n.kind() == "switch_default"));
                let starts: Vec<_> = if known {
                    chosen.into_iter().collect()
                } else {
                    (0..cases.len()).collect()
                };
                let mut alternatives = vec![];
                if !known && !cases.iter().any(|n| n.kind() == "switch_default") {
                    alternatives.push(Eval::default());
                }
                for start in starts {
                    let mut branch_env = env.clone();
                    let mut result = Eval::default();
                    for case in cases.iter().skip(start) {
                        for statement in children(*case)
                            .into_iter()
                            .filter(|n| Some(*n) != field(*case, "value"))
                        {
                            let r = self.eval(file, statement, &mut branch_env, ctx);
                            result.cost.add(r.cost);
                            result.value = r.value;
                            result.flow = r.flow;
                            if result.flow != Flow::Continue {
                                break;
                            }
                        }
                        if result.flow != Flow::Continue {
                            break;
                        }
                    }
                    if result.flow == Flow::Break {
                        result.flow = Flow::Continue;
                    }
                    if known {
                        *env = branch_env;
                    } else {
                        invalidate_changed(env, &branch_env);
                    }
                    alternatives.push(result);
                }
                let mut result = alternatives.pop().unwrap_or_default();
                for other in alternatives {
                    result.cost =
                        Estimate::choice(result.cost, other.cost, "Runtime switch branch");
                    result.value = Value::Data;
                    if result.flow != other.flow {
                        result.flow = Flow::Maybe;
                    }
                }
                result.cost.add(discriminant.cost);
                result
            }
            "sequence_expression" => {
                let mut result = Eval::default();
                for child in children(n) {
                    let part = self.eval(file, child, env, ctx);
                    result.cost.add(part.cost);
                    result.value = part.value;
                    result.flow = part.flow;
                    if result.flow != Flow::Continue {
                        break;
                    }
                }
                result
            }
            "new_expression" => {
                let constructor = eval_field("constructor", env, ctx);
                let mut cost = constructor.cost;
                let mut args = vec![];
                for arg in field(n, "arguments").map(children).unwrap_or_default() {
                    let r = self.eval(file, arg, env, ctx);
                    cost.add(r.cost);
                    args.push(r.value);
                }
                if let Value::Class(class) = constructor.value {
                    let mut r = self.construct(&class, &args, ctx, 0);
                    r.cost.add(cost);
                    r
                } else if let Value::Builtin(name) = constructor.value {
                    if let Some(mut r) = self.platform_call(&name, &args, ctx) {
                        r.cost.add(cost);
                        r
                    } else {
                        cost.add(Estimate::unknown("Unresolved platform constructor"));
                        Eval::cost(cost)
                    }
                } else {
                    cost.add(Estimate::unknown(format!(
                        "Unresolved constructor at {file}:{}",
                        n.start_position().row + 1
                    )));
                    Eval::cost(cost)
                }
            }
            "call_expression" => self.call_eval(file, n, env, ctx),
            "try_statement" => {
                let mut body = eval_field("body", env, ctx);
                if body.flow == Flow::Use {
                    return body;
                }
                if let Some(handler) = field(n, "handler") {
                    let mut catch_env = env.clone();
                    if let Some(param) = field(handler, "parameter") {
                        bind(param, Value::Data, s, &mut catch_env);
                    }
                    let caught = field(handler, "body")
                        .map(|n| self.eval(file, n, &mut catch_env, ctx))
                        .unwrap_or_default();
                    let mut caught_cost = body
                        .cost
                        .clone()
                        .optional("Exception may interrupt the protected body");
                    caught_cost.add(caught.cost);
                    body.cost = Estimate::choice(
                        body.cost,
                        caught_cost,
                        "Exception-dependent control flow",
                    );
                    if body.flow != caught.flow {
                        body.flow = Flow::Maybe;
                    }
                    body.value = Value::Data;
                    invalidate_changed(env, &catch_env);
                }
                if let Some(finalizer) = field(n, "finalizer").and_then(|n| field(n, "body")) {
                    let r = self.eval(file, finalizer, env, ctx);
                    body.cost.add(r.cost);
                    if r.flow != Flow::Continue {
                        body.flow = r.flow;
                        body.value = r.value;
                    }
                }
                body
            }
            _ => {
                let mut cost = Estimate::default();
                for c in children(n) {
                    cost.add(self.eval(file, c, env, ctx).cost);
                }
                Eval::cost(cost.uncertain(&format!("Unsupported syntax: {}", n.kind())))
            }
        }
    }
    fn call_eval(&self, file: &str, n: Node, env: &mut Env, ctx: &mut Context) -> Eval {
        let s = &self.modules[file].source;
        let Some(function) = field(n, "function") else {
            return Eval::cost(Estimate::unknown("Unknown call"));
        };
        let function = normalize::untyped(function);
        let argument_nodes = field(n, "arguments").map(children).unwrap_or_default();
        // Browser time for concurrently awaited independent operations is a max,
        // never a sum credited as repeated sequential work.
        if matches!(
            crate::function_name(n, s).as_str(),
            "Promise.all" | "Promise.race" | "Promise.any" | "Promise.allSettled"
        ) && matches!(self.value(file,"Promise",env,ctx),Value::Builtin(name) if name=="Promise")
            && argument_nodes.first().is_some_and(|n| n.kind() == "array")
        {
            let mut cost = Estimate::default();
            let mut lower = 0;
            let mut points = 0;
            let mut estimated_points = 0;
            let mut upper = Some(0u64);
            let mut values = vec![];
            for arg in children(argument_nodes[0]) {
                let evaluated = self.eval(file, arg, env, ctx);
                values.push(if crate::function_name(n, s) == "Promise.allSettled" {
                    Value::settled()
                } else {
                    evaluated.value.resolved()
                });
                let c = evaluated.cost;
                upper = upper.zip(c.upper_bound_points).map(|(a, b)| a.max(b));
                points = points.max(c.points);
                estimated_points = estimated_points.max(c.estimated_points);
                lower = lower.max(c.lower_bound_points);
                cost.add(c);
            }
            cost.points = points;
            cost.estimated_points = estimated_points;
            cost.lower_bound_points = lower;
            cost.upper_bound_points = upper;
            if matches!(
                crate::function_name(n, s).as_str(),
                "Promise.race" | "Promise.any"
            ) && cost.points > 0
            {
                cost = cost
                    .uncertain("Racing promises may finish or overlap depending on runtime data");
            }
            return Eval {
                cost,
                value: Value::Promise(Box::new(Value::Array(values))),
                ..Eval::default()
            };
        }
        if crate::function_name(n, s)
            .strip_suffix(".step")
            .is_some_and(|name| self.provider(file, name, &mut BTreeSet::new()).is_some())
            && argument_nodes
                .last()
                .is_some_and(|n| matches!(n.kind(), "arrow_function" | "function_expression"))
        {
            let callback = *argument_nodes.last().unwrap();
            return self.invoke(&self.reference(file, callback), env, vec![], None, ctx);
        }
        let (receiver, method) = if function.kind() == "member_expression" {
            let object = field(function, "object")
                .map(|n| self.eval(file, n, env, ctx))
                .unwrap_or_default();
            let method = field(function, "property")
                .map(|n| text(n, s))
                .unwrap_or("");
            (Some(object), method)
        } else {
            (None, "")
        };
        let mut cost = Estimate::default();
        let mut args = vec![];
        for arg in argument_nodes {
            let r = self.eval(file, arg, env, ctx);
            cost.add(r.cost);
            args.push(r.value);
        }
        if let Some(mut receiver) = receiver {
            cost.add(receiver.cost);
            let previous_receiver = receiver.value.clone();
            if let Some(mut r) = self.value_call(&mut receiver.value, method, &args, ctx) {
                if receiver.value != previous_receiver
                    && let Some(object) = field(function, "object")
                {
                    store_mutation(object, receiver.value, s, env);
                }
                invalidate_call(env, &r);
                r.cost.add(cost);
                return r;
            }
            match receiver.value {
                Value::MissingDependency(module) => {
                    cost.add(Estimate::unknown(format!("Missing dependency: {module}")));
                    return Eval::cost(cost);
                }
                Value::Namespace(target) => {
                    if let Value::Function(r, closure) =
                        self.value(&target, method, &Env::new(), ctx)
                    {
                        let mut r = self.invoke(&r, &closure, args, None, ctx);
                        invalidate_call(env, &r);
                        r.cost.add(cost);
                        return r;
                    }
                }
                Value::Browser => {
                    if [
                        "locator",
                        "getByRole",
                        "getByText",
                        "getByLabel",
                        "getByTestId",
                        "getByPlaceholder",
                        "getByAltText",
                        "getByTitle",
                        "filter",
                        "nth",
                        "first",
                        "last",
                        "frameLocator",
                        "context",
                        "browser",
                        "mainFrame",
                        "asElement",
                        "on",
                        "once",
                        "off",
                        "removeListener",
                    ]
                    .contains(&method)
                    {
                        return Eval {
                            cost,
                            value: Value::Browser,
                            ..Eval::default()
                        };
                    }
                    if matches!(method, "frames" | "childFrames") {
                        return Eval {
                            cost,
                            value: Value::Sequence(Box::new(Value::Browser)),
                            ..Eval::default()
                        };
                    }
                    if method == "contentFrame" {
                        cost.add(Estimate::operation("browser-read", points::INTERACTION));
                        return Eval {
                            cost,
                            value: Value::Promise(Box::new(Value::Browser)),
                            ..Eval::default()
                        };
                    }
                    if method == "url" {
                        return Eval {
                            cost,
                            value: Value::Text,
                            ..Eval::default()
                        };
                    }
                    if matches!(method, "newContext" | "newPage") {
                        cost.add(Estimate::operation("browser-create", points::INTERACTION));
                        return Eval {
                            cost,
                            value: Value::Promise(Box::new(Value::Browser)),
                            ..Eval::default()
                        };
                    }
                    if method == "cookies" {
                        cost.add(Estimate::operation("browser-read", points::INTERACTION));
                        return Eval {
                            cost,
                            value: Value::Promise(Box::new(Value::Sequence(Box::new(Value::Data)))),
                            ..Eval::default()
                        };
                    }
                    if method == "all" {
                        cost.add(Estimate::operation("browser-read", points::INTERACTION));
                        return Eval {
                            cost,
                            value: Value::Promise(Box::new(Value::Sequence(Box::new(
                                Value::Browser,
                            )))),
                            ..Eval::default()
                        };
                    }
                    let operation = if ["goto", "reload", "goBack", "goForward"].contains(&method) {
                        Some(("navigation", points::NAVIGATION))
                    } else if [
                        "click",
                        "dblclick",
                        "fill",
                        "press",
                        "type",
                        "check",
                        "uncheck",
                        "setChecked",
                        "selectOption",
                        "hover",
                        "focus",
                        "blur",
                        "tap",
                        "scrollIntoViewIfNeeded",
                    ]
                    .contains(&method)
                    {
                        Some(("interaction", points::INTERACTION))
                    } else if [
                        "waitFor",
                        "waitForSelector",
                        "waitForLoadState",
                        "waitForURL",
                        "waitForFunction",
                        "waitForResponse",
                        "waitForRequest",
                    ]
                    .contains(&method)
                    {
                        Some(("wait", points::WAIT))
                    } else if [
                        "evaluate",
                        "evaluateHandle",
                        "title",
                        "count",
                        "textContent",
                        "innerText",
                        "inputValue",
                        "getAttribute",
                        "isVisible",
                        "isHidden",
                        "isDisabled",
                        "isEditable",
                        "allInnerTexts",
                        "$eval",
                        "$$eval",
                        "isEnabled",
                        "isChecked",
                        "addCookies",
                        "storageState",
                        "content",
                        "allTextContents",
                        "innerHTML",
                        "close",
                        "dispose",
                        "route",
                        "unroute",
                        "screenshot",
                    ]
                    .contains(&method)
                    {
                        Some(("browser-read", points::INTERACTION))
                    } else {
                        None
                    };
                    if let Some((name, value)) = operation {
                        cost.add(Estimate::operation(name, value));
                        return Eval {
                            cost,
                            value: Value::Promise(Box::new(
                                if name == "navigation"
                                    || matches!(method, "waitForResponse" | "waitForRequest")
                                {
                                    Value::Response
                                } else if method == "evaluateHandle" {
                                    Value::Browser
                                } else if matches!(method, "allInnerTexts" | "allTextContents") {
                                    Value::Sequence(Box::new(Value::Text))
                                } else {
                                    Value::Data
                                },
                            )),
                            ..Eval::default()
                        };
                    }
                    if method == "waitForTimeout"
                        && let Some(Value::Number(ms)) = args.first()
                        && *ms >= 0
                    {
                        cost.add(Estimate::operation(
                            "explicit-wait",
                            (*ms as f64 / crate::baseline::PLAYWRIGHT_BRANCHING.unit_ms).ceil()
                                as u64,
                        ));
                        return Eval::cost(cost);
                    }
                    cost.add(Estimate::unknown(format!(
                        "Unresolved browser operation: {method}"
                    )));
                    return Eval::cost(cost);
                }
                Value::Request
                    if ["get", "post", "put", "patch", "delete", "fetch", "head"]
                        .contains(&method) =>
                {
                    cost.add(runtime::request_cost(&args));
                    return Eval {
                        cost,
                        value: Value::Promise(Box::new(Value::Response)),
                        ..Eval::default()
                    };
                }
                Value::Assertion(browser) => {
                    if method.starts_with("to") {
                        if browser {
                            cost.add(Estimate::operation("assertion", points::ASSERTION));
                        }
                        return Eval {
                            cost,
                            value: if browser {
                                Value::Promise(Box::new(Value::Data))
                            } else {
                                Value::Data
                            },
                            ..Eval::default()
                        };
                    }
                }
                Value::RetryAssertion(r, closure) if method.starts_with("to") => {
                    let mut result = self.invoke(&r, &closure, vec![], None, ctx);
                    result.cost.complete = false;
                    result.cost.upper_bound_points = None;
                    result
                        .cost
                        .reasons
                        .push("Assertion callback retry count depends on runtime data".into());
                    result.cost.add(cost);
                    result.value = Value::Promise(Box::new(Value::Data));
                    invalidate_call(env, &result);
                    return result;
                }
                Value::Instance(class, fields) => {
                    if let Some(member) = self.class_method(&class, method, 0) {
                        let mut r = self.invoke(
                            &member,
                            &Env::new(),
                            args,
                            Some(Value::Instance(class, fields)),
                            ctx,
                        );
                        if let (Some(this), Some(object)) =
                            (r.this.take(), field(function, "object"))
                        {
                            store_mutation(object, this, s, env);
                        }
                        invalidate_call(env, &r);
                        r.cost.add(cost);
                        return r;
                    }
                }
                Value::Object(fields) => {
                    if let Some(Value::Function(reference, closure)) = fields.get(method) {
                        let mut r = self.invoke(reference, closure, args, None, ctx);
                        invalidate_call(env, &r);
                        r.cost.add(cost);
                        return r;
                    }
                }
                _ => {}
            }
        } else {
            if text(function, s) == "super"
                && let Some(Value::Instance(class, _)) = env.get("this").cloned()
                && let Some(base) = self.class_base(&class)
            {
                let mut r = self.construct(&base, &args, ctx, 0);
                if let Value::Instance(_, fields) = r.value {
                    env.insert("this".into(), Value::Instance(class.clone(), fields));
                    r.cost.add(self.initialize_fields(&class, env, ctx));
                    self.parameter_properties(&class, env);
                }
                r.value = Value::Undefined;
                invalidate_call(env, &r);
                r.cost.add(cost);
                return r;
            }
            let target = self.eval(file, function, env, ctx);
            cost.add(target.cost);
            match target.value {
                Value::MissingDependency(module) => {
                    cost.add(Estimate::unknown(format!("Missing dependency: {module}")));
                    return Eval::cost(cost);
                }
                Value::Builtin(name) => {
                    if let Some(mut r) = self.platform_call(&name, &args, ctx) {
                        invalidate_call(env, &r);
                        r.cost.add(cost);
                        return r;
                    }
                }
                Value::Expect => {
                    return Eval {
                        cost,
                        value: if let Some(Value::Function(r, closure)) = args.first() {
                            Value::RetryAssertion(r.clone(), closure.clone())
                        } else {
                            Value::Assertion(
                                args.first().is_some_and(|v| matches!(v, Value::Browser)),
                            )
                        },
                        ..Eval::default()
                    };
                }
                Value::Use => {
                    return Eval {
                        cost,
                        value: args.into_iter().next().unwrap_or_default(),
                        flow: Flow::Use,
                        ..Eval::default()
                    };
                }
                Value::Function(r, closure) => {
                    let mut r = self.invoke(&r, &closure, args, None, ctx);
                    invalidate_call(env, &r);
                    r.cost.add(cost);
                    return r;
                }
                _ => {}
            }
        }
        // An unknown function may mutate argument objects or an escaped closure.
        // Do not reuse concrete loop bounds after that call.
        for value in env.values_mut() {
            *value = value.widen();
        }
        cost.add(Estimate::unknown(format!(
            "Unresolved call at {file}:{}",
            n.start_position().row + 1
        )));
        Eval::cost(cost)
    }
}
#[derive(Default)]
struct FixtureCosts {
    repeated: Estimate,
    worker: Estimate,
}
#[derive(Clone)]
struct Fixture {
    reference: Reference,
    worker: bool,
    auto: bool,
    order: usize,
}
impl Project {
    fn provider(
        &self,
        file: &str,
        name: &str,
        seen: &mut BTreeSet<String>,
    ) -> Option<BTreeMap<String, Fixture>> {
        let key = format!("{file}:{name}");
        if !seen.insert(key) || seen.len() > points::CALL_LIMIT {
            return None;
        }
        if self
            .external(file, name, 0)
            .is_some_and(|(module, export)| module == "@playwright/test" && export == "test")
        {
            return Some(BTreeMap::new());
        }
        let r = self.symbol(file, name, 0)?;
        let n = self.node(&r)?;
        self.provider_node(&r.file, n, seen)
    }
    fn provider_node(
        &self,
        file: &str,
        n: Node,
        seen: &mut BTreeSet<String>,
    ) -> Option<BTreeMap<String, Fixture>> {
        if seen.len() > points::CALL_LIMIT {
            return None;
        }
        let s = &self.modules[file].source;
        if n.kind() == "identifier" {
            return self.provider(file, text(n, s), seen);
        }
        let function = field(n, "function")?;
        if function.kind() != "member_expression"
            || text(field(function, "property")?, s) != "extend"
        {
            return None;
        }
        let base = field(function, "object")?;
        let mut fixtures = if base.kind() == "call_expression" {
            seen.insert(format!("{file}:{}", base.start_byte()));
            self.provider_node(file, base, seen)?
        } else {
            self.provider(file, text(base, s), seen)?
        };
        let object = children(field(n, "arguments")?)
            .into_iter()
            .find(|n| n.kind() == "object")?;
        for pair in children(object) {
            if pair.kind() != "pair" {
                return None;
            }
            let key = field(pair, "key")?;
            let value = field(pair, "value")?;
            let mut worker = false;
            let mut auto = false;
            let value = if value.kind() == "array" {
                let list = children(value);
                for options in list.iter().skip(1).flat_map(|n| children(*n)) {
                    if let (Some(k), Some(v)) = (field(options, "key"), field(options, "value")) {
                        worker |= text(k, s) == "scope"
                            && normalize::string(v, s).as_deref() == Some("worker");
                        auto |= text(k, s) == "auto" && text(v, s) == "true";
                    }
                }
                *list.first()?
            } else {
                value
            };
            let name = normalize::string(key, s).unwrap_or_else(|| text(key, s).into());
            let order = fixtures
                .get(&name)
                .map_or(fixtures.len(), |fixture| fixture.order);
            fixtures.insert(
                name,
                Fixture {
                    reference: self.reference(file, value),
                    worker,
                    auto,
                    order,
                },
            );
        }
        Some(fixtures)
    }
    pub fn test_aliases(&self, file: &str) -> BTreeMap<String, String> {
        let mut names: BTreeSet<String> = self.imports(file).into_keys().collect();
        let m = &self.modules[file];
        for n in children(m.tree.root_node()) {
            let n = field(n, "declaration").unwrap_or(n);
            if matches!(n.kind(), "lexical_declaration" | "variable_declaration") {
                for d in children(n) {
                    if let Some(name) = field(d, "name") {
                        names.insert(text(name, &m.source).into());
                    }
                }
            }
        }
        names
            .into_iter()
            .filter(|name| self.provider(file, name, &mut BTreeSet::new()).is_some())
            .map(|name| {
                let identity = self
                    .imports(file)
                    .get(&name)
                    .map(|(m, e)| format!("{m}:{e}"))
                    .unwrap_or_else(|| format!("local:{name}"));
                (name, identity)
            })
            .collect()
    }
    fn fixture_value(
        &self,
        name: &str,
        fixtures: &BTreeMap<String, Fixture>,
        values: &mut Env,
        visiting: &mut BTreeSet<String>,
        costs: &mut FixtureCosts,
        ctx: &mut Context,
    ) -> Value {
        if let Some(v) = values.get(name) {
            return v.clone();
        }
        let Some(fixture) = fixtures.get(name) else {
            return builtin(name);
        };
        if !visiting.insert(name.into()) {
            costs
                .repeated
                .add(Estimate::unknown("Fixture dependency cycle"));
            return Value::Unknown;
        }
        let r = &fixture.reference;
        let node = self.node(r).unwrap();
        let s = &self.modules[&r.file].source;
        let result = if matches!(node.kind(), "arrow_function" | "function_expression") {
            let dependencies = params(node)
                .first()
                .map(|n| names(*n, s))
                .unwrap_or_default();
            let mut input = Env::new();
            for dependency in dependencies {
                let v = self.fixture_value(&dependency, fixtures, values, visiting, costs, ctx);
                input.insert(dependency, v);
            }
            self.invoke(
                r,
                &Env::new(),
                vec![Value::Object(input), Value::Use, Value::TestInfo],
                None,
                ctx,
            )
        } else {
            self.eval(&r.file, node, &mut Env::new(), ctx)
        };
        visiting.remove(name);
        if fixture.worker {
            costs.worker.add(result.cost);
        } else {
            costs.repeated.add(result.cost);
        }
        values.insert(name.into(), result.value.clone());
        result.value
    }
    pub fn assess(&self, test: &mut Test, tainted_libraries: &mut BTreeSet<String>) {
        let mut ctx = Context {
            tainted_libraries: tainted_libraries.clone(),
            ..Context::default()
        };
        let mut env = test.collection_bindings.0.clone();
        let aliases = self.test_aliases(&test.file);
        let alias = aliases
            .iter()
            .find(|(_, identity)| *identity == &test.fixture)
            .map(|(name, _)| name.clone());
        let mut costs = FixtureCosts::default();
        let module = &self.modules[&test.file];
        let callback = module
            .tree
            .root_node()
            .named_descendant_for_byte_range(test.callback_start, test.callback_end);
        let hooks: Vec<_> = test
            .steps
            .iter()
            .filter(|s| s.kind == "beforeEach")
            .filter_map(|step| {
                module
                    .tree
                    .root_node()
                    .named_descendant_for_byte_range(step.start, step.end)
                    .and_then(|n| n.parent())
            })
            .collect();
        let callbacks: Vec<_> = callback.into_iter().chain(hooks.iter().copied()).collect();
        let mut values = Env::new();
        if let Some(fixtures) = alias
            .as_deref()
            .and_then(|name| self.provider(&test.file, name, &mut BTreeSet::new()))
        {
            let mut targets: BTreeSet<_> = callbacks
                .iter()
                .flat_map(|cb| {
                    params(*cb)
                        .first()
                        .map(|n| names(*n, &module.source))
                        .unwrap_or_default()
                })
                .chain(
                    fixtures
                        .iter()
                        .filter(|(_, f)| f.auto)
                        .map(|(name, _)| name.clone()),
                )
                .collect();
            if targets.contains("page") {
                for name in ["storageState", "context", "page", "baseURL"] {
                    if fixtures.contains_key(name) {
                        targets.insert(name.into());
                    }
                }
            }
            for name in targets {
                let value = self.fixture_value(
                    &name,
                    &fixtures,
                    &mut values,
                    &mut BTreeSet::new(),
                    &mut costs,
                    &mut ctx,
                );
                env.insert(name, value);
            }
            if let Some(callback) = callback {
                let input = Value::Object(env.clone());
                for (i, param) in params(callback).into_iter().enumerate() {
                    bind(
                        param,
                        if i == 0 {
                            input.clone()
                        } else {
                            Value::TestInfo
                        },
                        &module.source,
                        &mut env,
                    );
                }
            }
        } else if test.fixture != "@playwright/test:test" {
            costs
                .repeated
                .add(Estimate::unknown("Unresolved fixture provider"));
        }
        // beforeAll establishes receiver types for descendant tests. Its work
        // runs once per worker and is never credited as reusable test setup.
        let mut scopes = vec![];
        let mut ancestor = callback.and_then(|n| n.parent());
        while let Some(node) = ancestor {
            if matches!(node.kind(), "program" | "statement_block") {
                scopes.push(node);
            }
            ancestor = node.parent();
        }
        for scope in scopes.into_iter().rev() {
            for statement in children(scope) {
                let call = if statement.kind() == "expression_statement" {
                    children(statement).into_iter().next().unwrap_or(statement)
                } else {
                    statement
                };
                if call.kind() != "call_expression" {
                    continue;
                }
                let name = crate::function_name(call, &module.source);
                let Some(alias) = name.strip_suffix(".beforeAll") else {
                    continue;
                };
                if self
                    .provider(&test.file, alias, &mut BTreeSet::new())
                    .is_none()
                {
                    continue;
                }
                let hook = field(call, "arguments").and_then(|n| {
                    children(n)
                        .into_iter()
                        .find(|n| matches!(n.kind(), "arrow_function" | "function_expression"))
                });
                if let Some(hook) = hook {
                    let mut inputs = values.clone();
                    for dependency in params(hook)
                        .first()
                        .map(|n| names(*n, &module.source))
                        .unwrap_or_default()
                    {
                        inputs
                            .entry(dependency.clone())
                            .or_insert_with(|| builtin(&dependency));
                    }
                    let result = self.invoke(
                        &self.reference(&test.file, hook),
                        &env,
                        vec![Value::Object(inputs), Value::TestInfo],
                        None,
                        &mut ctx,
                    );
                    costs.worker.add(result.cost);
                    env.extend(
                        result
                            .writes
                            .into_iter()
                            .map(|(name, value)| (name, value.widen())),
                    );
                }
            }
        }
        if test.reasons.iter().any(|r| r.starts_with("use requires")) {
            costs.repeated.add(Estimate::unknown(
                "Native fixture overrides require runtime inputs",
            ));
        }
        costs.repeated.finalize();
        costs.worker.finalize();
        test.fixture_estimate = Some(costs.repeated.clone());
        test.worker_estimate = Some(costs.worker);
        let module = &self.modules[&test.file];
        let callback_body = callback.and_then(|n| field(n, "body"));
        if let Some(body) = callback_body {
            for function in children(body)
                .into_iter()
                .filter(|n| n.kind() == "function_declaration")
            {
                if let Some(name) = field(function, "name") {
                    env.insert(
                        text(name, &module.source).into(),
                        Value::Function(
                            self.reference(&test.file, function),
                            Box::new(env.clone()),
                        ),
                    );
                }
            }
        }
        let mut prior_exit = Flow::Continue;
        for step in &mut test.steps {
            if let Some(body) = callback_body {
                ctx.lexical_envs
                    .insert((test.file.clone(), body.start_byte()), env.clone());
            }
            let Some(node) = module
                .tree
                .root_node()
                .named_descendant_for_byte_range(step.start, step.end)
            else {
                continue;
            };
            let mut result = if step.kind == "beforeEach" {
                if let Some(cb) = node.parent() {
                    let mut inputs = env.clone();
                    inputs.extend(values.clone());
                    let result = self.invoke(
                        &self.reference(&test.file, cb),
                        &env,
                        vec![Value::Object(inputs), Value::TestInfo],
                        None,
                        &mut ctx,
                    );
                    env.extend(result.writes.clone());
                    result
                } else {
                    Eval::cost(Estimate::unknown("Unresolved hook callback"))
                }
            } else {
                self.eval(&test.file, node, &mut env, &mut ctx)
            };
            if prior_exit == Flow::Maybe {
                result.cost = result
                    .cost
                    .optional("A prior test branch may exit before this step");
            } else if prior_exit != Flow::Continue {
                result.cost = Estimate::default();
            }
            if step.kind != "beforeEach" && prior_exit == Flow::Continue {
                prior_exit = result.flow;
            }
            result.cost.finalize();
            step.action_units = Some(result.cost.estimated_points);
            step.estimate = Some(result.cost.clone());
            costs.repeated.add(result.cost);
        }
        costs.repeated.finalize();
        test.estimate = Some(costs.repeated);
        tainted_libraries.extend(ctx.tainted_libraries);
        test.scope =
            hash(serde_json::to_vec(&(&test.context_identity, self.context(&test.file))).unwrap());
    }
}
pub fn summary(manifest: &Manifest) -> crate::Result<serde_json::Value> {
    let mut stages = vec![];
    let mut parents = vec![];
    let mut scopes = BTreeSet::new();
    for t in &manifest.tests {
        if scopes.insert(t.scope.clone()) {
            stages.push(crate::cost::Stage {
                id: format!("root-{}", &t.scope[..20]),
                parent: None,
                checkpoint: false,
                units: t.fixture_estimate.as_ref().map(|e| e.estimated_points),
            });
        }
    }
    for cp in &manifest.checkpoints {
        let test = manifest
            .tests
            .iter()
            .find(|t| t.id == cp.representative)
            .unwrap();
        let parent = cp
            .parent
            .as_ref()
            .and_then(|id| manifest.checkpoints.iter().find(|p| &p.id == id));
        let units = if cp.depth == 0 {
            Some(0)
        } else {
            test.steps[parent.map(|p| p.depth).unwrap_or(0)..cp.depth]
                .iter()
                .try_fold(0u64, |total, s| total.checked_add(s.action_units?))
        };
        stages.push(crate::cost::Stage {
            id: cp.id.clone(),
            parent: Some(
                parent
                    .map(|p| p.id.clone())
                    .unwrap_or_else(|| format!("root-{}", &test.scope[..20])),
            ),
            checkpoint: true,
            units,
        });
    }
    for id in &manifest.schedule {
        let t = manifest.tests.iter().find(|t| &t.id == id).unwrap();
        parents.push(
            manifest
                .checkpoints
                .iter()
                .filter(|c| c.consumers.contains(id))
                .max_by_key(|c| c.depth)
                .map(|c| c.id.clone())
                .unwrap_or_else(|| format!("root-{}", &t.scope[..20])),
        );
    }
    let input = crate::cost::Input {
        baseline: crate::baseline::Baseline::default(),
        stages,
        parents,
        max_checkpoints_per_test: crate::cost::checkpoint_limit(),
    };
    let cost_input = serde_json::to_value(&input).map_err(|e| e.to_string())?;
    let plan = crate::cost::select(input)?;
    let baseline = &*crate::baseline::PLAYWRIGHT_BRANCHING;
    let candidates:Vec<_>=manifest.checkpoints.iter().map(|cp| {
        let test=manifest.tests.iter().find(|t| t.id==cp.representative).unwrap();
        let mut estimate=test.fixture_estimate.clone().unwrap_or_else(||Estimate::unknown("Missing fixture estimate"));
        for step in &test.steps[..cp.depth] { estimate.add(step.estimate.clone().unwrap_or_else(||Estimate::unknown("Missing statement estimate"))); }
        estimate.finalize();
        let reuses=cp.consumers.len().saturating_sub(1) as f64;
        // Even with all shared backend costs amortized away, this prefix must
        // save more than capture/release and its own restores. This gives a
        // useful rejection test without pretending uncertain work is free.
        let variable_ms=(baseline.capture_ms+baseline.release_ms+reuses*baseline.restore_ms)*baseline.overhead_multiplier*(1.0+baseline.overhead_margin);
        let classification=if plan.selected.contains(&cp.id) { "estimated-saving" }
          else if reuses>0.0 && estimate.upper_bound_points.is_some_and(|upper| upper as f64*baseline.unit_ms*reuses<=variable_ms) { "below-variable-cost" }
          else if estimate.estimated_points as f64*baseline.unit_ms*reuses<=variable_ms { "estimated-below-variable-cost" }
          else { "shared-overhead-not-recovered" };
        serde_json::json!({"id":cp.id,"consumers":cp.consumers.len(),"lowerBoundPoints":estimate.lower_bound_points,"upperBoundPoints":estimate.upper_bound_points,
          "estimatedPoints":estimate.estimated_points,"estimatedPrefixMs":estimate.estimated_points as f64*baseline.unit_ms,
          "confidence":estimate.confidence,"assumptions":estimate.assumptions,
          "estimatedMinimumPrefixMs":estimate.lower_bound_points as f64*baseline.unit_ms,"estimatedMaximumPrefixMs":estimate.upper_bound_points.map(|p|p as f64*baseline.unit_ms),
          "classification":classification,"analysisComplete":estimate.analysis_complete,"issues":estimate.issues,"reasons":estimate.reasons})
    }).collect();
    let statements: Vec<_> = manifest
        .tests
        .iter()
        .flat_map(|t| t.steps.iter().filter_map(|s| s.estimate.as_ref()))
        .collect();
    let analyzed = statements.iter().filter(|e| e.analysis_complete).count();
    let exact = statements.iter().filter(|e| e.complete).count();
    let fixture_gaps = manifest
        .tests
        .iter()
        .filter(|t| {
            t.fixture_estimate
                .as_ref()
                .is_none_or(|e| !e.analysis_complete)
        })
        .count();
    let worker_gaps = manifest
        .tests
        .iter()
        .filter(|t| {
            t.worker_estimate
                .as_ref()
                .is_none_or(|e| !e.analysis_complete)
        })
        .count();
    let analysis = serde_json::json!({"status":if analyzed==statements.len()&&fixture_gaps==0&&worker_gaps==0&&manifest.diagnostics.is_empty() {"complete"}else{"partial"},"totalStatements":statements.len(),"analyzedStatements":analyzed,"exactStatements":exact,"runtimeDependentStatements":analyzed.saturating_sub(exact),"fixturesWithGaps":fixture_gaps,"workersWithGaps":worker_gaps,"collectionComplete":manifest.diagnostics.is_empty(),"collectionDiagnostics":manifest.diagnostics.len()});
    Ok(
        serde_json::json!({"version":points::VERSION,"boundsVersion":1,"weights":points::weights(),"costBasis":"approximate-operation-points", "analysis":analysis,"runtimeEligibility":"Cost selection alone does not authorize restoring JavaScript state", "candidates":candidates, "costInput":cost_input, "costPlan":plan}),
    )
}
