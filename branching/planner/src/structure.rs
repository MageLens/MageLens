// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

use crate::{
    Test, children, field, hash, normalize,
    project::{Project, Reference},
    text,
};
use std::collections::{BTreeMap, BTreeSet};
use tree_sitter::Node;
mod collection;
mod restoration;
pub(crate) use collection::Bindings;
const CALL_LIMIT: usize = 64;
const LOOP_LIMIT: usize = 1000;
type Env = BTreeMap<String, Value>;
#[derive(Clone, Debug, Default, PartialEq)]
enum Value {
    #[default]
    Unknown,
    Json(serde_json::Value),
    Object(Env),
    Array(Vec<Value>),
    String(String),
    Number(i64),
    Function(Reference, Env),
    Class(Reference),
    Expect,
    Undefined,
    Builtin(String),
}
impl Value {
    fn from_json(v: &serde_json::Value) -> Self {
        match v {
            serde_json::Value::String(v) => Self::String(v.clone()),
            serde_json::Value::Object(v) => Self::Object(
                v.iter()
                    .map(|(k, v)| (k.clone(), Self::from_json(v)))
                    .collect(),
            ),
            serde_json::Value::Array(v) => Self::Array(v.iter().map(Self::from_json).collect()),
            _ => Self::Json(v.clone()),
        }
    }
    fn json(&self) -> Option<serde_json::Value> {
        Some(match self {
            Self::Json(v) => v.clone(),
            Self::Object(v) => serde_json::Value::Object(
                v.iter()
                    .map(|(k, v)| Some((k.clone(), v.json()?)))
                    .collect::<Option<_>>()?,
            ),
            Self::String(v) => v.clone().into(),
            Self::Number(v) => (*v).into(),
            Self::Array(v) => {
                serde_json::Value::Array(v.iter().map(Self::json).collect::<Option<_>>()?)
            }
            _ => return None,
        })
    }
}
#[derive(Default)]
struct Context {
    stack: BTreeSet<String>,
}
struct Eval {
    value: Value,
}
fn params(n: Node) -> Vec<Node> {
    field(n, "parameters")
        .map(children)
        .unwrap_or_else(|| field(n, "parameter").into_iter().collect())
}
fn pattern(n: Node) -> Node {
    if n.kind() == "assignment_pattern" {
        return field(n, "left").unwrap_or(n);
    }
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
fn bind(n: Node, value: Value, source: &str, env: &mut Env) {
    let n = pattern(n);
    match n.kind() {
        "identifier" | "shorthand_property_identifier_pattern" => {
            env.insert(text(n, source).into(), value);
        }
        "array_pattern" => {
            if let Value::Array(v) = value {
                for (n, v) in children(n).into_iter().zip(v) {
                    bind(n, v, source, env);
                }
            }
        }
        "object_pattern" => {
            if let Value::Object(v) = value {
                for child in children(n) {
                    let key = field(child, "key").unwrap_or(child);
                    let target = field(child, "value").unwrap_or(child);
                    if let Some(v) = v.get(text(key, source)) {
                        bind(target, v.clone(), source, env);
                    }
                }
            }
        }
        _ => {}
    }
}
impl Project {
    fn value(&self, file: &str, name: &str, env: &Env, ctx: &mut Context) -> Value {
        if let Some(v) = env.get(name) {
            return v.clone();
        }
        if self
            .external(file, name, 0)
            .is_some_and(|(m, e)| m == "@playwright/test" && e == "expect")
        {
            return Value::Expect;
        }
        if name == "undefined" {
            return Value::Undefined;
        }
        if !self.imports(file).contains_key(name)
            && self.declaration(file, name).is_none()
            && [
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
            .contains(&name)
        {
            return Value::Builtin(name.into());
        }
        if let Some((module, _)) = self.imports(file).get(name) {
            if let Some(target) = self.resolve_import(file, name, module) {
                if let Some(v) = self.data.get(&target) {
                    return Value::from_json(v);
                }
            }
        }
        let Some(r) = self.symbol(file, name, 0) else {
            return Value::Unknown;
        };
        let key = format!("{}:{}", r.file, r.start);
        if ctx.stack.len() >= CALL_LIMIT || !ctx.stack.insert(key.clone()) {
            return Value::Unknown;
        }
        let value = self
            .node(&r)
            .map(|n| self.eval(&r.file, n, &mut Env::new(), ctx).value)
            .unwrap_or_default();
        ctx.stack.remove(&key);
        value
    }
    fn eval(&self, file: &str, node: Node, env: &mut Env, ctx: &mut Context) -> Eval {
        let n = normalize::untyped(node);
        let source = &self.modules[file].source;
        let value = match n.kind() {
            "identifier" | "shorthand_property_identifier" => {
                self.value(file, text(n, source), env, ctx)
            }
            "string" => normalize::string(n, source)
                .map(Value::String)
                .unwrap_or_default(),
            "number" => text(n, source)
                .parse::<i64>()
                .map(Value::Number)
                .unwrap_or_default(),
            "true" => Value::Json(true.into()),
            "false" => Value::Json(false.into()),
            "null" => Value::Json(serde_json::Value::Null),
            "array" => Value::Array(
                children(n)
                    .into_iter()
                    .map(|n| self.eval(file, n, env, ctx).value)
                    .collect(),
            ),
            "object" => {
                let mut map = Env::new();
                for pair in children(n) {
                    let key = field(pair, "key").unwrap_or(pair);
                    let val = field(pair, "value").unwrap_or(pair);
                    map.insert(
                        normalize::string(key, source).unwrap_or_else(|| text(key, source).into()),
                        self.eval(file, val, env, ctx).value,
                    );
                }
                Value::Object(map)
            }
            "member_expression" | "subscript_expression" => {
                let object = field(n, "object").map(|n| self.eval(file, n, env, ctx).value);
                let key = field(n, "property")
                    .map(|n| text(n, source).to_string())
                    .or_else(|| {
                        field(n, "index")
                            .and_then(|n| self.eval(file, n, env, ctx).value.json())
                            .map(|v| {
                                v.as_str()
                                    .map(str::to_string)
                                    .unwrap_or_else(|| v.to_string())
                            })
                    });
                match (object, key) {
                    (Some(Value::Object(v)), Some(k)) => v.get(&k).cloned().unwrap_or_default(),
                    (Some(Value::Array(v)), Some(k)) => {
                        if k == "length" {
                            Value::Number(v.len() as i64)
                        } else {
                            k.parse::<usize>()
                                .ok()
                                .and_then(|i| v.get(i))
                                .cloned()
                                .unwrap_or_default()
                        }
                    }
                    (Some(Value::Class(r)), Some(k)) => self
                        .node(&r)
                        .and_then(|n| field(n, "body"))
                        .and_then(|body| {
                            children(body).into_iter().find(|n| {
                                field(*n, "property")
                                    .or_else(|| field(*n, "name"))
                                    .is_some_and(|p| text(p, &self.modules[&r.file].source) == k)
                            })
                        })
                        .and_then(|n| field(n, "value"))
                        .map(|n| self.eval(&r.file, n, &mut Env::new(), ctx).value)
                        .unwrap_or_default(),
                    _ => Value::Unknown,
                }
            }
            "call_expression" => {
                let name = crate::function_name(n, source);
                let args = field(n, "arguments").map(children).unwrap_or_default();
                if ["Object.freeze", "Object.seal"].contains(&name.as_str()) {
                    args.first()
                        .map(|n| self.eval(file, *n, env, ctx).value)
                        .unwrap_or_default()
                } else if ["Object.entries", "Object.values", "Object.keys"]
                    .contains(&name.as_str())
                {
                    match args.first().map(|n| self.eval(file, *n, env, ctx).value) {
                        Some(Value::Object(v)) => Value::Array(
                            v.into_iter()
                                .map(|(k, v)| match name.as_str() {
                                    "Object.entries" => Value::Array(vec![Value::String(k), v]),
                                    "Object.keys" => Value::String(k),
                                    _ => v,
                                })
                                .collect(),
                        ),
                        _ => Value::Unknown,
                    }
                } else if name == "Array.from" {
                    let input = args.first().map(|n| self.eval(file, *n, env, ctx).value);
                    let values = match input {
                        Some(Value::Array(v)) => Some(v),
                        Some(Value::Object(v)) => v
                            .get("length")
                            .and_then(Value::json)
                            .and_then(|v| v.as_u64())
                            .filter(|n| *n <= LOOP_LIMIT as u64)
                            .map(|n| {
                                (0..n)
                                    .map(|i| {
                                        v.get(&i.to_string()).cloned().unwrap_or(Value::Undefined)
                                    })
                                    .collect()
                            }),
                        _ => None,
                    };
                    if let Some(values) = values {
                        if let Some(cb) = args.get(1).filter(|n| {
                            matches!(n.kind(), "arrow_function" | "function_expression")
                        }) {
                            let parameters = params(*cb);
                            let body = field(*cb, "body");
                            Value::Array(
                                values
                                    .into_iter()
                                    .enumerate()
                                    .map(|(i, v)| {
                                        let mut local = env.clone();
                                        for (n, v) in
                                            parameters.iter().zip([v, Value::Number(i as i64)])
                                        {
                                            bind(*n, v, source, &mut local);
                                        }
                                        body.map(|n| self.eval(file, n, &mut local, ctx).value)
                                            .unwrap_or_default()
                                    })
                                    .collect(),
                            )
                        } else {
                            Value::Array(values)
                        }
                    } else {
                        Value::Unknown
                    }
                } else {
                    Value::Unknown
                }
            }
            "template_string" => {
                let mut result = String::new();
                let mut valid = true;
                for child in children(n) {
                    if child.kind() == "string_fragment" {
                        result.push_str(text(child, source));
                    } else if let Some(expr) = child.named_child(0) {
                        match self.eval(file, expr, env, ctx).value.json() {
                            Some(v) => result.push_str(
                                &v.as_str()
                                    .map(str::to_string)
                                    .unwrap_or_else(|| v.to_string()),
                            ),
                            None => valid = false,
                        }
                    }
                }
                if valid {
                    Value::String(result)
                } else {
                    Value::Unknown
                }
            }
            "binary_expression" => {
                let left = field(n, "left").map(|n| self.eval(file, n, env, ctx).value);
                let right = field(n, "right").map(|n| self.eval(file, n, env, ctx).value);
                match (left, right, field(n, "operator").map(|n| text(n, source))) {
                    (Some(Value::String(a)), Some(Value::String(b)), Some("+")) => {
                        Value::String(a + &b)
                    }
                    (Some(Value::Number(a)), Some(Value::Number(b)), Some("+")) => {
                        a.checked_add(b).map(Value::Number).unwrap_or_default()
                    }
                    _ => Value::Unknown,
                }
            }
            "lexical_declaration" | "variable_declaration" => {
                for child in children(n) {
                    self.eval(file, child, env, ctx);
                }
                Value::Unknown
            }
            "variable_declarator" => {
                let v = field(n, "value")
                    .map(|n| self.eval(file, n, env, ctx).value)
                    .unwrap_or_default();
                if let Some(name) = field(n, "name") {
                    bind(name, v.clone(), source, env);
                }
                v
            }
            "arrow_function" | "function_expression" | "function_declaration" => {
                Value::Function(self.reference(file, n), env.clone())
            }
            "class" | "class_declaration" => Value::Class(self.reference(file, n)),
            _ => Value::Unknown,
        };
        Eval { value }
    }
}
struct Fixture {
    reference: Reference,
    worker: bool,
    auto: bool,
    order: usize,
}
impl Project {
    pub fn fixture_provider_known(&self, test: &crate::Test) -> bool {
        self.test_aliases(&test.file)
            .into_iter()
            .find(|(_, identity)| identity == &test.fixture)
            .is_some_and(|(alias, _)| self.provider(&test.file, &alias, &mut BTreeSet::new()).is_some())
    }

    fn provider(
        &self,
        file: &str,
        name: &str,
        seen: &mut BTreeSet<String>,
    ) -> Option<BTreeMap<String, Fixture>> {
        let key = format!("{file}:{name}");
        if !seen.insert(key) || seen.len() > CALL_LIMIT {
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
        if seen.len() > CALL_LIMIT {
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
            .filter(|name| {
                self.provider(file, name, &mut BTreeSet::new()).is_some()
                    || self.symbol(file, name, 0).is_some_and(|reference| {
                        let source = &self.modules[&reference.file].source;
                        self.node(&reference).is_some_and(|node| {
                            node.kind() == "call_expression"
                                && field(node, "function").is_some_and(|function| {
                                    function.kind() == "member_expression"
                                        && field(function, "property")
                                            .is_some_and(|property| text(property, source) == "extend")
                                })
                        })
                    })
            })
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
}
