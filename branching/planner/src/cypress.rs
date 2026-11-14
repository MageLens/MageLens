// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

use crate::{children, field, text};
use tree_sitter::Node;

pub fn is_spec(file: &str) -> bool {
    let modern = [
        ".cy.js", ".cy.ts", ".cy.jsx", ".cy.tsx", ".cy.cjs", ".cy.mjs",
    ]
    .iter()
    .any(|suffix| file.ends_with(suffix));
    let legacy_integration = file.split('/').collect::<Vec<_>>()
        .windows(2)
        .any(|parts| parts == ["cypress", "integration"]);
    modern || (legacy_integration
        && [".spec.js", ".spec.ts", ".spec.jsx", ".spec.tsx"]
            .iter()
            .any(|suffix| file.ends_with(suffix)))
}

pub fn collection_name(name: &str) -> String {
    let (base, modifier) = name.split_once('.').unwrap_or((name, ""));
    let base = match base {
        "it" | "specify" => "it",
        "describe" | "context" => "it.describe",
        "beforeEach" => "it.beforeEach",
        "afterEach" => "it.afterEach",
        "before" => "it.beforeAll",
        "after" => "it.afterAll",
        _ => return name.into(),
    };
    if modifier.is_empty() {
        base.into()
    } else {
        format!("{base}.{modifier}")
    }
}

// Native command queues are resumed only between complete, independent chains.
// Aliases, intercepts, host I/O, closures and module state are not serializable
// browser state and must stay in the original Cypress lifecycle.
pub fn portable(node: Node, source: &str) -> bool {
    fn literal(node: Node) -> bool {
        match node.kind() {
            "string" | "number" | "true" | "false" | "null" | "regex" => true,
            "object" | "array" | "pair" | "property_identifier" => {
                children(node).into_iter().all(literal)
            }
            _ => false,
        }
    }
    fn chain(node: Node, source: &str) -> bool {
        if node.kind() == "identifier" {
            return text(node, source) == "cy";
        }
        if node.kind() != "call_expression" {
            return false;
        }
        let Some(function) = field(node, "function") else {
            return false;
        };
        if function.kind() != "member_expression" {
            return false;
        }
        let Some(property) = field(function, "property") else {
            return false;
        };
        if ![
            "visit",
            "reload",
            "go",
            "get",
            "contains",
            "find",
            "filter",
            "first",
            "last",
            "eq",
            "children",
            "parent",
            "parents",
            "closest",
            "next",
            "prev",
            "root",
            "url",
            "location",
            "title",
            "click",
            "dblclick",
            "rightclick",
            "type",
            "clear",
            "check",
            "uncheck",
            "select",
            "focus",
            "blur",
            "scrollIntoView",
            "scrollTo",
            "should",
            "and",
            "request",
            "its",
        ]
        .contains(&text(property, source))
        {
            return false;
        }
        field(function, "object").is_some_and(|n| chain(n, source))
            && field(node, "arguments").is_some_and(|n| children(n).into_iter().all(literal))
    }
    node.kind() == "expression_statement" && node.named_child(0).is_some_and(|n| chain(n, source))
}
