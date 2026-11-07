// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

use serde_json::{Value, json};
use std::{
    fs,
    path::PathBuf,
    process::Command,
    sync::atomic::{AtomicUsize, Ordering},
};
static NEXT: AtomicUsize = AtomicUsize::new(0);
struct Fixture(PathBuf);
impl Fixture {
    fn new(files: &[(&str, &str)]) -> Self {
        let root = std::env::temp_dir().join(format!(
            "magelens-assess-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir_all(root.join("src")).unwrap();
        for (name, source) in files {
            let file = root.join("src").join(name);
            fs::create_dir_all(file.parent().unwrap()).unwrap();
            fs::write(file, source).unwrap();
        }
        Self(root)
    }
    fn plan(&self) -> Value {
        let out = Command::new(env!("CARGO_BIN_EXE_magelens-plan"))
            .args([
                "plan",
                self.0.join("src").to_str().unwrap(),
                self.0.join("manifest.json").to_str().unwrap(),
            ])
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        serde_json::from_slice(&fs::read(self.0.join("manifest.json")).unwrap()).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}
fn test<'a>(manifest: &'a Value, title: &str) -> &'a Value {
    manifest["tests"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["title"] == title)
        .unwrap()
}
fn points(v: &Value) -> u64 {
    v["estimate"]["points"]
        .as_u64()
        .expect("every statement has a point estimate")
}
const IMPORT: &str = "import {test,expect} from '@playwright/test';";

#[test]
fn formatting_comments_quotes_and_types_do_not_hide_shared_work() {
    let f = Fixture::new(&[(
        "case.spec.ts",
        &format!(
            r#"{IMPORT}
      test('a',async ({{page}})=>{{ /* heading */ await page.goto('/cart'); await page.locator('#one').click(); }});
      test('b', async ( {{ page }} ) => {{
        // different typography and an inert TypeScript assertion
        await (page as any).goto("/cart")
        await page.locator('#two').click()
      }});
    "#
        ),
    )]);
    let p = f.plan();
    assert_eq!(p["checkpoints"].as_array().unwrap().len(), 1);
    let a = &test(&p, "a")["steps"][0];
    let b = &test(&p, "b")["steps"][0];
    assert_eq!(a["fingerprint"], b["fingerprint"]);
    assert_eq!(points(a), points(b));
    assert!(points(a) > 0);
    assert_eq!(p["assessment"]["version"], "js-ts-points-v1");
}
#[test]
fn literal_whitespace_inputs_and_preceding_state_are_never_erased() {
    let f = Fixture::new(&[(
        "case.spec.ts",
        &format!(
            r#"{IMPORT}
      test('a',async ({{page}})=>{{await page.goto('/one');await page.getByText('a  b').click();await page.goto('/end-a');}});
      test('b',async ({{page}})=>{{await page.goto('/two');await page.getByText('a b').click();await page.goto('/end-b');}});
    "#
        ),
    )]);
    let p = f.plan();
    assert!(p["checkpoints"].as_array().unwrap().is_empty());
    assert_ne!(
        test(&p, "a")["steps"][1]["fingerprint"],
        test(&p, "b")["steps"][1]["fingerprint"]
    );
}
#[test]
fn imported_functions_and_page_objects_are_assessed_without_per_test_rules() {
    let f = Fixture::new(&[
        (
            "helpers.ts",
            "export async function open(page, url) { await page.goto(url); await page.locator('#ready').waitFor(); } export class Basket { constructor(private page:any) {} async add() { await this.page.locator('#add').click(); await this.page.locator('#qty').fill('2'); } }",
        ),
        (
            "case.spec.ts",
            &format!(
                "{IMPORT} import {{open,Basket}} from './helpers'; test('a',async ({{page}})=>{{await open(page,'/');const basket=new Basket(page);await basket.add();await page.goto('/a');}});test('b',async ({{page}})=>{{await open(page,'/');const basket=new Basket(page);await basket.add();await page.goto('/b');}});"
            ),
        ),
    ]);
    let p = f.plan();
    let steps = test(&p, "a")["steps"].as_array().unwrap();
    assert!(points(&steps[0]) > points(&steps[3]));
    assert_eq!(points(&steps[1]), 0);
    assert_eq!(points(&steps[2]), 2);
    assert_eq!(steps[2]["estimate"]["complete"], true);
    assert_eq!(p["checkpoints"][0]["depth"], 3);
}
#[test]
fn fixture_dependencies_count_repeated_setup_but_not_worker_setup_or_teardown() {
    let f = Fixture::new(&[
        (
            "fixtures.ts",
            r#"import {test as base} from '@playwright/test';
        export const scenario=base.extend({
          account:[async ({request},use)=>{await request.post('/account');await use('account');await request.delete('/account');},{scope:'worker'}],
          cart:async ({page,account},use)=>{await page.goto('/cart');await page.locator('#add').click();await use('cart');await page.goto('/cleanup');},
          ready:[async ({cart},use)=>{await use(cart);},{auto:true}]
        });"#,
        ),
        (
            "case.spec.ts",
            "import {scenario} from './fixtures';scenario('a',async ({page,cart})=>{await page.locator('#a').click();});scenario('b',async ({page,cart})=>{await page.locator('#b').click();});",
        ),
    ]);
    let p = f.plan();
    let t = test(&p, "a");
    assert_eq!(t["fixtureEstimate"]["complete"], true);
    assert_eq!(t["fixtureEstimate"]["points"], 9);
    assert_eq!(t["workerEstimate"]["points"], 4);
    assert!(
        p["checkpoints"]
            .as_array()
            .unwrap()
            .iter()
            .any(|c| c["depth"] == 0),
        "repeated composite fixtures are checkpoint candidates"
    );
}
#[test]
fn fixed_loops_and_nested_helpers_change_the_weight_and_auto_decision() {
    let f = Fixture::new(&[(
        "case.spec.ts",
        &format!(
            r#"{IMPORT}
       async function journey(page) {{ for(let i=0;i<80;i++) {{await page.goto('/step');}} }}
       test('a',async ({{page}})=>{{await journey(page);await page.goto('/a');}});
       test('b',async ({{page}})=>{{await journey(page);await page.goto('/b');}});
    "#
        ),
    )]);
    let p = f.plan();
    assert_eq!(points(&test(&p, "a")["steps"][0]), 640);
    assert!(
        !p["assessment"]["costPlan"]["selected"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert!(
        p["assessment"]["costPlan"]["estimatedSavingMs"]
            .as_f64()
            .unwrap()
            > 0.0
    );
}
#[test]
fn unknown_calls_recursion_and_unbounded_loops_have_explanations_not_fake_precision() {
    let f = Fixture::new(&[(
        "case.spec.ts",
        &format!(
            r#"{IMPORT}
       async function recurse(page) {{await recurse(page);}}
       test('a',async ({{page}})=>{{await externalService();await recurse(page);while(flag){{await page.click('#x');}}await page.goto('/a');}});
       test('b',async ({{page}})=>{{await externalService();await recurse(page);while(flag){{await page.click('#x');}}await page.goto('/b');}});
    "#
        ),
    )]);
    let p = f.plan();
    for s in test(&p, "a")["steps"].as_array().unwrap().iter().take(3) {
        assert_eq!(s["estimate"]["complete"], false);
        assert!(!s["estimate"]["reasons"].as_array().unwrap().is_empty());
        assert!(points(s) > 0);
        assert_eq!(s["estimate"]["lowerBoundPoints"], 0);
    }
    assert!(
        p["assessment"]["costPlan"]["selected"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}
#[test]
fn helper_input_values_change_loop_weights_and_shared_identity() {
    let f = Fixture::new(&[(
        "case.spec.ts",
        &format!(
            "{IMPORT} async function repeat(page,n){{for(let i=0;i<n;i++){{await page.click('#x');}}}} test('a',async ({{page}})=>{{await repeat(page,2);await page.goto('/a');}});test('b',async ({{page}})=>{{await repeat(page,5);await page.goto('/b');}});"
        ),
    )]);
    let p = f.plan();
    assert_eq!(points(&test(&p, "a")["steps"][0]), 2);
    assert_eq!(points(&test(&p, "b")["steps"][0]), 5);
    assert!(p["checkpoints"].as_array().unwrap().is_empty());
}
#[test]
fn cross_file_import_aliases_are_resolved_and_helper_edits_invalidate_estimates() {
    let f = Fixture::new(&[
        (
            "tsconfig.json",
            r#"{"compilerOptions":{"baseUrl":".","paths":{"@steps/*":["helpers/*"]}}}"#,
        ),
        (
            "helpers/cart.ts",
            "export async function open(page){await page.goto('/cart');}",
        ),
        (
            "a.spec.ts",
            &format!(
                "{IMPORT} import {{open}} from '@steps/cart';test('a',async ({{page}})=>{{await open(page);await page.click('#a');}});"
            ),
        ),
        (
            "b.spec.ts",
            &format!(
                "{IMPORT} import {{open}} from './helpers/cart';test('b',async ({{page}})=>{{await open(page);await page.click('#b');}});"
            ),
        ),
    ]);
    let p = f.plan();
    assert_eq!(p["checkpoints"].as_array().unwrap().len(), 1);
    assert_eq!(points(&test(&p, "a")["steps"][0]), 8);
    fs::write(
        f.0.join("src/helpers/cart.ts"),
        "export async function open(page){await page.goto('/cart');await page.click('#ready');}",
    )
    .unwrap();
    let updated = f.plan();
    assert_ne!(p["sourceDigest"], updated["sourceDigest"]);
    assert_eq!(points(&test(&updated, "a")["steps"][0]), 9);
}
#[test]
fn long_unrelated_tests_stay_linear() {
    let mut source = IMPORT.to_string();
    for i in 0..5 {
        source.push_str(&format!("test('test{i}',async ({{page}})=>{{for(let n=0;n<100;n++){{await page.goto('/unique-{i}');}}await page.click('#end-{i}');}});"));
    }
    let p = Fixture::new(&[("case.spec.ts", &source)]).plan();
    assert!(p["checkpoints"].as_array().unwrap().is_empty());
    assert_eq!(p["assessment"]["costPlan"]["selected"], json!([]));
}

#[test]
fn optional_control_flow_never_invents_guaranteed_repeated_work() {
    let f = Fixture::new(&[(
        "case.spec.ts",
        &format!(
            r#"{IMPORT}
      test('a',async ({{page}})=>{{
        false && await page.goto('/skip');
        flag && await page.goto('/maybe');
        let count=80; if(flag) {{count=0;}}
        for(let i=0;i<count;i++) {{await page.goto('/dynamic');}}
      }});
    "#
        ),
    )]);
    let p = f.plan();
    let steps = test(&p, "a")["steps"].as_array().unwrap();
    assert_eq!(points(&steps[0]), 0);
    for i in [1, 4] {
        assert_eq!(steps[i]["estimate"]["complete"], false);
        assert_eq!(steps[i]["estimate"]["lowerBoundPoints"], 0);
    }
}

#[test]
fn loop_arithmetic_step_callbacks_and_parallel_work_are_assessed() {
    let f = Fixture::new(&[(
        "case.spec.ts",
        &format!(
            r#"{IMPORT}
      test('a',async ({{page}})=>{{
        for(let i=0;i<6;i+=2) {{await page.click('#x');}}
        await test.step('open',async()=>{{await page.goto('/');await page.click('#x');}});
        await Promise.all([page.goto('/'),page.click('#x')]);
        const label=`ready ${{await page.title()}}`;
        await unknown.step('maybe',async()=>{{await page.goto('/');}});
      }});
    "#
        ),
    )]);
    let p = f.plan();
    let steps = test(&p, "a")["steps"].as_array().unwrap();
    assert_eq!(points(&steps[0]), 3);
    assert_eq!(points(&steps[1]), 9);
    assert_eq!(points(&steps[2]), 8);
    assert_eq!(points(&steps[3]), 1);
    assert_eq!(steps[4]["estimate"]["complete"], false);
    assert_eq!(steps[4]["estimate"]["lowerBoundPoints"], 0);
}

#[test]
fn jsonc_paths_reexports_and_namespace_helpers_need_no_project_rules() {
    let f = Fixture::new(&[
        (
            "tsconfig.json",
            r#"{/* comments */ "compilerOptions":{"paths":{"@steps/*":["helpers/*"],},},}"#,
        ),
        (
            "helpers/cart.ts",
            "export async function open(page){await page.goto('/');}",
        ),
        (
            "helpers/index.ts",
            "export {open as visit} from './cart.js';",
        ),
        (
            "case.spec.ts",
            &format!(
                "{IMPORT} import * as steps from '@steps/index';test('a',async ({{page}})=>{{await steps.visit(page);}});"
            ),
        ),
    ]);
    let p = f.plan();
    assert_eq!(points(&test(&p, "a")["steps"][0]), 8);
    assert_eq!(test(&p, "a")["steps"][0]["estimate"]["complete"], true);
}

#[test]
fn hooks_include_their_own_fixture_dependencies_and_parameter_aliases() {
    let f = Fixture::new(&[
        (
            "fixtures.ts",
            "import {test as base} from '@playwright/test';export const test=base.extend({cart:async({page},use)=>{await page.goto('/cart');await use(page);}});",
        ),
        (
            "case.spec.ts",
            r#"import {test} from './fixtures';test.beforeEach(async({cart: basket})=>{await basket.click('#ready');});test('a',async({page:p})=>{await p.goto('/a');});test('b',async({page:p})=>{await p.goto('/b');});"#,
        ),
    ]);
    let p = f.plan();
    let t = test(&p, "a");
    assert_eq!(t["fixtureEstimate"]["points"], 8);
    assert_eq!(points(&t["steps"][0]), 1);
    assert_eq!(points(&t["steps"][1]), 8);
}

#[test]
fn a_large_fixture_and_small_shared_steps_form_one_profitable_prefix() {
    let f = Fixture::new(&[
        (
            "fixtures.ts",
            "import {test as base} from '@playwright/test';export const test=base.extend({cart:async({page},use)=>{for(let i=0;i<60;i++){await page.goto('/cart');}await use(page);}});",
        ),
        (
            "case.spec.ts",
            r#"import {test} from './fixtures';test('a',async({cart})=>{await cart.click('#x');await cart.click('#a');});test('b',async({cart})=>{await cart.click('#x');await cart.click('#b');});"#,
        ),
    ]);
    let p = f.plan();
    assert_eq!(test(&p, "a")["fixtureEstimate"]["points"], 480);
    assert!(
        !p["assessment"]["costPlan"]["selected"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert!(
        p["assessment"]["costPlan"]["decisions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|d| d["combinedUnits"] == 481)
    );
}

#[test]
fn malformed_helpers_fail_planning_instead_of_publishing_partial_estimates() {
    let f = Fixture::new(&[
        ("broken.ts", "export async function broken( {"),
        (
            "case.spec.ts",
            &format!("{IMPORT} test('a',async({{page}})=>{{await page.goto('/');}});"),
        ),
    ]);
    let out = Command::new(env!("CARGO_BIN_EXE_magelens-plan"))
        .args([
            "plan",
            f.0.join("src").to_str().unwrap(),
            f.0.join("manifest.json").to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(!out.status.success());
    assert!(!f.0.join("manifest.json").exists());
}

#[test]
fn chained_fixture_extensions_are_composed_without_handwritten_support() {
    let f = Fixture::new(&[
        (
            "fixtures.ts",
            "import {test as base} from '@playwright/test';export const scenario=base.extend({ready:async({page},use)=>{await page.goto('/');await use(page);}}).extend({cart:async({ready},use)=>{await ready.click('#add');await use(ready);}});",
        ),
        (
            "case.spec.ts",
            "import {scenario} from './fixtures';scenario('a',async({cart})=>{await cart.click('#a');});scenario('b',async({cart})=>{await cart.click('#b');});",
        ),
    ]);
    let p = f.plan();
    assert_eq!(p["tests"].as_array().unwrap().len(), 2);
    assert_eq!(test(&p, "a")["fixtureEstimate"]["points"], 9);
}

#[test]
fn escaped_mutation_and_unawaited_operations_cannot_authorize_cost_savings() {
    let f = Fixture::new(&[(
        "case.spec.ts",
        &format!(
            r#"{IMPORT}
      let count=80;
      async function change() {{count=0;}}
      test('a',async({{page}})=>{{await change();for(let i=0;i<count;i++){{await page.goto('/');}}page.goto('/background');await page.click('#a');}});
      test('b',async({{page}})=>{{await change();for(let i=0;i<count;i++){{await page.goto('/');}}page.goto('/background');await page.click('#b');}});
    "#
        ),
    )]);
    let p = f.plan();
    let steps = &test(&p, "a")["steps"];
    assert_eq!(steps[0]["estimate"]["complete"], false);
    assert_eq!(steps[2]["estimate"]["complete"], false);
    assert_eq!(p["assessment"]["costPlan"]["selected"], json!([]));
}

#[test]
fn parameter_defaults_and_string_values_are_not_invented() {
    let f = Fixture::new(&[(
        "case.spec.ts",
        &format!(
            r#"{IMPORT}
      async function open(page,n=3) {{for(let i=0;i<n;i++){{await page.click('#x');}}}}
      test('a',async({{page}})=>{{await open(page);}});
    "#
        ),
    )]);
    let p = f.plan();
    assert_eq!(points(&test(&p, "a")["steps"][0]), 3);
}

#[test]
fn commonjs_javascript_and_typescript_module_extensions_are_assessed() {
    let f = Fixture::new(&[
        (
            "helpers.cjs",
            "async function open(page){await page.goto('/');} module.exports={open};",
        ),
        (
            "case.spec.cjs",
            "const {test}=require('@playwright/test');const steps=require('./helpers.cjs');test('commonjs',async({page})=>{await steps.open(page);});",
        ),
        (
            "module.spec.mts",
            &format!("{IMPORT} test('module',async({{page}})=>{{await page.goto('/');}});"),
        ),
    ]);
    let p = f.plan();
    assert_eq!(p["tests"].as_array().unwrap().len(), 2);
    assert_eq!(points(&test(&p, "commonjs")["steps"][0]), 8);
    assert_eq!(points(&test(&p, "module")["steps"][0]), 8);
}

#[test]
fn trailing_commas_and_comments_are_normalized_but_array_holes_are_preserved() {
    let f = Fixture::new(&[(
        "case.spec.ts",
        &format!(
            r#"{IMPORT}
      test('a',async({{page}})=>{{await page.goto('/',{{waitUntil:'load'}});await page.click('#a');}});
      test('b',async({{page}})=>{{await page.goto( /* note */ '/', {{waitUntil:"load",}}, );await page.click('#b');}});
      test('c',async({{page}})=>{{await page.evaluate([1,,2]);await page.click('#c');}});
      test('d',async({{page}})=>{{await page.evaluate([1,2]);await page.click('#d');}});
    "#
        ),
    )]);
    let p = f.plan();
    assert_eq!(
        test(&p, "a")["steps"][0]["fingerprint"],
        test(&p, "b")["steps"][0]["fingerprint"]
    );
    assert_ne!(
        test(&p, "c")["steps"][0]["fingerprint"],
        test(&p, "d")["steps"][0]["fingerprint"]
    );
}

#[test]
fn runtime_fixture_overrides_and_async_array_callbacks_remain_explicitly_uncertain() {
    let f = Fixture::new(&[(
        "case.spec.ts",
        &format!(
            r#"{IMPORT}
      test.use({{baseURL:process.env.TARGET}});
      test('a',async({{page}})=>{{[1,2,3].forEach(async()=>{{await page.goto('/');}});}});
    "#
        ),
    )]);
    let p = f.plan();
    assert_eq!(test(&p, "a")["fixtureEstimate"]["complete"], false);
    assert_eq!(test(&p, "a")["steps"][0]["estimate"]["complete"], false);
}

#[test]
fn variable_names_alone_do_not_identify_browser_operations() {
    let f = Fixture::new(&[(
        "case.spec.ts",
        &format!(
            r#"{IMPORT}
      const page=customClient;
      test('a',async()=>{{await page.goto('/');}});
    "#
        ),
    )]);
    let p = f.plan();
    assert_eq!(test(&p, "a")["steps"][0]["estimate"]["complete"], false);
}
#[test]
fn scoring_is_deterministic_static_and_does_not_execute_imported_code() {
    let f = Fixture::new(&[
        (
            "unsafe.ts",
            "throw new Error('must never execute'); export async function action(page){await page.goto('/');}",
        ),
        (
            "case.spec.ts",
            &format!(
                "{IMPORT} import {{action}} from './unsafe';test('a',async ({{page}})=>{{await action(page);}});"
            ),
        ),
    ]);
    let a = f.plan();
    let b = f.plan();
    assert_eq!(a, b);
    assert_eq!(points(&test(&a, "a")["steps"][0]), 8);
    assert!(a["assessment"]["weights"].is_object());
}
