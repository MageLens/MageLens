// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

use crate::{children, field, text};
use tree_sitter::Node;
// Decode ordinary JS strings without evaluating code. Unknown legacy/octal
// escapes retain their original spelling instead of merging uncertain values.
pub fn string(node: Node, source: &str) -> Option<String> {
    let raw = text(node, source);
    if node.kind() != "string" || raw.len() < 2 {
        return None;
    }
    let mut chars = raw[1..raw.len() - 1].chars();
    let mut out = String::new();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next()? {
            'n' => out.push('\n'),
            'r' => out.push('\r'),
            't' => out.push('\t'),
            'b' => out.push('\u{8}'),
            'f' => out.push('\u{c}'),
            'v' => out.push('\u{b}'),
            '\n' => {}
            '\r' => {
                if chars.clone().next() == Some('\n') {
                    chars.next();
                }
            }
            'x' => {
                let hex: String = chars.by_ref().take(2).collect();
                if hex.len() != 2 {
                    return None;
                }
                out.push(char::from_u32(u32::from_str_radix(&hex, 16).ok()?)?);
            }
            'u' => {
                let hex = if chars.clone().next() == Some('{') {
                    chars.next();
                    let mut value = String::new();
                    loop {
                        let c = chars.next()?;
                        if c == '}' {
                            break;
                        }
                        value.push(c);
                    }
                    value
                } else {
                    let value: String = chars.by_ref().take(4).collect();
                    if value.len() != 4 {
                        return None;
                    }
                    value
                };
                out.push(char::from_u32(u32::from_str_radix(&hex, 16).ok()?)?);
            }
            '0'..='9' => return None,
            c => out.push(c),
        }
    }
    Some(out)
}
pub fn untyped(mut n: Node) -> Node {
    loop {
        match n.kind() {
            "parenthesized_expression"
            | "as_expression"
            | "satisfies_expression"
            | "non_null_expression" => {
                if let Some(first) = n.named_child(0) {
                    n = first;
                } else {
                    return n;
                }
            }
            "type_assertion" => {
                if let Some(last) = children(n).last() {
                    n = *last;
                } else {
                    return n;
                }
            }
            _ => return n,
        }
    }
}
pub fn canonical(n: Node, source: &str) -> String {
    fn encode(n: Node, s: &str) -> serde_json::Value {
        let n = untyped(n);
        if matches!(
            n.kind(),
            "comment"
                | "type_annotation"
                | "type_arguments"
                | "type_parameters"
                | "accessibility_modifier"
        ) {
            return serde_json::Value::Null;
        }
        if n.kind() == "string" {
            return serde_json::json!([
                "string",
                string(n, s).unwrap_or_else(|| text(n, s).into())
            ]);
        }
        if matches!(n.kind(), "template_string" | "regex") {
            return serde_json::json!([n.kind(), text(n, s)]);
        }
        if matches!(n.kind(), "required_parameter" | "optional_parameter")
            && let Some(pattern) = field(n, "pattern").or_else(|| field(n, "name"))
        {
            return serde_json::json!([
                "parameter",
                encode(pattern, s),
                field(n, "value").map(|n| encode(n, s))
            ]);
        }
        if n.child_count() == 0 {
            return serde_json::json!([n.kind(), text(n, s)]);
        }
        let mut parts = vec![serde_json::json!(n.kind())];
        let mut cursor = n.walk();
        for (i, child) in n.children(&mut cursor).enumerate() {
            if child.kind() == ","
                && matches!(
                    n.kind(),
                    "arguments"
                        | "object"
                        | "object_pattern"
                        | "formal_parameters"
                        | "named_imports"
                        | "export_clause"
                )
            {
                // Named children already carry the order in these containers.
                // Array holes and sequence expressions retain their commas.
                continue;
            }
            if child.kind() == ";"
                && matches!(
                    n.kind(),
                    "expression_statement"
                        | "lexical_declaration"
                        | "variable_declaration"
                        | "return_statement"
                        | "throw_statement"
                        | "empty_statement"
                )
            {
                continue;
            }
            let value = encode(child, s);
            if !value.is_null() {
                parts.push(serde_json::json!([n.field_name_for_child(i as u32), value]));
            }
        }
        serde_json::Value::Array(parts)
    }
    encode(n, source).to_string()
}
