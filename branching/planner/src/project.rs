// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

use crate::{Result, Source, children, field, hash, normalize, text};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};
use tree_sitter::{Node, Parser, Tree};
mod dependencies;
mod effects;
#[derive(Clone, Debug, PartialEq)]
pub struct Reference {
    pub file: String,
    pub start: usize,
    pub end: usize,
}
pub struct Module {
    pub source: String,
    pub tree: Tree,
}
pub struct Project {
    pub modules: BTreeMap<String, Module>,
    pub data: BTreeMap<String, serde_json::Value>,
    import_cache: BTreeMap<String, BTreeMap<String, (String, String)>>,
    paths: Vec<(String, Vec<String>)>,
    base: PathBuf,
    dependencies: BTreeMap<(String, String, bool), String>,
    pub data_modules: std::collections::BTreeSet<String>,
    pub dependency_effects: Vec<serde_json::Value>,
    data_methods: BTreeMap<(String, String), Vec<Reference>>,
    write_cache: std::cell::RefCell<BTreeMap<(String, usize), bool>>,
}
// JSONC is configuration, never executable JavaScript. Preserve strings while
// removing comments/trailing commas accepted by TypeScript configuration files.
fn jsonc(source: &str) -> Option<serde_json::Value> {
    let mut out = Vec::new();
    let bytes = source.as_bytes();
    let (mut i, mut quoted) = (0, false);
    while i < bytes.len() {
        let b = bytes[i];
        if quoted && b == b'\\' {
            out.push(b);
            i += 1;
            out.push(*bytes.get(i)?);
        } else if b == b'"' {
            quoted = !quoted;
            out.push(b);
        } else if !quoted && bytes.get(i..i + 2) == Some(b"//") {
            while i < bytes.len() && bytes[i] != b'\n' {
                i += 1;
            }
            out.push(b' ');
            continue;
        } else if !quoted && bytes.get(i..i + 2) == Some(b"/*") {
            i += 2;
            while bytes.get(i..i + 2) != Some(b"*/") {
                bytes.get(i)?;
                i += 1;
            }
            i += 2;
            out.push(b' ');
            continue;
        } else {
            out.push(b);
        }
        i += 1;
    }
    let mut clean = Vec::new();
    let mut i = 0;
    let mut quoted = false;
    while i < out.len() {
        let b = out[i];
        if quoted && b == b'\\' {
            clean.push(b);
            i += 1;
            clean.push(*out.get(i)?);
        } else if b == b'"' {
            quoted = !quoted;
            clean.push(b);
        } else if !quoted
            && b == b','
            && out[i + 1..]
                .iter()
                .find(|b| !b.is_ascii_whitespace())
                .is_some_and(|b| matches!(b, b'}' | b']'))
        {
        } else {
            clean.push(b);
        }
        i += 1;
    }
    serde_json::from_slice(&clean).ok()
}
impl Project {
    pub fn load(root: &Path, sources: &mut Vec<Source>) -> Result<Self> {
        let mut modules = BTreeMap::new();
        let mut data = BTreeMap::new();
        for source in sources.iter() {
            if source.path.ends_with(".json") {
                let bytes = fs::read(root.join(&source.path)).map_err(|e| e.to_string())?;
                if hash(&bytes) != source.sha256 {
                    return Err(format!("Source changed while planning: {}", source.path));
                }
                if let Ok(value) = serde_json::from_slice(&bytes) {
                    data.insert(source.path.clone(), value);
                }
            }
            if !["ts", "js", "tsx", "jsx", "mjs", "cjs", "mts", "cts"]
                .iter()
                .any(|ext| source.path.ends_with(&format!(".{ext}")))
            {
                continue;
            }
            let code = fs::read_to_string(root.join(&source.path)).map_err(|e| e.to_string())?;
            if hash(&code) != source.sha256 {
                return Err(format!("Source changed while planning: {}", source.path));
            }
            let mut parser = Parser::new();
            let language = if source.path.ends_with("tsx") || source.path.ends_with("jsx") {
                tree_sitter_typescript::LANGUAGE_TSX
            } else {
                tree_sitter_typescript::LANGUAGE_TYPESCRIPT
            };
            parser
                .set_language(&language.into())
                .map_err(|e| e.to_string())?;
            let tree = parser.parse(&code, None).ok_or("Parser returned no tree")?;
            // Malformed helpers cannot silently receive trustworthy estimates.
            if tree.root_node().has_error() {
                return Err(format!(
                    "{}: invalid JavaScript/TypeScript; no partial plan was published",
                    source.path
                ));
            }
            modules.insert(source.path.clone(), Module { source: code, tree });
        }
        let config = fs::read_to_string(root.join("tsconfig.json"))
            .ok()
            .and_then(|s| jsonc(&s));
        let base = PathBuf::from(
            config
                .as_ref()
                .and_then(|v| v["compilerOptions"]["baseUrl"].as_str())
                .unwrap_or("."),
        );
        let paths = config
            .as_ref()
            .and_then(|v| v["compilerOptions"]["paths"].as_object())
            .map(|p| {
                p.iter()
                    .map(|(key, v)| {
                        (
                            key.clone(),
                            v.as_array()
                                .map(|a| {
                                    a.iter()
                                        .filter_map(|v| v.as_str().map(String::from))
                                        .collect()
                                })
                                .unwrap_or_default(),
                        )
                    })
                    .collect()
            })
            .unwrap_or_default();
        let mut project = Self {
            modules,
            data,
            import_cache: BTreeMap::new(),
            paths,
            base,
            dependencies: BTreeMap::new(),
            data_modules: Default::default(),
            dependency_effects: vec![],
            data_methods: BTreeMap::new(),
            write_cache: Default::default(),
        };
        project.import_cache = project
            .modules
            .keys()
            .map(|file| (file.clone(), project.scan_imports(file)))
            .collect();
        project.discover(root, sources)?;
        project.summarize_effects();
        Ok(project)
    }
    fn insert(&mut self, path: &str, bytes: &[u8]) -> Result<()> {
        if path.ends_with(".json") {
            if let Ok(value) = serde_json::from_slice(bytes) {
                self.data.insert(path.into(), value);
            }
            return Ok(());
        }
        let code = String::from_utf8(bytes.to_vec()).map_err(|e| e.to_string())?;
        let mut parser = Parser::new();
        let language = if path.ends_with("tsx") || path.ends_with("jsx") {
            tree_sitter_typescript::LANGUAGE_TSX
        } else {
            tree_sitter_typescript::LANGUAGE_TYPESCRIPT
        };
        parser
            .set_language(&language.into())
            .map_err(|e| e.to_string())?;
        let tree = parser.parse(&code, None).ok_or("Parser returned no tree")?;
        if tree.root_node().has_error() {
            return Err(format!(
                "{path}: invalid JavaScript/TypeScript; no partial plan was published"
            ));
        }
        self.modules
            .insert(path.into(), Module { source: code, tree });
        Ok(())
    }
    pub fn reference(&self, file: &str, n: Node) -> Reference {
        Reference {
            file: file.into(),
            start: n.start_byte(),
            end: n.end_byte(),
        }
    }
    pub fn node<'a>(&'a self, r: &Reference) -> Option<Node<'a>> {
        self.modules
            .get(&r.file)?
            .tree
            .root_node()
            .named_descendant_for_byte_range(r.start, r.end)
    }
    fn clean(path: PathBuf) -> Option<String> {
        let mut out = vec![];
        for c in path.components() {
            match c {
                std::path::Component::Normal(v) => out.push(v.to_str()?.to_string()),
                std::path::Component::CurDir => {}
                std::path::Component::ParentDir => {
                    out.pop()?;
                }
                _ => return None,
            }
        }
        Some(out.join("/"))
    }
    pub fn resolve(&self, file: &str, module: &str) -> Option<String> {
        if let Some(target) = self.dependencies.get(&(file.into(), module.into(), false)) {
            return Some(target.clone());
        }
        let mut candidates = vec![];
        if module.starts_with('.') {
            candidates.push(Path::new(file).parent()?.join(module));
        } else {
            for (pattern, targets) in &self.paths {
                let tail = if let Some((start, end)) = pattern.split_once('*') {
                    module.strip_prefix(start).and_then(|s| s.strip_suffix(end))
                } else {
                    (pattern == module).then_some("")
                };
                if let Some(tail) = tail {
                    for target in targets {
                        candidates.push(self.base.join(target.replace('*', tail)));
                    }
                }
            }
        }
        for candidate in candidates {
            let candidate = Self::clean(candidate)?;
            // TypeScript permits emitted-JavaScript import specifiers in source.
            for (js, ts) in [
                (".js", ".ts"),
                (".mjs", ".mts"),
                (".cjs", ".cts"),
                (".jsx", ".tsx"),
            ] {
                if let Some(stem) = candidate.strip_suffix(js) {
                    let typed = format!("{stem}{ts}");
                    if self.modules.contains_key(&typed) {
                        return Some(typed);
                    }
                }
            }
            for path in std::iter::once(candidate.clone()).chain(
                [
                    ".ts",
                    ".js",
                    ".tsx",
                    ".jsx",
                    ".mts",
                    ".cts",
                    ".mjs",
                    ".cjs",
                    ".json",
                    "/index.ts",
                    "/index.js",
                ]
                .iter()
                .map(|ext| format!("{candidate}{ext}")),
            ) {
                if self.modules.contains_key(&path) || self.data.contains_key(&path) {
                    return Some(path);
                }
            }
        }
        None
    }
    pub fn imports(&self, file: &str) -> BTreeMap<String, (String, String)> {
        self.import_cache.get(file).cloned().unwrap_or_default()
    }
    fn scan_imports(&self, file: &str) -> BTreeMap<String, (String, String)> {
        let mut result = BTreeMap::new();
        let m = &self.modules[file];
        for import in children(m.tree.root_node())
            .into_iter()
            .filter(|n| n.kind() == "import_statement")
        {
            if text(import, &m.source)
                .trim_start()
                .starts_with("import type ")
            {
                continue;
            }
            let Some(module) =
                field(import, "source").and_then(|n| normalize::string(n, &m.source))
            else {
                continue;
            };
            fn visit(n: Node, s: &str, module: &str, out: &mut BTreeMap<String, (String, String)>) {
                if n.kind() == "import_specifier" {
                    if text(n, s).starts_with("type ") {
                        return;
                    }
                    if let Some(name) = field(n, "name") {
                        out.insert(
                            text(field(n, "alias").unwrap_or(name), s).into(),
                            (module.into(), text(name, s).into()),
                        );
                    }
                    return;
                }
                if n.kind() == "namespace_import" {
                    if let Some(name) = children(n).last() {
                        out.insert(text(*name, s).into(), (module.into(), "*".into()));
                    }
                    return;
                }
                if n.kind() == "import_clause" {
                    for c in children(n) {
                        if c.kind() == "identifier" {
                            out.insert(text(c, s).into(), (module.into(), "default".into()));
                        } else {
                            visit(c, s, module, out);
                        }
                    }
                    return;
                }
                for c in children(n) {
                    visit(c, s, module, out);
                }
            }
            visit(import, &m.source, &module, &mut result);
        }
        for declaration in children(m.tree.root_node())
            .into_iter()
            .filter(|n| matches!(n.kind(), "lexical_declaration" | "variable_declaration"))
        {
            for binding in children(declaration) {
                let (Some(name), Some(value)) = (field(binding, "name"), field(binding, "value"))
                else {
                    continue;
                };
                if value.kind() != "call_expression"
                    || field(value, "function").is_none_or(|n| text(n, &m.source) != "require")
                {
                    continue;
                }
                let Some(module) = field(value, "arguments")
                    .and_then(|a| children(a).first().copied())
                    .and_then(|n| normalize::string(n, &m.source))
                else {
                    continue;
                };
                if name.kind() == "identifier" {
                    result.insert(text(name, &m.source).into(), (module, "*".into()));
                } else if name.kind() == "object_pattern" {
                    for item in children(name) {
                        if item.kind() == "shorthand_property_identifier_pattern" {
                            let name = text(item, &m.source);
                            result.insert(name.into(), (module.clone(), name.into()));
                        } else if let (Some(key), Some(value)) =
                            (field(item, "key"), field(item, "value"))
                        {
                            result.insert(
                                text(value, &m.source).into(),
                                (module.clone(), text(key, &m.source).into()),
                            );
                        }
                    }
                }
            }
        }
        result
    }
    pub fn declaration<'a>(&'a self, file: &str, name: &str) -> Option<Node<'a>> {
        let m = self.modules.get(file)?;
        for n in children(m.tree.root_node()) {
            if n.kind() == "expression_statement"
                && let Some(assignment) = children(n).first().copied()
                && assignment.kind() == "assignment_expression"
                && let (Some(left), Some(right)) =
                    (field(assignment, "left"), field(assignment, "right"))
            {
                let target = text(left, &m.source);
                if target == format!("exports.{name}")
                    || target == format!("module.exports.{name}")
                    || target == "module.exports" && name == "default"
                {
                    return Some(right);
                }
                if target == "module.exports" && right.kind() == "object" {
                    for item in children(right) {
                        if field(item, "key").is_some_and(|key| {
                            normalize::string(key, &m.source)
                                .unwrap_or_else(|| text(key, &m.source).into())
                                == name
                        }) {
                            return field(item, "value");
                        }
                        if item.kind() == "shorthand_property_identifier"
                            && text(item, &m.source) == name
                        {
                            return Some(item);
                        }
                    }
                }
            }
            let default = n.kind() == "export_statement"
                && text(n, &m.source)
                    .trim_start()
                    .starts_with("export default");
            let n = if n.kind() == "export_statement" {
                field(n, "declaration")
                    .or_else(|| field(n, "value"))
                    .unwrap_or(n)
            } else {
                n
            };
            if matches!(
                n.kind(),
                "function_declaration" | "generator_function_declaration" | "class_declaration"
            ) && (field(n, "name").is_some_and(|x| text(x, &m.source) == name)
                || (default && name == "default"))
            {
                return Some(n);
            }
            if matches!(n.kind(), "lexical_declaration" | "variable_declaration") {
                for d in children(n) {
                    if field(d, "name").is_some_and(|x| text(x, &m.source) == name) {
                        return field(d, "value");
                    }
                }
            }
            if default && name == "default" {
                return Some(n);
            }
        }
        None
    }
    pub fn symbol(&self, file: &str, name: &str, depth: usize) -> Option<Reference> {
        if depth > 32 {
            return None;
        }
        if let Some(n) = self.declaration(file, name) {
            return Some(self.reference(file, n));
        }
        if let Some((module, export)) = self.imports(file).get(name) {
            let target = self.resolve_import(file, name, module)?;
            return self.symbol(&target, export, depth + 1);
        }
        // Named re-exports, including aliases, are resolved without executing modules.
        let m = self.modules.get(file)?;
        for node in children(m.tree.root_node())
            .into_iter()
            .filter(|n| n.kind() == "export_statement")
        {
            let target = field(node, "source")
                .and_then(|n| normalize::string(n, &m.source))
                .and_then(|s| self.resolve(file, &s));
            if !children(node).iter().any(|n| n.kind() == "export_clause")
                && let Some(target) = &target
                && let Some(r) = self.symbol(target, name, depth + 1)
            {
                return Some(r);
            }
            for clause in children(node)
                .into_iter()
                .filter(|n| n.kind() == "export_clause")
            {
                for spec in children(clause) {
                    let original = field(spec, "name")?;
                    let alias = field(spec, "alias").unwrap_or(original);
                    if text(alias, &m.source) == name {
                        return self.symbol(
                            target.as_deref().unwrap_or(file),
                            text(original, &m.source),
                            depth + 1,
                        );
                    }
                }
            }
        }
        None
    }
    pub fn external(&self, file: &str, name: &str, depth: usize) -> Option<(String, String)> {
        if depth > 32 || self.declaration(file, name).is_some() {
            return None;
        }
        if let Some((module, export)) = self.imports(file).get(name) {
            return if let Some(target) = self.resolve_import(file, name, module) {
                self.external(&target, export, depth + 1)
            } else {
                Some((module.clone(), export.clone()))
            };
        }
        let m = self.modules.get(file)?;
        for node in children(m.tree.root_node())
            .into_iter()
            .filter(|n| n.kind() == "export_statement")
        {
            let Some(module) = field(node, "source").and_then(|n| normalize::string(n, &m.source))
            else {
                continue;
            };
            let clauses: Vec<_> = children(node)
                .into_iter()
                .filter(|n| n.kind() == "export_clause")
                .collect();
            let original = if clauses.is_empty() {
                Some(name)
            } else {
                clauses.into_iter().flat_map(children).find_map(|spec| {
                    let original = field(spec, "name")?;
                    let alias = field(spec, "alias").unwrap_or(original);
                    (text(alias, &m.source) == name).then_some(text(original, &m.source))
                })
            };
            if let Some(original) = original {
                if let Some(target) = self.resolve(file, &module) {
                    if let Some(found) = self.external(&target, original, depth + 1) {
                        return Some(found);
                    }
                } else {
                    return Some((module, original.into()));
                }
            }
        }
        None
    }
    pub fn mutable_binding(&self, r: &Reference) -> bool {
        let key = (r.file.clone(), r.start);
        if let Some(value) = self.write_cache.borrow().get(&key) {
            return *value;
        }
        let Some(binding) = self
            .node(r)
            .and_then(|n| n.parent())
            .filter(|n| n.kind() == "variable_declarator")
        else {
            return false;
        };
        let source = &self.modules[&r.file].source;
        if binding
            .parent()
            .is_some_and(|n| text(n, source).trim_start().starts_with("const "))
        {
            return false;
        }
        let Some(name) = field(binding, "name").map(|n| text(n, source)) else {
            return true;
        };
        fn names(n: Node, s: &str, name: &str) -> bool {
            let mut bindings = std::collections::BTreeSet::new();
            effects::binding(n, s, &mut bindings);
            bindings.contains(name)
        }
        fn function(n: Node) -> bool {
            matches!(
                n.kind(),
                "function_declaration"
                    | "function_expression"
                    | "arrow_function"
                    | "method_definition"
                    | "generator_function"
                    | "generator_function_declaration"
            )
        }
        fn declares(n: Node, s: &str, name: &str) -> bool {
            match n.kind() {
                "lexical_declaration" | "variable_declaration" => children(n)
                    .into_iter()
                    .any(|d| field(d, "name").is_some_and(|n| names(n, s, name))),
                "class_declaration" | "function_declaration" | "generator_function_declaration" => {
                    field(n, "name").is_some_and(|n| names(n, s, name))
                }
                _ => false,
            }
        }
        fn function_var(n: Node, s: &str, name: &str) -> bool {
            if function(n) {
                return false;
            }
            if n.kind() == "variable_declaration" && declares(n, s, name) {
                return true;
            }
            if n.kind() == "for_in_statement"
                && field(n, "kind").is_some_and(|n| text(n, s) == "var")
                && field(n, "left").is_some_and(|n| names(n, s, name))
            {
                return true;
            }
            children(n).into_iter().any(|n| function_var(n, s, name))
        }
        fn writes(n: Node, s: &str, name: &str) -> bool {
            if function(n)
                && (field(n, "parameters")
                    .or_else(|| field(n, "parameter"))
                    .is_some_and(|n| names(n, s, name))
                    || field(n, "name").is_some_and(|n| names(n, s, name))
                    || field(n, "body").is_some_and(|n| function_var(n, s, name)))
            {
                return false;
            }
            // A nested lexical declaration shadows the module binding for its
            // entire block, including loop updates and catch bodies. A for-in
            // assignment without let/const/var instead writes the outer binding.
            if matches!(n.kind(), "statement_block" | "for_statement")
                && children(n).into_iter().any(|n| declares(n, s, name))
            {
                return false;
            }
            if n.kind() == "for_in_statement" {
                let local = field(n, "kind").is_some()
                    || field(n, "left").is_some_and(|n| declares(n, s, name));
                if local && field(n, "left").is_some_and(|n| names(n, s, name)) {
                    return false;
                }
                if !local && field(n, "left").is_some_and(|n| names(n, s, name)) {
                    return true;
                }
            }
            if n.kind() == "catch_clause"
                && field(n, "parameter").is_some_and(|n| names(n, s, name))
            {
                return false;
            }
            if matches!(
                n.kind(),
                "assignment_expression" | "augmented_assignment_expression" | "update_expression"
            ) && field(n, "left")
                .or_else(|| field(n, "argument"))
                .is_some_and(|n| names(n, s, name))
            {
                return true;
            }
            children(n).into_iter().any(|n| writes(n, s, name))
        }
        let result = writes(self.modules[&r.file].tree.root_node(), source, name);
        self.write_cache.borrow_mut().insert(key, result);
        result
    }
    pub fn context(&self, file: &str) -> Vec<(String, String)> {
        self.imports(file)
            .into_iter()
            .map(|(name, (module, export))| {
                let target = self
                    .resolve_import(file, &name, &module)
                    .map(|path| {
                        format!(
                            "{}:{}:{}",
                            path,
                            export,
                            if let Some(module) = self.modules.get(&path) {
                                hash(normalize::canonical(
                                    module.tree.root_node(),
                                    &module.source,
                                ))
                            } else {
                                hash(serde_json::to_vec(&self.data[&path]).unwrap())
                            }
                        )
                    })
                    .unwrap_or_else(|| format!("{module}:{export}"));
                (name, target)
            })
            .collect()
    }
}
