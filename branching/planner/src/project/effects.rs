// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

use super::*;
use std::collections::BTreeSet;

// A source-derived summary for closed data-processing module graphs. It is
// applicable only with data arguments: browser objects and callbacks still
// enter the recursive interpreter. It says nothing about CPU duration.
fn standard(name: &str) -> bool {
    matches!(
        name,
        "undefined"
            | "NaN"
            | "Infinity"
            | "Array"
            | "Object"
            | "String"
            | "Number"
            | "Boolean"
            | "BigInt"
            | "Symbol"
            | "Math"
            | "JSON"
            | "Date"
            | "RegExp"
            | "Map"
            | "Set"
            | "WeakMap"
            | "WeakSet"
            | "Error"
            | "TypeError"
            | "RangeError"
            | "SyntaxError"
            | "URIError"
            | "EvalError"
            | "ReferenceError"
            | "AggregateError"
            | "Promise"
            | "Intl"
            | "ArrayBuffer"
            | "SharedArrayBuffer"
            | "DataView"
            | "Uint8Array"
            | "Uint8ClampedArray"
            | "Uint16Array"
            | "Uint32Array"
            | "Int8Array"
            | "Int16Array"
            | "Int32Array"
            | "Float32Array"
            | "Float64Array"
            | "BigInt64Array"
            | "BigUint64Array"
            | "parseInt"
            | "parseFloat"
            | "isNaN"
            | "isFinite"
            | "encodeURI"
            | "decodeURI"
            | "encodeURIComponent"
            | "decodeURIComponent"
            | "console"
            | "arguments"
            | "Buffer"
            | "Proxy"
            | "TextEncoder"
            | "TextDecoder"
            | "btoa"
            | "atob"
    )
}
pub(super) fn binding(n: Node, s: &str, out: &mut BTreeSet<String>) {
    if matches!(
        n.kind(),
        "identifier" | "type_identifier" | "shorthand_property_identifier_pattern"
    ) {
        out.insert(text(n, s).into());
        return;
    }
    match n.kind() {
        "pair_pattern" => {
            if let Some(n) = field(n, "value") {
                binding(n, s, out);
            }
        }
        "assignment_pattern" | "object_assignment_pattern" => {
            if let Some(n) = field(n, "left") {
                binding(n, s, out);
            }
        }
        "required_parameter" | "optional_parameter" => {
            if let Some(n) = field(n, "pattern").or_else(|| field(n, "name")) {
                binding(n, s, out);
            }
        }
        "type_annotation" => {}
        _ => {
            for child in children(n) {
                binding(child, s, out);
            }
        }
    }
}
fn declarations(n: Node, s: &str, out: &mut BTreeSet<String>) {
    match n.kind() {
        "export_statement" => {
            for c in children(n) {
                declarations(c, s, out);
            }
        }
        "lexical_declaration" | "variable_declaration" => {
            for d in children(n) {
                if let Some(n) = field(d, "name") {
                    binding(n, s, out);
                }
            }
        }
        "function_declaration" | "class_declaration" | "generator_function_declaration" => {
            if let Some(n) = field(n, "name") {
                binding(n, s, out);
            }
        }
        _ => {}
    }
}
fn audit(n: Node, s: &str, env: &BTreeSet<String>, issues: &mut BTreeSet<String>) {
    if matches!(
        n.kind(),
        "comment"
            | "string"
            | "template_chars"
            | "regex"
            | "import_statement"
            | "type_annotation"
            | "interface_declaration"
            | "type_alias_declaration"
    ) {
        return;
    }
    let creates_scope = matches!(
        n.kind(),
        "program"
            | "statement_block"
            | "for_statement"
            | "for_in_statement"
            | "switch_case"
            | "switch_default"
            | "function_declaration"
            | "function_expression"
            | "arrow_function"
            | "method_definition"
            | "generator_function_declaration"
            | "class_declaration"
            | "class"
            | "catch_clause"
    );
    let mut scope = if creates_scope {
        env.clone()
    } else {
        BTreeSet::new()
    };
    if matches!(
        n.kind(),
        "program"
            | "statement_block"
            | "for_statement"
            | "for_in_statement"
            | "switch_case"
            | "switch_default"
    ) {
        for child in children(n) {
            declarations(child, s, &mut scope);
        }
        if n.kind() == "for_in_statement"
            && let Some(left) = field(n, "left")
        {
            binding(left, s, &mut scope);
        }
    }
    if matches!(
        n.kind(),
        "function_declaration"
            | "function_expression"
            | "arrow_function"
            | "method_definition"
            | "generator_function_declaration"
            | "class_declaration"
            | "class"
    ) {
        if let Some(name) = field(n, "name") {
            binding(name, s, &mut scope);
        }
        if let Some(params) = field(n, "parameters").or_else(|| field(n, "parameter")) {
            binding(params, s, &mut scope);
        }
    }
    if n.kind() == "catch_clause"
        && let Some(p) = field(n, "parameter")
    {
        binding(p, s, &mut scope);
    }
    let active = if creates_scope { &scope } else { env };
    if matches!(n.kind(), "identifier" | "shorthand_property_identifier")
        && !active.contains(text(n, s))
        && !standard(text(n, s))
    {
        // Export aliases name a public binding; they are not variable reads.
        if !n
            .parent()
            .is_some_and(|p| p.kind() == "export_specifier" && field(p, "alias") == Some(n))
        {
            issues.insert(format!("Unresolved ambient binding: {}", text(n, s)));
        }
    }
    if n.kind() == "member_expression"
        && field(n, "property").is_some_and(|p| matches!(text(p, s), "constructor" | "__proto__"))
    {
        issues.insert("Reflective object access".into());
    }
    if n.kind() == "call_expression"
        && let Some(callee) = field(n, "function")
    {
        if callee.kind() == "import" {
            issues.insert("Dynamic call target".into());
        }
        if callee.kind() == "subscript_expression" {
            let object = field(callee, "object");
            // Computed dispatch on a local object literal or a class instance
            // stays within this closed graph. Nested reflective dispatch does not.
            let local_table = object.is_some_and(|o| {
                if o.kind() == "this" {
                    return true;
                }
                if o.kind() != "identifier" {
                    return false;
                }
                let mut root = n;
                while let Some(parent) = root.parent() {
                    root = parent;
                }
                children(root)
                    .into_iter()
                    .flat_map(|n| {
                        if n.kind() == "export_statement" {
                            children(n)
                        } else {
                            vec![n]
                        }
                    })
                    .filter(|n| matches!(n.kind(), "lexical_declaration" | "variable_declaration"))
                    .flat_map(children)
                    .any(|d| {
                        field(d, "name").is_some_and(|v| text(v, s) == text(o, s))
                            && field(d, "value").is_some_and(|v| v.kind() == "object")
                    })
            });
            if !local_table {
                issues.insert("Dynamic call target".into());
            }
        }
        if matches!(text(callee, s), "eval" | "Function") {
            issues.insert("Dynamic code execution".into());
        }
    }
    for child in children(n) {
        audit(child, s, active, issues);
    }
}
impl Project {
    pub(super) fn summarize_effects(&mut self) {
        let mut issues = BTreeMap::new();
        for (file, module) in &self.modules {
            if !file.split('/').any(|p| p == "node_modules") {
                continue;
            }
            let mut own = BTreeSet::new();
            let imports = self.imports(file);
            audit(
                module.tree.root_node(),
                &module.source,
                &imports.keys().cloned().collect(),
                &mut own,
            );
            for (name, (specifier, _)) in imports {
                if self.resolve_import(file, &name, &specifier).is_none() {
                    own.insert(format!("External capability: {specifier}"));
                }
            }
            // Side-effect-only imports and re-exports also participate.
            for n in children(module.tree.root_node()) {
                if matches!(n.kind(), "import_statement" | "export_statement")
                    && let Some(specifier) =
                        field(n, "source").and_then(|n| normalize::string(n, &module.source))
                    && self.resolve(file, &specifier).is_none()
                {
                    own.insert(format!("External capability: {specifier}"));
                }
            }
            issues.insert(file.clone(), own);
        }
        let mut rejected: BTreeSet<_> = issues
            .iter()
            .filter(|(_, v)| !v.is_empty())
            .map(|(k, _)| k.clone())
            .collect();
        loop {
            let prior = rejected.len();
            for ((file, _, _), target) in &self.dependencies {
                if issues.contains_key(file)
                    && (rejected.contains(target)
                        || !issues.contains_key(target) && !self.data.contains_key(target))
                {
                    rejected.insert(file.clone());
                }
            }
            if rejected.len() == prior {
                break;
            }
        }
        self.data_modules = issues
            .keys()
            .filter(|k| !rejected.contains(*k))
            .cloned()
            .collect();
        fn methods(
            project: &Project,
            file: &str,
            n: Node,
            out: &mut BTreeMap<(String, String), Vec<Reference>>,
        ) {
            if n.kind() == "method_definition"
                && let Some(name) = field(n, "name")
            {
                let source = &project.modules[file].source;
                out.entry((file.into(), text(name, source).into()))
                    .or_default()
                    .push(project.reference(file, n));
            }
            for child in children(n) {
                methods(project, file, child, out);
            }
        }
        let mut indexed = BTreeMap::new();
        for file in &self.data_modules {
            methods(
                self,
                file,
                self.modules[file].tree.root_node(),
                &mut indexed,
            );
        }
        self.data_methods = indexed;
        self.dependency_effects = issues
            .into_iter()
            .map(|(file, reasons)| {
                let data_only = self.data_modules.contains(&file);
                serde_json::json!({"file":file,"dataOnly":data_only,"reasons":reasons})
            })
            .collect();
    }
    pub fn dependency_closure(&self, file: &str) -> BTreeSet<String> {
        let mut pending = vec![file.to_string()];
        let mut reachable = BTreeSet::new();
        while let Some(file) = pending.pop() {
            if !reachable.insert(file.clone()) {
                continue;
            }
            for ((source, _, _), target) in &self.dependencies {
                if source == &file {
                    pending.push(target.clone());
                }
            }
        }
        reachable
    }
    pub fn data_method_targets(&self, file: &str, method: &str) -> Vec<Reference> {
        let reachable = self.dependency_closure(file);
        reachable
            .into_iter()
            .flat_map(|file| {
                self.data_methods
                    .get(&(file, method.into()))
                    .cloned()
                    .unwrap_or_default()
            })
            .collect()
    }
}
