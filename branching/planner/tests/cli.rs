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
                .arg("plan")
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
            .arg("verify")
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
            .arg("verify")
            .arg(&f.manifest)
            .status()
            .unwrap()
            .success()
    );
    fs::write(&f.manifest, original).unwrap();
    fs::write(f.source.join("helper.ts"), "export const user=2;").unwrap();
    assert!(
        !f.command()
            .arg("verify")
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
    let result = f.command().arg("verify").arg(&f.manifest).output().unwrap();
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
            .arg("plan")
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

#[test]
fn failed_estimates_block_plan_and_verify_and_preserve_failure_until_repaired() {
    let f = Fixture::new();
    f.plan();
    let original = fs::read(&f.manifest).unwrap();
    for source in [
        "import {test} from '@playwright/test';test('one',async()=>{await unknownProjectOperation();});",
        "import {test} from '@playwright/test';test.beforeAll(async()=>{await unknownProjectOperation();});test('one',async()=>{});",
        "import {test} from '@playwright/test';test.afterEach(async()=>{await unknownProjectOperation();});test('one',async()=>{});",
        "import {test} from '@playwright/test';test.afterAll(async()=>{await unknownProjectOperation();});test('one',async()=>{});",
        "import {test} from '@playwright/test';test.beforeEach(namedCallback);test('one',async()=>{});",
        "import {test} from '@playwright/test';for(const title of runtimeTitles)test(title,async()=>{});test('one',async()=>{});",
        "import {test as base} from '@playwright/test';const test=base.extend({ready:async({},use)=>{await unknownProjectOperation();await use(1);}});test('one',async({ready})=>{});",
    ] {
        fs::write(f.source.join("one.spec.ts"), source).unwrap();
        let output = f
            .command()
            .arg("plan")
            .arg(&f.source)
            .arg(&f.manifest)
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(1));
        let error: serde_json::Value = serde_json::from_slice(&output.stderr).unwrap();
        assert_eq!(error["statusCode"], 500);
        assert_eq!(error["code"], "ESTIMATION_FAILED");
        assert!(!error["issues"].as_array().unwrap().is_empty());
        assert_eq!(fs::read(&f.manifest).unwrap(), original);
        let failure = PathBuf::from(format!("{}.error.json", f.manifest.display()));
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&fs::read(&failure).unwrap()).unwrap(),
            error
        );
        assert!(
            !f.command()
                .arg("verify")
                .arg(&f.manifest)
                .output()
                .unwrap()
                .status
                .success()
        );
    }
    fs::write(
        f.source.join("one.spec.ts"),
        "import {test} from '@playwright/test';test('one',async()=>{});",
    )
    .unwrap();
    f.plan();
    assert!(!PathBuf::from(format!("{}.error.json", f.manifest.display())).exists());
}

#[test]
fn cypress_setup_and_cleanup_failures_are_assessed_before_execution() {
    for hook in ["before", "beforeEach", "afterEach", "after"] {
        let f = Fixture::new();
        fs::write(
            f.source.join("flow.cy.js"),
            format!(
                "{hook}(()=>{{unknownProjectOperation();}});it('native',()=>{{cy.visit('/');}});"
            ),
        )
        .unwrap();
        let output = f
            .command()
            .arg("plan")
            .arg(&f.source)
            .arg(&f.manifest)
            .output()
            .unwrap();
        assert!(!output.status.success(), "{hook} must be assessed");
        assert!(String::from_utf8_lossy(&output.stderr).contains("ESTIMATION_FAILED"));
        assert!(!f.manifest.exists());
    }
}

fn model(source: &str) -> serde_json::Value {
    serde_json::json!({"version":1,"calls":[{"file":"one.spec.ts","sourceSha256":magelens_plan::hash(source),
        "line":2,"column":1,"callee":"projectOperation","operations":{"request":2,"localIo":1},"returns":"text",
        "explanation":"The injected project client makes two HTTP requests and reads one local payload."}]})
}
#[test]
fn source_bound_project_model_resolves_opaque_work_without_changing_eligibility() {
    let f = Fixture::new();
    let source = "import {test} from '@playwright/test';test('one',async()=>{\nprojectOperation({key:'value'}).toUpperCase();\n});";
    fs::write(f.source.join("one.spec.ts"), source).unwrap();
    assert!(magelens_plan::plan(&f.source).is_err());
    let config = f.source.join("magelens.estimation.json");
    fs::write(&config, model(source).to_string()).unwrap();
    f.plan();
    let result: serde_json::Value =
        serde_json::from_slice(&fs::read(&f.manifest).unwrap()).unwrap();
    let estimate = &result["tests"][0]["estimate"];
    assert_eq!(estimate["analysisComplete"], true);
    assert_eq!(estimate["complete"], false);
    assert_eq!(estimate["estimatedPoints"], 9);
    assert_eq!(estimate["lowerBoundPoints"], 0);
    assert_eq!(estimate["estimatedOperations"]["request"], 2.0);
    assert_eq!(result["tests"][0]["disposition"], "adapter-required");
    assert!(
        estimate["assumptions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v.as_str().unwrap().contains("Project call model"))
    );
    assert!(
        result["sources"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v["path"] == "magelens.estimation.json")
    );
    let mut changed = model(source);
    changed["calls"][0]["operations"]["request"] = 3.into();
    fs::write(&config, changed.to_string()).unwrap();
    assert!(
        !f.command()
            .arg("verify")
            .arg(&f.manifest)
            .output()
            .unwrap()
            .status
            .success()
    );
    f.plan();
    fs::write(
        f.source.join("one.spec.ts"),
        format!("{source}\n// changed"),
    )
    .unwrap();
    assert!(
        magelens_plan::plan(&f.source)
            .unwrap_err()
            .contains("stale sourceSha256")
    );
}

#[test]
fn invalid_models_and_unassessed_arguments_cannot_bypass_the_gate() {
    let f = Fixture::new();
    let source = "import {test} from '@playwright/test';test('one',async()=>{\nprojectOperation({key:'value'});\n});";
    fs::write(f.source.join("one.spec.ts"), source).unwrap();
    for (field, value) in [
        ("sourceSha256", serde_json::json!("old")),
        ("column", serde_json::json!(2)),
        ("callee", serde_json::json!("anotherOperation")),
        ("operations", serde_json::json!({"mystery":1})),
        ("operations", serde_json::json!({"request":-1})),
        ("operations", serde_json::json!({"request":1000001})),
        ("returns", serde_json::json!("page")),
        ("explanation", serde_json::json!("")),
        ("skip", serde_json::json!(true)),
    ] {
        let mut config = model(source);
        config["calls"][0][field] = value;
        fs::write(
            f.source.join("magelens.estimation.json"),
            config.to_string(),
        )
        .unwrap();
        assert!(
            magelens_plan::plan(&f.source).is_err(),
            "invalid {field} accepted"
        );
    }
    let mut duplicate = model(source);
    let call = duplicate["calls"][0].clone();
    duplicate["calls"].as_array_mut().unwrap().push(call);
    fs::write(
        f.source.join("magelens.estimation.json"),
        duplicate.to_string(),
    )
    .unwrap();
    assert!(
        magelens_plan::plan(&f.source)
            .unwrap_err()
            .contains("duplicate")
    );
    for argument in [
        "unassessedArgument()",
        "()=>unassessedCallback()",
        "{callback:()=>unassessedCallback()}",
        "new Map([['callback',()=>unassessedCallback()]])",
        "new Set([()=>unassessedCallback()])",
    ] {
        let source = format!(
            "import {{test}} from '@playwright/test';test('one',async()=>{{\nprojectOperation({argument});\n}});"
        );
        fs::write(f.source.join("one.spec.ts"), &source).unwrap();
        fs::write(
            f.source.join("magelens.estimation.json"),
            model(&source).to_string(),
        )
        .unwrap();
        assert!(
            magelens_plan::plan(&f.source)
                .unwrap_err()
                .contains("ESTIMATION_FAILED")
        );
    }
}

#[test]
fn project_models_support_cypress_commands_and_tasks_without_overriding_builtins() {
    for (command, expected) in [("cy.projectCommand", 9), ("cy.task", 9), ("cy.visit", 8)] {
        let f = Fixture::new();
        let source = format!(
            "it('one',()=>{{\n{command}('opaque').then(value=>{{value.toUpperCase();}});\n}});"
        );
        // .cy files establish the Cypress execution context independently of installed packages.
        fs::write(f.source.join("one.cy.js"), &source).unwrap();
        let mut config = model(&source);
        config["calls"][0]["file"] = "one.cy.js".into();
        config["calls"][0]["callee"] = command.into();
        fs::write(
            f.source.join("magelens.estimation.json"),
            config.to_string(),
        )
        .unwrap();
        let manifest = magelens_plan::plan(&f.source).unwrap();
        let test = manifest
            .tests
            .iter()
            .find(|t| t.file == "one.cy.js")
            .unwrap();
        assert_eq!(test.estimate.as_ref().unwrap().estimated_points, expected);
        assert!(test.estimate.as_ref().unwrap().analysis_complete);
    }
}

#[test]
fn chained_call_models_match_the_entire_call_and_preserve_receiver_failures() {
    let f = Fixture::new();
    let source = "import {test} from '@playwright/test';test('one',async()=>{\nprojectOperation().nextOperation();\n});";
    fs::write(f.source.join("one.spec.ts"), source).unwrap();
    let mut configuration = model(source);
    configuration["calls"][0]["callee"] = "projectOperation().nextOperation".into();
    fs::write(
        f.source.join("magelens.estimation.json"),
        configuration.to_string(),
    )
    .unwrap();
    assert!(
        magelens_plan::plan(&f.source)
            .unwrap_err()
            .contains("Unresolved call"),
        "An outer model must not hide an unresolved receiver call sharing its start offset"
    );
    configuration["calls"]
        .as_array_mut()
        .unwrap()
        .push(model(source)["calls"][0].clone());
    fs::write(
        f.source.join("magelens.estimation.json"),
        configuration.to_string(),
    )
    .unwrap();
    let manifest = magelens_plan::plan(&f.source).unwrap();
    assert_eq!(
        manifest.tests[0]
            .estimate
            .as_ref()
            .unwrap()
            .estimated_points,
        18
    );
}
