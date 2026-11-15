// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

use std::{
    fs,
    path::PathBuf,
    process::Command,
    sync::atomic::{AtomicUsize, Ordering},
};
static NEXT: AtomicUsize = AtomicUsize::new(0);
struct Fixture {
    root: PathBuf,
    source: PathBuf,
    manifest: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "magelens-cli-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        ));
        let source = root.join("source with spaces");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("one.spec.ts"),"import {test} from '@playwright/test';test('one',async ({page})=>{await page.goto('/');});").unwrap();
        let manifest = root.join("manifest.json");
        Self {
            root,
            source,
            manifest,
        }
    }
    fn command(&self) -> Command {
        Command::new(env!("CARGO_BIN_EXE_magelens-plan"))
    }
    fn plan(&self) {
        assert!(
            self.command()
                .arg("scan")
                .arg(&self.source)
                .arg(&self.manifest)
                .status()
                .unwrap()
                .success()
        );
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.root).unwrap();
    }
}
#[test]
fn rejects_stale_and_edited_manifests() {
    let f = Fixture::new();
    f.plan();
    assert!(
        f.command()
            .arg("verify-source")
            .arg(&f.manifest)
            .status()
            .unwrap()
            .success()
    );
    let original = fs::read(&f.manifest).unwrap();
    let mut data: serde_json::Value = serde_json::from_slice(&original).unwrap();
    data["extra"] = true.into();
    fs::write(&f.manifest, serde_json::to_vec(&data).unwrap()).unwrap();
    assert!(
        !f.command()
            .arg("verify-source")
            .arg(&f.manifest)
            .status()
            .unwrap()
            .success()
    );
    fs::write(&f.manifest, original).unwrap();
    fs::write(f.source.join("helper.ts"), "export const user=2;").unwrap();
    assert!(
        !f.command()
            .arg("verify-source")
            .arg(&f.manifest)
            .status()
            .unwrap()
            .success()
    );
}

#[test]
fn fractional_checkpoint_costs_survive_manifest_verification() {
    let f = Fixture::new();
    fs::write(f.source.join("one.spec.ts"), "import {test} from '@playwright/test';test('one',async({page})=>{await page.goto('/');await page.click('#one');});test('two',async({page})=>{await page.goto('/');await page.click('#two');});").unwrap();
    f.plan();
    let result = f
        .command()
        .arg("verify-source")
        .arg(&f.manifest)
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let value = -106588.79999999999_f64;
    let parsed: serde_json::Value =
        serde_json::from_str(&serde_json::to_string(&value).unwrap()).unwrap();
    assert_eq!(
        serde_json::to_value(value).unwrap(),
        parsed,
        "Finite cost values must round-trip without changing a bit"
    );
}
#[test]
fn parse_failure_never_replaces_a_valid_manifest() {
    let f = Fixture::new();
    f.plan();
    let original = fs::read(&f.manifest).unwrap();
    fs::write(f.source.join("bad.spec.ts"), "test(").unwrap();
    assert!(
        !f.command()
            .arg("scan")
            .arg(&f.source)
            .arg(&f.manifest)
            .status()
            .unwrap()
            .success()
    );
    assert_eq!(original, fs::read(&f.manifest).unwrap());
}
#[test]
fn planner_does_not_launch_a_browser_worker() {
    let f = Fixture::new();
    let result = f
        .command()
        .args(["launch", "manifest", "config", "/cow", "branching"])
        .env("PATH", "")
        .output()
        .unwrap();
    assert_eq!(result.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&result.stderr).contains("bin/run-coverage --branching"));
}
