// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

use super::*;
use serde::{
    Deserialize,
    de::{self, MapAccess, SeqAccess, Visitor},
};
use std::{
    collections::{BTreeSet, VecDeque},
    fmt,
};

// Export condition order is semantic. serde_json::Value's default sorted map
// would choose the wrong entry for e.g. {"node": ..., "default": ...}.
#[derive(Clone, Default)]
enum Target {
    #[default]
    Blocked,
    Path(String),
    Array(Vec<Target>),
    Map(Vec<(String, Target)>),
}
impl<'de> Deserialize<'de> for Target {
    fn deserialize<D: de::Deserializer<'de>>(d: D) -> std::result::Result<Self, D::Error> {
        struct Read;
        impl<'de> Visitor<'de> for Read {
            type Value = Target;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a package export target")
            }
            fn visit_str<E: de::Error>(self, v: &str) -> std::result::Result<Target, E> {
                Ok(Target::Path(v.into()))
            }
            fn visit_unit<E: de::Error>(self) -> std::result::Result<Target, E> {
                Ok(Target::Blocked)
            }
            fn visit_seq<A: SeqAccess<'de>>(
                self,
                mut a: A,
            ) -> std::result::Result<Target, A::Error> {
                let mut v = vec![];
                while let Some(e) = a.next_element()? {
                    v.push(e);
                }
                Ok(Target::Array(v))
            }
            fn visit_map<A: MapAccess<'de>>(
                self,
                mut a: A,
            ) -> std::result::Result<Target, A::Error> {
                let mut v = vec![];
                while let Some(e) = a.next_entry()? {
                    v.push(e);
                }
                Ok(Target::Map(v))
            }
        }
        d.deserialize_any(Read)
    }
}
#[derive(Default, Deserialize)]
struct Package {
    #[serde(default)]
    main: Option<String>,
    #[serde(default)]
    exports: Option<Target>,
    #[serde(default)]
    imports: Option<Target>,
    #[serde(default)]
    name: Option<String>,
}
impl Target {
    fn condition_match(&self, require: bool) -> Option<Option<String>> {
        match self {
            Self::Path(p) => Some(Some(p.clone())),
            Self::Blocked => Some(None),
            Self::Array(values) => {
                let mut matched = false;
                for value in values {
                    if let Some(path) = value.condition_match(require) {
                        matched = true;
                        if path.is_some() {
                            return Some(path);
                        }
                    }
                }
                matched.then_some(None)
            }
            Self::Map(values) => {
                for (key, value) in values {
                    if (matches!(
                        key.as_str(),
                        "node" | "default" | "module-sync" | "node-addons"
                    ) || key == if require { "require" } else { "import" })
                        && let Some(result) = value.condition_match(require)
                    {
                        return Some(result);
                    }
                }
                None
            }
        }
    }
    fn condition(&self, require: bool) -> Option<String> {
        self.condition_match(require).flatten()
    }
    fn subpath(&self, key: &str, require: bool) -> Option<String> {
        if let Self::Map(entries) = self
            && entries
                .iter()
                .any(|(k, _)| k.starts_with('.') || k.starts_with('#'))
        {
            if let Some((_, target)) = entries.iter().find(|(k, _)| k == key) {
                return target.condition(require);
            }
            let mut matches: Vec<_> = entries
                .iter()
                .filter_map(|(pattern, target)| {
                    let (start, end) = pattern.split_once('*')?;
                    let tail = key.strip_prefix(start)?.strip_suffix(end)?;
                    Some((start.len(), end.len(), tail, target))
                })
                .collect();
            matches.sort_by_key(|(a, b, _, _)| std::cmp::Reverse((*a, *b)));
            return matches.first().and_then(|(_, _, tail, target)| {
                target.condition(require).map(|p| p.replace('*', tail))
            });
        }
        (key == ".").then(|| self.condition(require)).flatten()
    }
}
fn framework(module: &str) -> bool {
    matches!(
        module,
        "@playwright/test" | "playwright" | "playwright-core"
    )
}
fn source_path(root: &Path, path: &str) -> Result<Option<PathBuf>> {
    let Some(clean) = Project::clean(PathBuf::from(path)) else {
        return Err("Dependency path escapes source root".into());
    };
    let full = root.join(clean);
    if !full.exists() {
        return Ok(None);
    }
    if fs::canonicalize(&full).map_err(|e| e.to_string())? != full {
        return Err(format!("Dependency symlinks are unsupported: {path}"));
    }
    Ok(full.is_file().then_some(full))
}
fn add_source(root: &Path, path: &str, sources: &mut Vec<Source>) -> Result<Option<Vec<u8>>> {
    let Some(full) = source_path(root, path)? else {
        return Ok(None);
    };
    let bytes = fs::read(full).map_err(|e| e.to_string())?;
    if bytes.len() > 16 * 1024 * 1024 {
        return Err(format!("Dependency exceeds analysis file limit: {path}"));
    }
    if let Some(previous) = sources.iter().find(|s| s.path == path) {
        if hash(&bytes) != previous.sha256 {
            return Err(format!("Source changed while planning: {path}"));
        }
    } else {
        sources.push(Source {
            path: path.into(),
            sha256: hash(&bytes),
            bytes: bytes.len(),
        });
    }
    Ok(Some(bytes))
}
fn package(root: &Path, path: &str, sources: &mut Vec<Source>) -> Result<Option<Package>> {
    add_source(root, path, sources)?
        .map(|b| {
            serde_json::from_slice(&b).map_err(|e| format!("Invalid package metadata {path}: {e}"))
        })
        .transpose()
}
fn file(root: &Path, path: &str) -> Result<Option<String>> {
    let Some(path) = Project::clean(PathBuf::from(path)) else {
        return Ok(None);
    };
    // Installed exports name the shipped runtime file; an adjacent TypeScript
    // source may differ and must not replace that implementation.
    if path.split('/').any(|part| part == "node_modules") && source_path(root, &path)?.is_some() {
        return Ok(Some(path));
    }
    // Local Playwright sources can import their TS counterpart using a JS suffix.
    for (js, ts) in [
        (".js", ".ts"),
        (".mjs", ".mts"),
        (".cjs", ".cts"),
        (".jsx", ".tsx"),
    ] {
        if let Some(stem) = path.strip_suffix(js) {
            let candidate = format!("{stem}{ts}");
            if source_path(root, &candidate)?.is_some() {
                return Ok(Some(candidate));
            }
        }
    }
    for suffix in [
        "",
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
        "/index.cjs",
    ] {
        let candidate = format!("{path}{suffix}");
        if source_path(root, &candidate)?.is_some() {
            return Ok(Some(candidate));
        }
    }
    Ok(None)
}
fn resolve_disk(
    root: &Path,
    from: &str,
    module: &str,
    require: bool,
    sources: &mut Vec<Source>,
    depth: usize,
) -> Result<Option<String>> {
    if depth > 32
        || framework(module)
        || module.starts_with("node:")
        || matches!(
            module,
            "assert"
                | "assert/strict"
                | "async_hooks"
                | "buffer"
                | "child_process"
                | "cluster"
                | "console"
                | "crypto"
                | "dgram"
                | "diagnostics_channel"
                | "dns"
                | "dns/promises"
                | "events"
                | "fs"
                | "fs/promises"
                | "http"
                | "http2"
                | "https"
                | "module"
                | "net"
                | "os"
                | "path"
                | "path/posix"
                | "path/win32"
                | "perf_hooks"
                | "process"
                | "punycode"
                | "querystring"
                | "readline"
                | "readline/promises"
                | "repl"
                | "stream"
                | "stream/promises"
                | "stream/web"
                | "string_decoder"
                | "test"
                | "timers"
                | "timers/promises"
                | "tls"
                | "trace_events"
                | "tty"
                | "url"
                | "util"
                | "util/types"
                | "v8"
                | "vm"
                | "wasi"
                | "worker_threads"
                | "zlib"
        )
    {
        return Ok(None);
    }
    let from_dir = Path::new(from).parent().unwrap_or(Path::new(""));
    if module.starts_with('.') {
        let candidate =
            Project::clean(from_dir.join(module)).ok_or("Dependency escapes source root")?;
        return file(root, &candidate);
    }
    let components: Vec<_> = module.split('/').collect();
    let count = if module.starts_with('@') { 2 } else { 1 };
    if components.len() < count || module.contains(':') {
        return Ok(None);
    }
    let name = components[..count].join("/");
    let sub = if components.len() == count {
        ".".into()
    } else {
        format!("./{}", components[count..].join("/"))
    };
    for parent in from_dir.ancestors() {
        let enclosing = parent
            .join("package.json")
            .to_string_lossy()
            .replace('\\', "/");
        if module.starts_with('#') {
            if let Some(meta) = package(root, &enclosing, sources)? {
                let target = meta.imports.and_then(|v| v.subpath(module, require));
                return if let Some(target) = target {
                    resolve_disk(root, &enclosing, &target, require, sources, depth + 1)
                } else {
                    Ok(None)
                };
            }
            continue;
        }
        let package_dir = parent
            .join("node_modules")
            .join(&name)
            .to_string_lossy()
            .replace('\\', "/");
        let metadata = format!("{package_dir}/package.json");
        if let Some(meta) = package(root, &metadata, sources)? {
            let target = if let Some(exports) = meta.exports {
                exports.subpath(&sub, require)
            } else if sub == "." {
                Some(meta.main.unwrap_or("index.js".into()))
            } else {
                Some(sub.clone())
            };
            return if let Some(target) = target {
                let normalized = Project::clean(Path::new(&package_dir).join(&target))
                    .ok_or("Invalid package export target")?;
                if !normalized.starts_with(&format!("{package_dir}/")) {
                    return Err("Package export escapes its package".into());
                }
                file(root, &normalized)
            } else {
                Ok(None)
            };
        }
        // Self-references use that package's exports, like Node.
        if let Some(meta) = package(root, &enclosing, sources)?
            && meta.name.as_deref() == Some(&name)
            && let Some(target) = meta.exports.and_then(|v| v.subpath(&sub, require))
        {
            return file(root, &parent.join(target).to_string_lossy());
        }
    }
    Ok(None)
}
impl Project {
    pub(super) fn discover(&mut self, root: &Path, sources: &mut Vec<Source>) -> Result<()> {
        let mut pending: VecDeque<_> = self.modules.keys().cloned().collect();
        let mut seen = BTreeSet::new();
        let initial = sources.len();
        while let Some(from) = pending.pop_front() {
            if !seen.insert(from.clone()) {
                continue;
            }
            let module = &self.modules[&from];
            let mut links = BTreeSet::new();
            fn collect(n: Node, s: &str, out: &mut BTreeSet<(String, bool)>) {
                if matches!(n.kind(), "import_statement" | "export_statement")
                    && !text(n, s).trim_start().starts_with("import type ")
                    && let Some(path) = field(n, "source").and_then(|n| normalize::string(n, s))
                {
                    out.insert((path, false));
                }
                if n.kind() == "call_expression"
                    && field(n, "function")
                        .is_some_and(|f| matches!(text(f, s), "require" | "import"))
                    && let Some(path) = field(n, "arguments")
                        .and_then(|n| children(n).first().copied())
                        .and_then(|n| normalize::string(n, s))
                {
                    out.insert((
                        path,
                        field(n, "function").is_some_and(|f| text(f, s) == "require"),
                    ));
                }
                for child in children(n) {
                    collect(child, s, out);
                }
            }
            collect(module.tree.root_node(), &module.source, &mut links);
            for (specifier, require) in links {
                let target = resolve_disk(root, &from, &specifier, require, sources, 0)?
                    .or_else(|| self.resolve(&from, &specifier));
                let Some(target) = target else {
                    continue;
                };
                self.dependencies
                    .insert((from.clone(), specifier, require), target.clone());
                if !self.modules.contains_key(&target) && !self.data.contains_key(&target) {
                    let bytes = add_source(root, &target, sources)?
                        .ok_or("Dependency disappeared while planning")?;
                    self.insert(&target, &bytes)?;
                    if sources.len() - initial > 2048 {
                        return Err("Dependency graph exceeds 2048 source files".into());
                    }
                }
                if self.modules.contains_key(&target) {
                    pending.push_back(target);
                }
            }
        }
        self.import_cache = self
            .modules
            .keys()
            .map(|f| (f.clone(), self.scan_imports(f)))
            .collect();
        Ok(())
    }
    pub fn resolve_import(&self, file: &str, name: &str, module: &str) -> Option<String> {
        let module_source = &self.modules.get(file)?;
        fn contains(n: Node, s: &str, name: &str) -> bool {
            text(n, s) == name || children(n).into_iter().any(|n| contains(n, s, name))
        }
        let require = children(module_source.tree.root_node())
            .into_iter()
            .filter(|n| matches!(n.kind(), "lexical_declaration" | "variable_declaration"))
            .flat_map(children)
            .any(|n| {
                field(n, "name").is_some_and(|n| contains(n, &module_source.source, name))
                    && field(n, "value")
                        .and_then(|n| field(n, "function"))
                        .is_some_and(|n| text(n, &module_source.source) == "require")
            });
        self.dependencies
            .get(&(file.into(), module.into(), require))
            .cloned()
            .or_else(|| self.resolve(file, module))
    }
}
