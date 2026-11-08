// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

use super::*;

#[derive(Clone, Debug, Default)]
pub(crate) struct Bindings(pub(super) Env);
impl Bindings {
    pub(crate) fn identity(&self) -> String {
        if self.0.is_empty() {
            String::new()
        } else {
            hash(format!("{:?}", self.0))
        }
    }
}

fn registration_exit(n: Node) -> bool {
    if matches!(
        n.kind(),
        "arrow_function" | "function_expression" | "function_declaration"
    ) {
        return false;
    }
    matches!(
        n.kind(),
        "break_statement" | "continue_statement" | "return_statement"
    ) || children(n).into_iter().any(registration_exit)
}
impl Project {
    pub(crate) fn collection_declaration(&self, file: &str, node: Node, bindings: &mut Bindings) {
        self.eval(
            file,
            node,
            &mut bindings.0,
            &mut Context {
                collecting: true,
                ..Context::default()
            },
        );
    }
    pub(crate) fn collection_title(
        &self,
        file: &str,
        node: Node,
        bindings: &Bindings,
    ) -> Option<String> {
        match self
            .eval(
                file,
                node,
                &mut bindings.0.clone(),
                &mut Context {
                    collecting: true,
                    ..Context::default()
                },
            )
            .value
        {
            Value::String(value) => Some(value),
            _ => None,
        }
    }
    pub(crate) fn collection_expand<'a>(
        &self,
        file: &str,
        node: Node<'a>,
        bindings: &Bindings,
    ) -> Option<Vec<(Node<'a>, Bindings)>> {
        let source = &self.modules[file].source;
        let mut env = bindings.0.clone();
        let mut ctx = Context {
            collecting: true,
            ..Context::default()
        };
        if node.kind() == "for_in_statement"
            && field(node, "operator").is_some_and(|n| text(n, source) == "of")
        {
            let values = self
                .eval(file, field(node, "right")?, &mut env, &mut ctx)
                .value;
            let Value::Array(values) = values else {
                return None;
            };
            if values.len() > points::LOOP_LIMIT {
                return None;
            }
            let left = field(node, "left")?;
            let body = field(node, "body")?;
            // Registration bodies with early exits need native collection.
            if registration_exit(body) {
                return None;
            }
            return Some(
                values
                    .into_iter()
                    .map(|v| {
                        let mut env = env.clone();
                        bind(left, v, source, &mut env);
                        (body, Bindings(env))
                    })
                    .collect(),
            );
        }
        let call = crate::call(node)?;
        let callee = field(call, "function")?;
        if callee.kind() != "member_expression"
            || field(callee, "property").is_none_or(|n| text(n, source) != "forEach")
        {
            return None;
        }
        let Value::Array(values) = self
            .eval(file, field(callee, "object")?, &mut env, &mut ctx)
            .value
        else {
            return None;
        };
        if values.len() > points::LOOP_LIMIT {
            return None;
        }
        let callback = crate::callback(call)?;
        let body = field(callback, "body")?;
        if body.kind() != "statement_block" || registration_exit(body) {
            return None;
        }
        let parameters = params(callback);
        Some(
            values
                .iter()
                .enumerate()
                .map(|(index, value)| {
                    let mut env = env.clone();
                    let args = [
                        value.clone(),
                        Value::Number(index as i64),
                        Value::Array(values.clone()),
                    ];
                    for (parameter, value) in parameters.iter().zip(args) {
                        bind(*parameter, value, source, &mut env);
                    }
                    (body, Bindings(env))
                })
                .collect(),
        )
    }
}
