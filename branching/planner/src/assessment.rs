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
type Env = BTreeMap<String, Value>;
#[derive(Clone, Debug, Default, PartialEq)]
enum Value {
    #[default]
    Unknown,
    Number(i64),
    Bool(bool),
    String(String),
    Array(Vec<Value>),
    Object(Env),
    Browser,
    Request,
    Expect,
    Assertion(bool),
    Use,
    Function(Reference, Box<Env>),
    Class(Reference),
    Instance(Reference, Env),
    Namespace(String),
}
#[derive(Clone, Copy, PartialEq, Default)]
enum Flow {
    #[default]
    Continue,
    Return,
    Use,
}
#[derive(Default)]
struct Eval {
    value: Value,
    cost: Estimate,
    flow: Flow,
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
}
impl Default for Context {
    fn default() -> Self {
        Self {
            budget: points::NODE_LIMIT,
            stack: vec![],
        }
    }
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
            let object = if let Value::Object(v) = value {
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
        _ => Value::Unknown,
    }
}
fn invalidate_changed(env: &mut Env, branch: &Env) {
    // Branch assignments may change subsequent loop bounds or receivers. Keep
    // only bindings whose abstract value is unchanged on the optional path.
    for (name, value) in branch {
        if env.get(name).is_none_or(|prior| prior != value) {
            env.insert(name.clone(), Value::Unknown);
        }
    }
}
fn escaped_writes(body: Node, source: &str, parameters: &[Node]) -> bool {
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
        .any(|n| n.kind() != "identifier" || !locals.contains(text(*n, source)))
}
impl Project {
    fn value(&self, file: &str, name: &str, env: &Env, ctx: &mut Context) -> Value {
        if let Some(v) = env.get(name) {
            return v.clone();
        }
        if let Some((module, export)) = self.imports(file).get(name) {
            if module == "@playwright/test" && export == "expect" {
                return Value::Expect;
            }
            if export == "*"
                && let Some(target) = self.resolve(file, module)
            {
                return Value::Namespace(target);
            }
        }
        let Some(r) = self.symbol(file, name, 0) else {
            return Value::Unknown;
        };
        let key = format!("binding:{}:{}", r.file, r.start);
        if ctx.stack.contains(&key) || ctx.stack.len() >= points::CALL_LIMIT {
            return Value::Unknown;
        }
        ctx.stack.push(key);
        let v = self
            .node(&r)
            .map(|n| self.eval(&r.file, n, &mut Env::new(), ctx).value)
            .unwrap_or_default();
        ctx.stack.pop();
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
        let key = format!("call:{}:{}", r.file, r.start);
        if ctx.stack.contains(&key) || ctx.stack.len() >= points::CALL_LIMIT {
            return Eval::cost(Estimate::unknown("Recursive helper or call-depth limit"));
        }
        let Some(n) = self.node(r) else {
            return Eval::cost(Estimate::unknown("Unresolved helper body"));
        };
        let s = &self.modules[&r.file].source;
        let mut env = closure.clone();
        if let Some(this) = this {
            env.insert("this".into(), this);
        }
        ctx.stack.push(key);
        let mut defaults = Estimate::default();
        for (i, param) in params(n).into_iter().enumerate() {
            let value = if let Some(value) = args.get(i) {
                value.clone()
            } else if let Some(value) = field(param, "value") {
                let r = self.eval(&r.file, value, &mut env, ctx);
                defaults.add(r.cost);
                r.value
            } else {
                Value::Unknown
            };
            bind(param, value, s, &mut env);
        }
        let mut result = field(n, "body")
            .map(|n| self.eval(&r.file, n, &mut env, ctx))
            .unwrap_or_default();
        ctx.stack.pop();
        result.cost.add(defaults);
        if field(n, "body").is_some_and(|body| escaped_writes(body, s, &params(n))) {
            result.cost = result
                .cost
                .uncertain("Helper mutates state outside its local bindings");
        }
        if result.flow == Flow::Return {
            result.flow = Flow::Continue;
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
            "null" | "undefined" => Eval::default(),
            "regex" | "string_fragment" | "escape_sequence" => Eval::default(),
            "template_string" | "template_substitution" => {
                let mut cost = Estimate::default();
                for child in children(n) {
                    cost.add(self.eval(file, child, env, ctx).cost);
                }
                Eval::cost(cost)
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
                for c in children(n) {
                    let r = self.eval(file, c, env, ctx);
                    cost.add(r.cost);
                    values.push(r.value);
                }
                Eval {
                    cost,
                    value: Value::Array(values),
                    ..Eval::default()
                }
            }
            "object" => {
                let mut cost = Estimate::default();
                let mut values = Env::new();
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
                    value: Value::Object(values),
                    ..Eval::default()
                }
            }
            "expression_statement" | "await_expression" => {
                let child = children(n).into_iter().next();
                let mut r = child
                    .map(|n| self.eval(file, n, env, ctx))
                    .unwrap_or_default();
                if n.kind() == "expression_statement"
                    && child.is_some_and(|n| n.kind() == "call_expression")
                    && r.cost.points > 0
                {
                    r.cost = r
                        .cost
                        .uncertain("Unawaited operation may overlap subsequent work");
                }
                r
            }
            "statement_block" | "program" => {
                let mut result = Eval::default();
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
                    let r = self.eval(file, c, env, ctx);
                    result.cost.add(r.cost);
                    result.value = r.value;
                    result.flow = r.flow;
                    if result.flow != Flow::Continue {
                        break;
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
                result.value = match result.value {
                    Value::Object(v) | Value::Instance(_, v) => {
                        v.get(key).cloned().unwrap_or_default()
                    }
                    Value::Array(v) if key == "length" => Value::Number(v.len() as i64),
                    Value::Browser if key == "request" => Value::Request,
                    Value::Assertion(browser) if key == "not" => Value::Assertion(browser),
                    _ => Value::Unknown,
                };
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
                    _ => Value::Unknown,
                };
                obj
            }
            "binary_expression" => {
                let a = eval_field("left", env, ctx);
                let op = field(n, "operator").map(|n| text(n, s)).unwrap_or("");
                if matches!(op, "&&" | "||" | "??") {
                    let execute = match (&a.value, op) {
                        (Value::Bool(v), "&&") => Some(*v),
                        (Value::Bool(v), "||") => Some(!*v),
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
                            .uncertain("Short-circuit operation depends on runtime data");
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
                let value = match (a.value, b.value, op) {
                    (Value::Number(a), Value::Number(b), "<") => Value::Bool(a < b),
                    (Value::Number(a), Value::Number(b), "<=") => Value::Bool(a <= b),
                    (Value::Number(a), Value::Number(b), ">") => Value::Bool(a > b),
                    (Value::Number(a), Value::Number(b), ">=") => Value::Bool(a >= b),
                    (Value::Number(a), Value::Number(b), "==" | "===") => Value::Bool(a == b),
                    (Value::Number(a), Value::Number(b), "+") => {
                        a.checked_add(b).map(Value::Number).unwrap_or_default()
                    }
                    (Value::Number(a), Value::Number(b), "-") => {
                        a.checked_sub(b).map(Value::Number).unwrap_or_default()
                    }
                    _ => Value::Unknown,
                };
                Eval {
                    cost,
                    value,
                    ..Eval::default()
                }
            }
            "assignment_expression" | "augmented_assignment_expression" => {
                let mut r = eval_field("right", env, ctx);
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
                    if left.kind() == "identifier" {
                        env.insert(text(left, s).into(), r.value.clone());
                    } else if left.kind() == "member_expression"
                        && field(left, "object").is_some_and(|n| text(n, s) == "this")
                        && let (Some(key), Some(Value::Instance(_, fields))) =
                            (field(left, "property"), env.get_mut("this"))
                    {
                        fields.insert(text(key, s).into(), r.value.clone());
                    }
                }
                r
            }
            "update_expression" => {
                if let Some(arg) = field(n, "argument")
                    && let Some(Value::Number(value)) = env.get_mut(text(arg, s))
                {
                    let delta = if text(n, s).contains("++") { 1 } else { -1 };
                    *value = value.saturating_add(delta);
                    return Eval::value(Value::Number(*value));
                }
                Eval::default()
            }
            "if_statement" | "ternary_expression" => {
                let condition = eval_field("condition", env, ctx);
                let branch = match condition.value {
                    Value::Bool(true) => Some("consequence"),
                    Value::Bool(false) => Some("alternative"),
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
                    let mut cost = if a.cost.points >= b.cost.points {
                        a.cost.clone()
                    } else {
                        b.cost.clone()
                    };
                    cost.lower_bound_points =
                        a.cost.lower_bound_points.min(b.cost.lower_bound_points);
                    cost.complete = false;
                    cost.reasons
                        .push("Data-dependent branch; lower bound uses the cheaper path".into());
                    cost.add(condition.cost);
                    Eval::cost(cost)
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
                            cost.add(body.cost);
                            return Eval::cost(cost.uncertain("Unbounded or over-budget loop"));
                        }
                    }
                    let body = eval_field("body", env, ctx);
                    if !body.cost.complete {
                        cost.add(body.cost);
                        return Eval::cost(
                            cost.uncertain("Loop body depends on unresolved control flow"),
                        );
                    }
                    cost.add(body.cost);
                    if body.flow != Flow::Continue {
                        return Eval {
                            cost,
                            value: body.value,
                            flow: body.flow,
                        };
                    }
                    cost.add(eval_field("increment", env, ctx).cost);
                }
                unreachable!()
            }
            "for_in_statement" => {
                let values = eval_field("right", env, ctx);
                let mut cost = values.cost;
                if let Value::Array(items) = values.value
                    && field(n, "operator").is_some_and(|n| text(n, s) == "of")
                    && items.len() <= points::LOOP_LIMIT
                {
                    for item in items {
                        if let Some(left) = field(n, "left") {
                            bind(left, item, s, env);
                        }
                        let r = eval_field("body", env, ctx);
                        cost.add(r.cost);
                        if r.flow != Flow::Continue {
                            return Eval {
                                cost,
                                value: r.value,
                                flow: r.flow,
                            };
                        }
                    }
                    return Eval::cost(cost);
                }
                cost.add(eval_field("body", &mut env.clone(), ctx).cost);
                Eval::cost(cost.uncertain("Unknown loop collection"))
            }
            "while_statement" | "do_statement" => {
                let c = eval_field("condition", env, ctx);
                if matches!(c.value, Value::Bool(false)) && n.kind() == "while_statement" {
                    return Eval::cost(c.cost);
                }
                let mut cost = c.cost;
                cost.add(eval_field("body", &mut env.clone(), ctx).cost);
                Eval::cost(cost.uncertain("Unbounded loop"))
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
                    let mut fields = Env::new();
                    let class_node = self.node(&class).unwrap();
                    let cs = &self.modules[&class.file].source;
                    if let Some(body) = field(class_node, "body") {
                        for member in children(body) {
                            if member.kind() == "method_definition"
                                && field(member, "name")
                                    .is_some_and(|n| text(n, cs) == "constructor")
                            {
                                for (i, param) in params(member).into_iter().enumerate() {
                                    if children(param).iter().any(|n| {
                                        n.kind() == "accessibility_modifier"
                                            || text(*n, cs) == "readonly"
                                    }) {
                                        fields.insert(
                                            text(pattern(param), cs).into(),
                                            args.get(i).cloned().unwrap_or_default(),
                                        );
                                    }
                                }
                                let mut ctor_env = Env::new();
                                let instance = Value::Instance(class.clone(), fields.clone());
                                ctor_env.insert("this".into(), instance);
                                for (i, param) in params(member).into_iter().enumerate() {
                                    bind(
                                        param,
                                        args.get(i).cloned().unwrap_or_default(),
                                        cs,
                                        &mut ctor_env,
                                    );
                                }
                                if let Some(body) = field(member, "body") {
                                    cost.add(self.eval(&class.file, body, &mut ctor_env, ctx).cost);
                                }
                                if let Some(Value::Instance(_, v)) = ctor_env.remove("this") {
                                    fields = v;
                                }
                            }
                        }
                    }
                    Eval {
                        cost,
                        value: Value::Instance(class, fields),
                        ..Eval::default()
                    }
                } else {
                    cost.add(Estimate::unknown("Unresolved constructor"));
                    Eval::cost(cost)
                }
            }
            "call_expression" => self.call_eval(file, n, env, ctx),
            "try_statement" => {
                let mut r = eval_field("body", env, ctx);
                if r.flow == Flow::Use {
                    return r;
                }
                if field(n, "handler").is_some() {
                    r.cost = r.cost.uncertain("Exception-dependent control flow");
                }
                if let Some(finalizer) = field(n, "finalizer") {
                    r.cost.add(self.eval(file, finalizer, env, ctx).cost);
                }
                r
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
        if crate::function_name(n, s) == "Promise.all"
            && argument_nodes.first().is_some_and(|n| n.kind() == "array")
        {
            let mut cost = Estimate::default();
            let mut lower = 0;
            let mut points = 0;
            for arg in children(argument_nodes[0]) {
                let c = self.eval(file, arg, env, ctx).cost;
                points = points.max(c.points);
                lower = lower.max(c.lower_bound_points);
                cost.add(c);
            }
            cost.points = points;
            cost.lower_bound_points = lower;
            return Eval::cost(cost);
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
        if let Some(receiver) = receiver {
            cost.add(receiver.cost);
            match receiver.value {
                Value::Namespace(target) => {
                    if let Value::Function(r, closure) =
                        self.value(&target, method, &Env::new(), ctx)
                    {
                        let mut r = self.invoke(&r, &closure, args, None, ctx);
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
                    ]
                    .contains(&method)
                    {
                        return Eval {
                            cost,
                            value: Value::Browser,
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
                        "isEnabled",
                        "isChecked",
                        "addCookies",
                        "storageState",
                    ]
                    .contains(&method)
                    {
                        Some(("browser-read", points::INTERACTION))
                    } else {
                        None
                    };
                    if let Some((name, value)) = operation {
                        cost.add(Estimate::operation(name, value));
                        return Eval::cost(cost);
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
                    cost.add(Estimate::operation("request", points::REQUEST));
                    return Eval::cost(cost);
                }
                Value::Assertion(browser) => {
                    if method.starts_with("to") {
                        if browser {
                            cost.add(Estimate::operation("assertion", points::ASSERTION));
                        }
                        return Eval::cost(cost);
                    }
                }
                Value::Instance(class, fields) => {
                    if let Some(body) = self.node(&class).and_then(|n| field(n, "body")) {
                        let cs = &self.modules[&class.file].source;
                        for member in children(body) {
                            if member.kind() == "method_definition"
                                && field(member, "name").is_some_and(|n| text(n, cs) == method)
                            {
                                let mut r = self.invoke(
                                    &self.reference(&class.file, member),
                                    &Env::new(),
                                    args,
                                    Some(Value::Instance(class.clone(), fields)),
                                    ctx,
                                );
                                r.cost.add(cost);
                                return r;
                            }
                        }
                    }
                }
                Value::Array(items)
                    if ["forEach", "map"].contains(&method)
                        && items.len() <= points::LOOP_LIMIT =>
                {
                    if let Some(Value::Function(r, closure)) = args.first() {
                        let mut values = vec![];
                        for (i, item) in items.into_iter().enumerate() {
                            let result = self.invoke(
                                r,
                                closure,
                                vec![item, Value::Number(i as i64)],
                                None,
                                ctx,
                            );
                            cost.add(result.cost);
                            values.push(result.value);
                        }
                        if self.node(r).is_some_and(|n| {
                            text(n, &self.modules[&r.file].source)
                                .trim_start()
                                .starts_with("async")
                        }) {
                            cost = cost.uncertain(
                                "Async array callbacks may overlap; execution order is unresolved",
                            );
                        }
                        return Eval {
                            cost,
                            value: Value::Array(values),
                            ..Eval::default()
                        };
                    }
                }
                _ => {}
            }
        } else {
            let target = self.eval(file, function, env, ctx);
            cost.add(target.cost);
            match target.value {
                Value::Expect => {
                    return Eval {
                        cost,
                        value: Value::Assertion(
                            args.first().is_some_and(|v| matches!(v, Value::Browser)),
                        ),
                        ..Eval::default()
                    };
                }
                Value::Use => {
                    return Eval {
                        cost,
                        value: args.into_iter().next().unwrap_or_default(),
                        flow: Flow::Use,
                    };
                }
                Value::Function(r, closure) => {
                    let mut r = self.invoke(&r, &closure, args, None, ctx);
                    r.cost.add(cost);
                    return r;
                }
                _ => {}
            }
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
            .imports(file)
            .get(name)
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
            fixtures.insert(
                normalize::string(key, s).unwrap_or_else(|| text(key, s).into()),
                Fixture {
                    reference: self.reference(file, value),
                    worker,
                    auto,
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
                vec![Value::Object(input), Value::Use],
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
    pub fn assess(&self, test: &mut Test) {
        let mut ctx = Context::default();
        let mut env = Env::new();
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
            if let Some(parameter) = callback.and_then(|cb| params(cb).first().copied()) {
                bind(
                    parameter,
                    Value::Object(env.clone()),
                    &module.source,
                    &mut env,
                );
            }
        } else if test.fixture != "@playwright/test:test" {
            costs
                .repeated
                .add(Estimate::unknown("Unresolved fixture provider"));
        }
        if test
            .reasons
            .iter()
            .any(|r| r.starts_with("use requires") || r.starts_with("beforeAll requires"))
        {
            costs.repeated.add(Estimate::unknown(
                "Native fixture overrides or beforeAll state require runtime inputs",
            ));
        }
        test.fixture_estimate = Some(costs.repeated.clone());
        test.worker_estimate = Some(costs.worker);
        let module = &self.modules[&test.file];
        for step in &mut test.steps {
            let Some(node) = module
                .tree
                .root_node()
                .named_descendant_for_byte_range(step.start, step.end)
            else {
                continue;
            };
            let result = if step.kind == "beforeEach" {
                if let Some(cb) = node.parent() {
                    let mut inputs = env.clone();
                    inputs.extend(values.clone());
                    self.invoke(
                        &self.reference(&test.file, cb),
                        &env,
                        vec![Value::Object(inputs)],
                        None,
                        &mut ctx,
                    )
                } else {
                    Eval::cost(Estimate::unknown("Unresolved hook callback"))
                }
            } else {
                self.eval(&test.file, node, &mut env, &mut ctx)
            };
            step.action_units = result
                .cost
                .complete
                .then_some(result.cost.lower_bound_points);
            step.estimate = Some(result.cost.clone());
            costs.repeated.add(result.cost);
        }
        test.estimate = Some(costs.repeated);
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
                units: t
                    .fixture_estimate
                    .as_ref()
                    .filter(|e| e.complete)
                    .map(|e| e.lower_bound_points),
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
    let plan = crate::cost::select(crate::cost::Input { stages, parents })?;
    Ok(
        serde_json::json!({"version":points::VERSION,"weights":points::weights(),"costBasis":"conservative-lower-bound-points", "runtimeEligibility":"Cost selection alone does not authorize restoring JavaScript state", "costPlan":plan}),
    )
}
