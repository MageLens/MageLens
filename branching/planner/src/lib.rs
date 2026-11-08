// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};
use tree_sitter::{Node, Parser};
mod assessment;
pub mod baseline;
pub mod cost;
mod normalize;
pub mod points;
mod project;

type Result<T> = std::result::Result<T, String>;
pub fn hash(bytes: impl AsRef<[u8]>) -> String {
    format!("{:x}", Sha256::digest(bytes.as_ref()))
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub path: String,
    pub sha256: String,
    pub bytes: usize,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    pub start: usize,
    pub end: usize,
    pub line: usize,
    pub kind: String,
    pub fingerprint: String,
    pub minified: String,
    pub portable: bool,
    pub asynchronous: bool,
    #[serde(default)]
    pub action_units: Option<u64>,
    #[serde(default)]
    pub estimate: Option<points::Estimate>,
    #[serde(default)]
    pub label: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Test {
    pub id: String,
    pub file: String,
    pub title: String,
    pub line: usize,
    pub fixture: String,
    pub parameters: String,
    pub scope: String,
    pub steps: Vec<Step>,
    pub reasons: Vec<String>,
    pub disposition: String,
    #[serde(default)]
    pub fixture_estimate: Option<points::Estimate>,
    #[serde(default)]
    pub worker_estimate: Option<points::Estimate>,
    #[serde(default)]
    pub estimate: Option<points::Estimate>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub restoration: Option<serde_json::Value>,
    #[serde(skip)]
    context_identity: String,
    #[serde(skip)]
    collection_bindings: assessment::Bindings,
    #[serde(skip)]
    callback_start: usize,
    #[serde(skip)]
    callback_end: usize,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Checkpoint {
    pub id: String,
    pub parent: Option<String>,
    pub depth: usize,
    pub representative: String,
    pub consumers: Vec<String>,
    pub automatic: bool,
    pub saved_statements: usize,
    pub release_after: String,
    #[serde(default)]
    pub label: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub schema_version: u32,
    pub implementation: String,
    pub root: String,
    pub source_digest: String,
    pub sources: Vec<Source>,
    pub tests: Vec<Test>,
    pub checkpoints: Vec<Checkpoint>,
    pub schedule: Vec<String>,
    pub diagnostics: Vec<String>,
    #[serde(default)]
    pub assessment: serde_json::Value,
}

fn text<'a>(n: Node, source: &'a str) -> &'a str {
    &source[n.byte_range()]
}
fn children(n: Node<'_>) -> Vec<Node<'_>> {
    let mut c = n.walk();
    n.named_children(&mut c)
        .filter(|n| n.kind() != "comment")
        .collect()
}
fn field<'a>(n: Node<'a>, key: &str) -> Option<Node<'a>> {
    n.child_by_field_name(key)
}
fn literal(n: Node, source: &str) -> Option<String> {
    normalize::string(n, source)
}
// Token minification only. Never mangle names, fold expressions, reorder calls or
// erase string/regexp/template contents: their values and side effects matter.
pub fn minify(n: Node, source: &str) -> String {
    fn tokens(n: Node, s: &str, out: &mut Vec<String>) {
        if n.kind() == "comment" {
            return;
        }
        if n.child_count() == 0 || matches!(n.kind(), "string" | "template_string" | "regex") {
            out.push(text(n, s).to_string());
            return;
        }
        let mut c = n.walk();
        for child in n.children(&mut c) {
            tokens(child, s, out);
        }
    }
    let mut out = vec![];
    tokens(n, source, &mut out);
    out.join(" ")
}
fn contains(n: Node, predicate: &impl Fn(Node) -> bool) -> bool {
    predicate(n) || children(n).into_iter().any(|c| contains(c, predicate))
}
fn call(n: Node<'_>) -> Option<Node<'_>> {
    let n = if n.kind() == "expression_statement" {
        n.named_child(0)?
    } else {
        n
    };
    (n.kind() == "call_expression").then_some(n)
}
fn function_name(n: Node, s: &str) -> String {
    field(n, "function")
        .map(|n| minify(n, s).replace(' ', ""))
        .unwrap_or_default()
}
fn has_host_callback(n: Node, s: &str) -> bool {
    if matches!(n.kind(), "arrow_function" | "function_expression") {
        return true;
    }
    // Playwright serializes this predicate into the browser. Its local bindings
    // cannot retain Node state once the standalone awaited wait has completed.
    // Other arguments and ordinary callbacks still need lifecycle support.
    if n.kind() == "call_expression"
        && function_name(n, s) == "page.waitForFunction"
        && let Some(arguments) = field(n, "arguments")
    {
        return children(arguments)
            .iter()
            .enumerate()
            .any(|(index, argument)| {
                !(index == 0
                    && matches!(
                        normalize::untyped(*argument).kind(),
                        "arrow_function" | "function_expression"
                    ))
                    && has_host_callback(*argument, s)
            });
    }
    children(n)
        .into_iter()
        .any(|child| has_host_callback(child, s))
}
fn callback(n: Node<'_>) -> Option<Node<'_>> {
    children(field(n, "arguments")?)
        .into_iter()
        .rev()
        .find(|n| matches!(n.kind(), "arrow_function" | "function_expression"))
}
fn params(n: Node, s: &str) -> String {
    field(n, "parameters")
        .map(|p| minify(p, s))
        .unwrap_or_default()
}
fn step(n: Node, s: &str, kind: &str, portable: bool) -> Step {
    let minified = minify(n, s);
    Step {
        start: n.start_byte(),
        end: n.end_byte(),
        line: n.start_position().row + 1,
        kind: kind.into(),
        fingerprint: hash(normalize::canonical(n, s)),
        minified,
        portable,
        asynchronous: contains(n, &|n| n.kind() == "await_expression"),
        action_units: None,
        estimate: None,
        label: if kind == "beforeEach" {
            Some("beforeEach()".into())
        } else {
            boundary_label(n, s)
                .or_else(|| Some(format!("Source line {}", n.start_position().row + 1)))
        },
    }
}

// Read the outer call at the boundary, never its argument values. Helper names
// are useful labels; locator strings, passwords and request payloads are not.
fn boundary_label(n: Node, s: &str) -> Option<String> {
    fn callable(n: Node, s: &str) -> Option<String> {
        match n.kind() {
            "identifier" | "property_identifier" | "this" => Some(text(n, s).into()),
            "member_expression" => Some(format!(
                "{}.{}",
                callable(field(n, "object")?, s)?,
                callable(field(n, "property")?, s)?
            )),
            "call_expression" => Some(format!("{}()", callable(field(n, "function")?, s)?)),
            _ => None,
        }
    }
    let mut op = n;
    if matches!(op.kind(), "lexical_declaration" | "variable_declaration") {
        let declaration = children(op).into_iter().last()?;
        let value = field(declaration, "value")?;
        if value.kind() == "new_expression" {
            return Some(format!(
                "Create {}()",
                callable(field(value, "constructor")?, s)?
            ));
        }
        return Some(format!(
            "Define {}",
            callable(field(declaration, "name")?, s)?
        ));
    }
    while matches!(
        op.kind(),
        "expression_statement" | "await_expression" | "parenthesized_expression"
    ) {
        op = op.named_child(0)?;
    }
    if op.kind() != "call_expression" {
        return None;
    }
    let name = callable(field(op, "function")?, s)?;
    if name == "test.step"
        && let Some(title) = field(op, "arguments")
            .and_then(|a| a.named_child(0))
            .and_then(|a| literal(a, s))
    {
        return Some(title);
    }
    Some(format!("After {name}()"))
}

#[derive(Clone, Default)]
struct Scope {
    names: Vec<String>,
    hooks: Vec<Step>,
    reasons: Vec<String>,
    identity: Vec<String>,
    bindings: assessment::Bindings,
}

#[cfg(test)]
fn parse_file(file: &str, source: &str) -> Result<(Vec<Test>, Vec<String>)> {
    parse_file_with_aliases(file, source, BTreeMap::new(), None)
}
fn parse_file_with_aliases(
    file: &str,
    source: &str,
    extra_aliases: BTreeMap<String, String>,
    project: Option<&project::Project>,
) -> Result<(Vec<Test>, Vec<String>)> {
    let mut parser = Parser::new();
    let language = if file.ends_with("tsx") || file.ends_with("jsx") {
        tree_sitter_typescript::LANGUAGE_TSX
    } else {
        tree_sitter_typescript::LANGUAGE_TYPESCRIPT
    };
    parser
        .set_language(&language.into())
        .map_err(|e| e.to_string())?;
    let tree = parser
        .parse(source, None)
        .ok_or("Parser returned no tree")?;
    if tree.root_node().has_error() {
        return Err(format!(
            "{file}: invalid JavaScript/TypeScript; no partial plan was published"
        ));
    }
    let mut aliases = extra_aliases;
    let mut native_imports = true;
    for n in children(tree.root_node())
        .into_iter()
        .filter(|n| n.kind() == "import_statement")
    {
        let module = field(n, "source")
            .and_then(|n| literal(n, source))
            .unwrap_or_default();
        // Imported custom-fixture aliases, including guestTest as test, are
        // identities. Two fixture providers must never share a checkpoint.
        fn imports(n: Node, source: &str, module: &str, aliases: &mut BTreeMap<String, String>) {
            if n.kind() == "import_specifier"
                && let Some(name) = field(n, "name")
            {
                let original = text(name, source);
                if matches!(original, "test" | "guestTest") {
                    let local = field(n, "alias").unwrap_or(name);
                    aliases.insert(text(local, source).into(), format!("{module}:{original}"));
                }
            }
            for c in children(n) {
                imports(c, source, module, aliases);
            }
        }
        imports(n, source, &module, &mut aliases);
        if module != "@playwright/test"
            || contains(n, &|n| {
                n.kind() == "import_specifier"
                    && (field(n, "alias").is_some()
                        || !matches!(
                            field(n, "name").map(|n| text(n, source)),
                            Some("test" | "expect")
                        ))
            })
        {
            native_imports = false;
        }
    }
    let mut tests = vec![];
    let mut diagnostics = vec![];
    let mut scope = Scope::default();
    if !native_imports {
        scope
            .reasons
            .push("Project imports or custom fixtures require an execution adapter".into());
    }
    walk_scope(
        tree.root_node(),
        &CollectionContext {
            file,
            source,
            aliases: &aliases,
            project,
        },
        scope,
        &mut tests,
        &mut diagnostics,
    );
    if tests.is_empty() && diagnostics.is_empty() {
        diagnostics.push(format!("{file}: no supported static test declarations; native Playwright collection is required"));
    }
    Ok((tests, diagnostics))
}

struct CollectionContext<'a> {
    file: &'a str,
    source: &'a str,
    aliases: &'a BTreeMap<String, String>,
    project: Option<&'a project::Project>,
}
fn walk_scope(
    n: Node,
    context: &CollectionContext,
    mut scope: Scope,
    tests: &mut Vec<Test>,
    diagnostics: &mut Vec<String>,
) {
    let CollectionContext {
        file,
        source: s,
        aliases,
        project,
    } = *context;
    let nodes = children(n);
    // Hooks and test.use apply to the entire lexical suite even if declared last.
    for &node in &nodes {
        if matches!(node.kind(), "comment" | "import_statement") {
            continue;
        }
        if let Some(c) = call(node) {
            let name = function_name(c, s);
            let (base, method) = name.split_once('.').unwrap_or((&name, ""));
            if aliases.contains_key(base) {
                if method == "beforeEach" {
                    scope.identity.push(normalize::canonical(c, s));
                    if let Some(cb) = callback(c)
                        && let Some(body) = field(cb, "body")
                    {
                        scope.hooks.push(step(body, s, "beforeEach", false));
                    }
                    scope
                        .reasons
                        .push("beforeEach hooks require an execution adapter".into());
                    continue;
                }
                if [
                    "afterEach",
                    "beforeAll",
                    "afterAll",
                    "use",
                    "describe.configure",
                ]
                .contains(&method)
                {
                    scope.identity.push(normalize::canonical(c, s));
                    scope.reasons.push(format!(
                        "{method} requires native Playwright lifecycle handling"
                    ));
                    continue;
                }
                if ["skip", "fixme", "fail", "slow"].contains(&method) && callback(c).is_none() {
                    scope.identity.push(normalize::canonical(c, s));
                    scope.reasons.push(format!(
                        "test.{method} requires native Playwright lifecycle handling"
                    ));
                    continue;
                }
                if method.is_empty()
                    || ["only", "skip", "fixme", "fail"].contains(&method)
                    || method.starts_with("describe")
                {
                    continue;
                }
            }
        }
        scope.identity.push(normalize::canonical(node, s));
        scope.reasons.push(
            "Module/suite setup or dynamic registration requires an execution adapter".into(),
        );
    }
    for node in nodes {
        if tests.len() >= 10000 {
            diagnostics.push(format!("{file}: static registration exceeds 10000 test limit; native Playwright collection is required"));
            break;
        }
        if matches!(
            node.kind(),
            "lexical_declaration"
                | "variable_declaration"
                | "function_declaration"
                | "class_declaration"
        ) {
            if let Some(project) = project
                && n.kind() != "program"
            {
                project.collection_declaration(file, node, &mut scope.bindings);
            }
            continue;
        }
        let direct = call(node).is_some_and(|c| {
            let name = function_name(c, s);
            aliases.contains_key(name.split('.').next().unwrap_or(&name))
        });
        if !direct
            && contains(node, &|n| {
                n.kind() == "call_expression" && aliases.keys().any(|a| function_name(n, s) == *a)
            })
        {
            if let Some(expanded) =
                project.and_then(|p| p.collection_expand(file, node, &scope.bindings))
            {
                for (body, bindings) in expanded {
                    let mut child = scope.clone();
                    child.bindings = bindings;
                    walk_scope(body, context, child, tests, diagnostics);
                }
            } else {
                diagnostics.push(format!("{file}:{}: dynamic test registration is not expanded; native Playwright collection is required", node.start_position().row+1));
            }
            continue;
        }
        let Some(c) = call(node) else { continue };
        let name = function_name(c, s);
        let (base, method) = name.split_once('.').unwrap_or((&name, ""));
        let Some(fixture) = aliases.get(base) else {
            continue;
        };
        if !method.is_empty()
            && !["only", "skip", "fixme", "fail"].contains(&method)
            && !method.starts_with("describe")
        {
            continue;
        }
        let Some(cb) = callback(c) else {
            if ["skip", "fixme", "fail", "slow"].contains(&method) {
                continue;
            }
            diagnostics.push(format!(
                "{file}:{}: callback reference or modifier requires native Playwright collection",
                c.start_position().row + 1
            ));
            continue;
        };
        let Some(body) = field(cb, "body") else {
            continue;
        };
        let args = children(field(c, "arguments").unwrap());
        let title = args
            .first()
            .and_then(|n| {
                literal(*n, s)
                    .or_else(|| project.and_then(|p| p.collection_title(file, *n, &scope.bindings)))
            })
            .or_else(|| {
                (method.starts_with("describe") && args.first() == Some(&cb)).then(String::new)
            });
        let Some(title) = title else {
            diagnostics.push(format!(
                "{file}:{}: dynamic title requires native Playwright collection",
                c.start_position().row + 1
            ));
            continue;
        };
        if method.starts_with("describe") {
            let mut child = scope.clone();
            if !title.is_empty() {
                child.names.push(title);
            }
            if method != "describe" {
                child
                    .reasons
                    .push(format!("{method} scheduling must be preserved"));
            }
            walk_scope(body, context, child, tests, diagnostics);
            continue;
        }
        if !method.is_empty() && !["only", "skip", "fixme", "fail"].contains(&method) {
            continue;
        }
        let mut reasons = scope.reasons.clone();
        let parameters = params(cb, s);
        if parameters != "( { page } )" {
            reasons.push("Fixture parameters beyond { page } require an execution adapter".into());
        }
        if body.kind() != "statement_block" {
            reasons.push("Expression test callback requires native execution".into());
        }
        if contains(body, &|n| {
            n.kind() == "this"
                || (n.kind() == "identifier"
                    && matches!(
                        text(n, s),
                        "arguments"
                            | "require"
                            | "module"
                            | "exports"
                            | "__dirname"
                            | "__filename"
                            | "eval"
                            | "process"
                            | "globalThis"
                    ))
        }) {
            reasons.push("Module/process bindings require an execution adapter".into());
        }
        if contains(body, &|n| {
            n.kind() == "identifier" && aliases.contains_key(text(n, s))
        }) {
            reasons.push(
                "Test metadata, modifiers or steps require native Playwright lifecycle handling"
                    .into(),
            );
        }
        if !method.is_empty() {
            reasons.push(format!(
                "test.{method} must be honored by native Playwright"
            ));
        }
        if fixture != "@playwright/test:test" {
            reasons.push("Custom fixture lifecycle is not equivalent to a bare page".into());
        }
        let mut steps = scope.hooks.clone();
        let mut prefix_portable = true;
        for statement in children(body) {
            // Only standalone awaited statements can be replayed without losing
            // lexical bindings. Declarations, control flow, closures and returned
            // values need a project adapter to reconstruct their live state.
            prefix_portable &= statement.kind() == "expression_statement"
                && statement
                    .named_child(0)
                    .is_some_and(|n| n.kind() == "await_expression");
            // Assignments and host callbacks may mutate outer state or create handles.
            prefix_portable &= !contains(statement, &|n| {
                matches!(
                    n.kind(),
                    "assignment_expression"
                        | "augmented_assignment_expression"
                        | "update_expression"
                )
            });
            prefix_portable &= !has_host_callback(statement, s);
            prefix_portable &= !contains(statement, &|n| {
                n.kind() == "identifier"
                    && matches!(text(n, s), "Math" | "Date" | "crypto" | "performance")
            });
            steps.push(step(statement, s, "statement", prefix_portable));
        }
        reasons.sort();
        reasons.dedup();
        let mut names = scope.names.clone();
        names.push(title);
        let title = names.join(" › ");
        let id = format!(
            "test-{}",
            &hash(format!("{file}:{}:{title}", c.start_byte()))[..20]
        );
        let scope_hash =
            hash(serde_json::to_vec(&(file, fixture, &parameters, &scope.identity)).unwrap());
        tests.push(Test {
            id,
            file: file.into(),
            title,
            line: c.start_position().row + 1,
            fixture: fixture.clone(),
            parameters,
            scope: scope_hash,
            steps,
            disposition: if reasons.is_empty() {
                "automatic"
            } else {
                "adapter-required"
            }
            .into(),
            reasons,
            fixture_estimate: None,
            worker_estimate: None,
            estimate: None,
            restoration: None,
            context_identity: serde_json::to_string(&(
                fixture,
                field(cb, "parameters").map(|n| normalize::canonical(n, s)),
                &scope.identity,
                scope.bindings.identity(),
            ))
            .unwrap(),
            collection_bindings: scope.bindings.clone(),
            callback_start: cb.start_byte(),
            callback_end: cb.end_byte(),
        });
    }
}

fn scan(root: &Path, directory: &Path, out: &mut Vec<Source>) -> Result<()> {
    let mut entries = fs::read_dir(directory)
        .map_err(|e| e.to_string())?
        .collect::<std::io::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        let name = e.file_name().to_string_lossy().into_owned();
        if name.starts_with('.')
            || [
                "node_modules",
                "target",
                "coverage",
                "test-results",
                "playwright-report",
            ]
            .contains(&name.as_str())
        {
            continue;
        }
        let path = e.path();
        let ty = e.file_type().map_err(|e| e.to_string())?;
        if ty.is_symlink() {
            return Err(format!(
                "Source symlinks are unsupported: {}",
                path.display()
            ));
        }
        if ty.is_dir() {
            scan(root, &path, out)?;
            continue;
        }
        if !ty.is_file() {
            return Err(format!("Non-regular source: {}", path.display()));
        }
        // Include helpers, config, locks and fixtures, not just .spec files.
        let bytes = fs::read(&path).map_err(|e| e.to_string())?;
        out.push(Source {
            path: path
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/"),
            sha256: hash(&bytes),
            bytes: bytes.len(),
        });
    }
    Ok(())
}

pub fn plan(root: &Path) -> Result<Manifest> {
    let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    if !root.is_dir() {
        return Err("Source root must be a directory".into());
    }
    let mut sources = vec![];
    scan(&root, &root, &mut sources)?;
    sources.sort_by(|a, b| a.path.cmp(&b.path));
    let project = project::Project::load(&root, &mut sources)?;
    sources.sort_by(|a, b| a.path.cmp(&b.path));
    let source_digest = hash(serde_json::to_vec(&sources).unwrap());
    let mut tests = vec![];
    let mut diagnostics = vec![];
    for src in &sources {
        if src.path.split('/').any(|part| part == "node_modules") {
            continue;
        }
        if [
            ".spec.ts",
            ".spec.js",
            ".test.ts",
            ".test.js",
            ".spec.cjs",
            ".test.cjs",
            ".spec.mjs",
            ".test.mjs",
            ".spec.mts",
            ".test.mts",
            ".spec.cts",
            ".test.cts",
            ".spec.tsx",
            ".test.tsx",
            ".spec.jsx",
            ".test.jsx",
        ]
        .iter()
        .any(|s| src.path.ends_with(s))
        {
            let source = fs::read_to_string(root.join(&src.path)).map_err(|e| e.to_string())?;
            if hash(&source) != src.sha256 {
                return Err(format!("Source changed while planning: {}", src.path));
            }
            let (mut found, mut warnings) = parse_file_with_aliases(
                &src.path,
                &source,
                project.test_aliases(&src.path),
                Some(&project),
            )?;
            tests.append(&mut found);
            diagnostics.append(&mut warnings);
        }
    }
    if tests.is_empty() {
        return Err("No statically declared Playwright tests found".into());
    }
    // Module state can survive between tests. Propagate injected capabilities
    // to a fixed point so estimates do not depend on discovery/execution order.
    let mut tainted_libraries = BTreeSet::new();
    loop {
        let prior = tainted_libraries.len();
        for test in &mut tests {
            project.assess(test, &mut tainted_libraries);
        }
        if tainted_libraries.len() == prior {
            break;
        }
    }
    // Each entry is a prefix-trie node identified by its complete ancestry.
    for test in &mut tests {
        if let Ok(recipe) = project.restoration(test) {
            test.restoration = Some(recipe);
            test.disposition = "automatic".into();
            test.reasons.clear();
            // Fixture frames are restored at use(), not midway through a test's
            // local JavaScript stack. Body prefixes remain cost-only candidates.
            for step in &mut test.steps {
                step.portable = false;
            }
        }
    }
    let mut nodes: BTreeMap<String, (usize, Vec<usize>, BTreeSet<String>, bool)> = BTreeMap::new();
    let mut paths = vec![];
    for (i, t) in tests.iter().enumerate() {
        let mut key = t.scope.clone();
        let mut chain = vec![];
        for (depth, step) in t.steps.iter().enumerate() {
            let parent = key.clone();
            key = hash(format!("{parent}:{}", step.fingerprint));
            if let Some(prior) = nodes.get_mut(&parent) {
                prior.2.insert(key.clone());
            }
            let n = nodes
                .entry(key.clone())
                .or_insert((depth + 1, vec![], BTreeSet::new(), true));
            n.1.push(i);
            n.3 &= t.reasons.is_empty() && step.portable;
            chain.push(key.clone());
        }
        // A terminal is a branch too, but don't snapshot entire identical tests.
        if let Some(n) = nodes.get_mut(&key) {
            n.2.insert(format!("terminal:{i}"));
        }
        paths.push(chain);
    }
    let candidates: BTreeSet<String> = nodes
        .iter()
        .filter(|(_, n)| {
            n.1.len() > 1
                && n.2.len() > 1
                && n.1.iter().any(|i| tests[*i].steps.len() > n.0)
                && tests[n.1[0]].steps[..n.0].iter().any(|s| s.asynchronous)
        })
        .map(|(k, _)| k.clone())
        .collect();
    let mut indexes: Vec<usize> = (0..tests.len()).collect();
    // Lexicographic trie traversal keeps all consumers of a prefix together.
    indexes.sort_by(|a, b| {
        (&tests[*a].scope, &paths[*a], &tests[*a].id).cmp(&(
            &tests[*b].scope,
            &paths[*b],
            &tests[*b].id,
        ))
    });
    let schedule: Vec<String> = indexes.iter().map(|i| tests[*i].id.clone()).collect();
    let positions: BTreeMap<&str, usize> = schedule
        .iter()
        .enumerate()
        .map(|(i, s)| (s.as_str(), i))
        .collect();
    let mut checkpoints = vec![];
    for key in &candidates {
        let (depth, consumers, _, automatic) = &nodes[key];
        let repr = consumers[0];
        let parent = paths[repr][..depth - 1]
            .iter()
            .rev()
            .find(|k| candidates.contains(*k))
            .map(|k| format!("cp-{}", &k[..20]));
        let ids: Vec<String> = consumers.iter().map(|i| tests[*i].id.clone()).collect();
        let last = ids
            .iter()
            .max_by_key(|id| positions[id.as_str()])
            .unwrap()
            .clone();
        checkpoints.push(Checkpoint {
            id: format!("cp-{}", &key[..20]),
            parent,
            depth: *depth,
            representative: tests[repr].id.clone(),
            consumers: ids,
            automatic: *automatic,
            saved_statements: (consumers.len() - 1) * depth,
            release_after: last,
            label: tests[repr].steps[depth - 1].label.clone(),
        });
    }
    // A repeated fixture is itself a composite prefix, even when the test
    // bodies diverge immediately. Worker setup and teardown are excluded.
    let mut fixture_groups: BTreeMap<String, Vec<&Test>> = BTreeMap::new();
    for test in &tests {
        if test
            .fixture_estimate
            .as_ref()
            .is_some_and(|e| e.estimated_points > 0)
        {
            fixture_groups
                .entry(test.scope.clone())
                .or_default()
                .push(test);
        }
    }
    for (scope, group) in fixture_groups {
        if group.len() < 2 || !group.iter().any(|t| !t.steps.is_empty()) {
            continue;
        }
        let id = format!("cp-{}", &hash(format!("{scope}:fixture"))[..20]);
        let consumers: Vec<_> = group.iter().map(|t| t.id.clone()).collect();
        for checkpoint in &mut checkpoints {
            if checkpoint.parent.is_none() && consumers.contains(&checkpoint.representative) {
                checkpoint.parent = Some(id.clone());
            }
        }
        checkpoints.push(Checkpoint {
            id,
            parent: None,
            depth: 0,
            representative: group[0].id.clone(),
            release_after: consumers
                .iter()
                .max_by_key(|id| positions[id.as_str()])
                .unwrap()
                .clone(),
            saved_statements: group.len() - 1,
            consumers,
            automatic: group.iter().all(|t| t.restoration.is_some()),
            label: Some("Shared fixture setup".into()),
        });
    }
    checkpoints.sort_by(|a, b| (a.depth, &a.id).cmp(&(b.depth, &b.id)));
    let mut manifest = Manifest {
        schema_version: 1,
        implementation: "rust-prefix-v2".into(),
        root: root.to_string_lossy().into_owned(),
        source_digest,
        sources,
        tests,
        checkpoints,
        schedule,
        diagnostics,
        assessment: serde_json::Value::Null,
    };
    manifest.assessment = assessment::summary(&manifest)?;
    manifest.assessment["dependencyAnalysis"] =
        serde_json::to_value(&project.dependency_effects).unwrap();
    Ok(manifest)
}

pub fn write_manifest(path: &Path, manifest: &Manifest) -> Result<()> {
    use std::io::Write;
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let temp: PathBuf = parent.join(format!(".manifest-{}.tmp", std::process::id()));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    // An existing temporary file belongs to another writer. Do not remove it
    // when exclusive creation fails (container processes can share a PID).
    let mut f = options.open(&temp).map_err(|e| e.to_string())?;
    let result = (|| {
        f.write_all(&serde_json::to_vec_pretty(manifest).unwrap())
            .map_err(|e| e.to_string())?;
        f.write_all(b"\n").map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
        fs::rename(&temp, path).map_err(|e| e.to_string())?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    #[test]
    fn boundary_labels_are_source_derived_without_call_arguments() {
        let source = "import {test} from '@playwright/test'; test.beforeEach(async ({page}) => { await page.goto('SECRET'); }); test('Names', async ({page}) => { const checkout = new CheckoutPage(page); const value = 1; await checkout.selectShipping('SECRET'); await page.getByRole('button', {name:'SECRET'}).click(); await test.step('Shipping ready', async () => {}); });";
        let mut parser = Parser::new();
        parser
            .set_language(&tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into())
            .unwrap();
        let tree = parser.parse(source, None).unwrap();
        fn labels(n: Node, s: &str, out: &mut Vec<String>) {
            if matches!(n.kind(), "expression_statement" | "lexical_declaration")
                && let Some(label) = boundary_label(n, s)
            {
                out.push(label);
            }
            for child in children(n) {
                labels(child, s, out);
            }
        }
        let mut result = vec![];
        labels(tree.root_node(), source, &mut result);
        assert!(result.contains(&"After checkout.selectShipping()".into()));
        assert!(result.contains(&"After page.getByRole().click()".into()));
        assert!(result.contains(&"Shipping ready".into()));
        assert!(result.contains(&"Create CheckoutPage()".into()));
        assert!(result.contains(&"Define value".into()));
        assert!(!result.join(" ").contains("SECRET"));
        let fixture = Fixture::new(source).plan();
        assert_eq!(
            fixture.tests[0].steps[0].label.as_deref(),
            Some("beforeEach()")
        );
    }
    struct Fixture(PathBuf);
    impl Fixture {
        fn new(source: &str) -> Self {
            let root = std::env::temp_dir().join(format!(
                "magelens-plan-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::SeqCst)
            ));
            fs::create_dir(&root).unwrap();
            fs::write(root.join("case.spec.ts"), source).unwrap();
            Self(root)
        }
        fn plan(&self) -> Manifest {
            plan(&self.0).unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }
    const IMPORT: &str = "import { test, expect } from '@playwright/test';";
    #[test]
    fn publication_does_not_delete_another_writers_temporary_file() {
        let f = Fixture::new(&format!(
            "{IMPORT} test('a',async ({{page}})=>{{await page.goto('/');}});"
        ));
        let p = f.plan();
        let temporary = f.0.join(format!(".manifest-{}.tmp", std::process::id()));
        fs::write(&temporary, "another writer").unwrap();
        assert!(write_manifest(&f.0.join("manifest.json"), &p).is_err());
        assert_eq!(fs::read_to_string(temporary).unwrap(), "another writer");
    }
    #[test]
    fn regexes_and_template_contents_are_not_whitespace_normalized() {
        let (tests,_)=parse_file("case.spec.ts",&format!(r#"{IMPORT}
          test('a',async ({{page}})=>{{await page.getByText(/a  b/).click();await page.goto(`/x  y`);}});
          test('b',async ({{page}})=>{{await page.getByText(/a b/).click();await page.goto(`/x y`);}});"#)).unwrap();
        assert_ne!(tests[0].steps[0].fingerprint, tests[1].steps[0].fingerprint);
        assert_ne!(tests[0].steps[1].fingerprint, tests[1].steps[1].fingerprint);
    }
    #[test]
    fn callback_references_and_unknown_registration_styles_are_reported() {
        let (_, warnings) = parse_file(
            "case.spec.ts",
            &format!("{IMPORT}test('reference',handler);"),
        )
        .unwrap();
        assert!(warnings[0].contains("callback reference"));
        let (_, warnings) = parse_file(
            "case.spec.js",
            "const {test}=require('@playwright/test'); test('a',handler);",
        )
        .unwrap();
        assert!(warnings[0].contains("native Playwright collection"));
    }
    #[test]
    fn assigns_static_weights_and_preserves_unknown_helper_costs() {
        let f = Fixture::new(&format!(
            "{IMPORT} test('units',async ({{page}})=>{{await page.goto('/');await page.getByRole('button').click();await expect(page.locator('h1')).toBeVisible();await expect(page).toHaveURL('/');await helper(page);await page.waitForTimeout(500);await Promise.all([page.click('a'),page.click('b')]);}});"
        ));
        let p = f.plan();
        assert_eq!(
            p.tests[0]
                .steps
                .iter()
                .map(|s| s.action_units)
                .collect::<Vec<_>>(),
            vec![
                Some(8),
                Some(1),
                Some(1),
                Some(1),
                Some(0),
                Some(10),
                Some(1)
            ]
        );
        let unknown = p.tests[0].steps[4].estimate.as_ref().unwrap();
        assert!(!unknown.complete);
        assert_eq!(unknown.upper_bound_points, None);
        assert!(!unknown.reasons.is_empty());
    }
    #[test]
    fn detects_prefixes_and_only_captures_branch_points() {
        let f=Fixture::new(&format!("{IMPORT}
          test('a',async ({{page}})=>{{await page.goto('/'); await page.goto('/cart'); await page.goto('/check');}});
          test('b',async ({{page}})=>{{await page.goto('/'); await page.goto('/cart'); await page.goto('/free');}});
          test('c',async ({{page}})=>{{await page.goto('/'); await page.goto('/login');}});"));
        let p = f.plan();
        assert_eq!(p.tests.len(), 3);
        assert_eq!(p.checkpoints.len(), 2);
        assert!(p.checkpoints.iter().all(|c| c.automatic));
        let child = p.checkpoints.iter().find(|c| c.depth == 2).unwrap();
        assert!(child.parent.is_some());
        for c in &p.checkpoints {
            assert_eq!(
                &c.release_after,
                p.schedule
                    .iter()
                    .rev()
                    .find(|id| c.consumers.contains(id))
                    .unwrap()
            );
        }
        assert_eq!(
            serde_json::to_string(&p).unwrap(),
            serde_json::to_string(&f.plan()).unwrap()
        );
    }
    #[test]
    fn normalization_preserves_strings_regexes_and_argument_values() {
        let f=Fixture::new(&format!("{IMPORT}
          test('a',async ({{page}})=>{{await /* comment */ page.goto('https://host/a'); await page.click('a');}});
          test('b',async ({{page}})=>{{ await page . goto( 'https://host/a' ); await page.click('b');}});
          test('c',async ({{page}})=>{{await page.goto('https://host/b'); await page.click('c');}});"));
        let p = f.plan();
        assert_eq!(p.checkpoints.len(), 1);
        assert_eq!(p.checkpoints[0].consumers.len(), 2);
        assert!(p.tests[0].steps[0].minified.contains("https://host/a"));
    }
    #[test]
    fn declarations_are_candidates_but_require_rehydration() {
        let f=Fixture::new("import { guestTest as test } from '@utils/fixtures.utils'; import { CategoryPage } from '@poms/category';
         test('a',async ({page})=>{const category=new CategoryPage(page);await category.open();await category.sort();});
         test('b',async ({page})=>{const category=new CategoryPage(page);await category.open();await category.filter();});");
        let p = f.plan();
        assert_eq!(p.checkpoints.len(), 1);
        assert!(!p.checkpoints[0].automatic);
        assert_eq!(p.checkpoints[0].depth, 2);
        assert_eq!(p.tests[0].fixture, "@utils/fixtures.utils:guestTest");
    }
    #[test]
    fn declarations_alone_are_not_checkpoint_work() {
        let f = Fixture::new(&format!(
            "{IMPORT} test('a',async ({{page}})=>{{const x=1;await page.goto('/a');}});test('b',async ({{page}})=>{{const x=1;await page.goto('/b');}});"
        ));
        assert!(f.plan().checkpoints.is_empty());
    }
    #[test]
    fn never_merges_fixture_or_hook_scopes() {
        let f=Fixture::new("import {test,guestTest} from '@utils/fixtures.utils';
         test('a',async ({page})=>{await page.goto('/');await page.click('a');});
         guestTest('b',async ({page})=>{await page.goto('/');await page.click('b');});
         test.describe('nested',()=>{test.beforeEach(async ({page})=>{await page.goto('/other');}); test('c',async ({page})=>{await page.goto('/');await page.click('c');});});");
        let p = f.plan();
        assert!(p.checkpoints.is_empty());
        assert!(p.diagnostics.is_empty());
        assert_eq!(p.tests[2].steps[0].kind, "beforeEach");
    }
    #[test]
    fn hooks_declared_after_tests_and_modifiers_are_not_lost() {
        let f = Fixture::new(&format!(
            "{IMPORT} test.skip('a',async ({{page}})=>{{await page.goto('/');}}); test.beforeEach(async ({{page}})=>{{await page.goto('/setup');}});"
        ));
        let p = f.plan();
        assert_eq!(p.tests[0].steps[0].kind, "beforeEach");
        assert_eq!(p.tests[0].disposition, "adapter-required");
    }
    #[test]
    fn reports_dynamic_tests_and_rejects_invalid_syntax() {
        let f = Fixture::new(&format!(
            "{IMPORT} for(const x of ['a']){{test(x,async ({{page}})=>{{await page.goto('/');}})}}test('static',async ({{page}})=>{{await page.goto('/');}});"
        ));
        let static_plan = f.plan();
        assert_eq!(static_plan.tests.len(), 2);
        assert!(static_plan.diagnostics.is_empty());
        fs::write(f.0.join("case.spec.ts"),format!("{IMPORT} for(const x of runtimeItems){{test(x,async ({{page}})=>{{await page.goto('/');}})}}test('static',async ({{page}})=>{{await page.goto('/');}});")).unwrap();
        let dynamic_plan = f.plan();
        assert_eq!(dynamic_plan.diagnostics.len(), 1);
        assert_eq!(
            dynamic_plan.assessment["analysis"]["collectionComplete"],
            false
        );
        fs::write(f.0.join("broken.spec.ts"), "test('unclosed'").unwrap();
        assert!(plan(&f.0).is_err());
    }
    #[test]
    fn helper_changes_invalidate_source_identity() {
        let f = Fixture::new(&format!(
            "{IMPORT} test('a',async ({{page}})=>{{await page.goto('/');}});"
        ));
        let old = f.plan().source_digest;
        fs::write(f.0.join("config.json"), "{\"customer\":2}").unwrap();
        assert_ne!(old, f.plan().source_digest);
    }
    #[test]
    fn utf8_offsets_are_bytes() {
        let source =
            format!("{IMPORT} // Привіт\ntest('🛒',async ({{page}})=>{{await page.goto('/');}});");
        let f = Fixture::new(&source);
        let p = f.plan();
        let s = &p.tests[0].steps[0];
        assert_eq!(&source[s.start..s.end], "await page.goto('/');");
    }
    #[test]
    fn assignments_callbacks_and_fixture_parameters_block_automatic_sharing() {
        let f = Fixture::new(&format!(
            "{IMPORT} test('a',async ({{page}})=>{{await page.evaluate(()=>1);await page.goto('/a');}});test('b',async ({{page}})=>{{await page.evaluate(()=>1);await page.goto('/b');}});"
        ));
        assert!(!f.plan().checkpoints[0].automatic);
    }
    #[test]
    fn completed_browser_predicates_do_not_retain_node_closures() {
        for (prefix, automatic) in [
            (
                "await page.waitForFunction(() => {const values = document.cookie.split('; '); return values.some(value => value.startsWith('ready='));});",
                true,
            ),
            (
                "await page.waitForFunction(function () {return document.querySelector('#ready');});",
                true,
            ),
            (
                "await page.waitForFunction(() => {window.changed = true; return true;});",
                false,
            ),
            ("await page.waitForFunction(() => Date.now() > 1);", false),
            (
                "await page.waitForFunction(() => true, () => outer);",
                false,
            ),
            ("await page.on('request', () => outer);", false),
            (
                "const token = 'ready'; await page.waitForFunction(value => document.cookie.includes(value), token);",
                false,
            ),
        ] {
            let f = Fixture::new(&format!(
                "{IMPORT} test('a',async ({{page}})=>{{{prefix}await page.goto('/a');}});test('b',async ({{page}})=>{{{prefix}await page.goto('/b');}});"
            ));
            let p = f.plan();
            assert_eq!(p.checkpoints[0].automatic, automatic, "{prefix}");
        }
    }
    #[cfg(unix)]
    #[test]
    fn refuses_symlink_inputs() {
        let f = Fixture::new(&format!("{IMPORT} test('a',async ({{page}})=>{{}});"));
        std::os::unix::fs::symlink("case.spec.ts", f.0.join("linked.spec.ts")).unwrap();
        assert!(plan(&f.0).is_err());
    }
}
