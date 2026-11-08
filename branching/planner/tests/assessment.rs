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
fn generic_fixture_restoration_lowers_dependencies_values_and_teardown() {
    let f = Fixture::new(&[
        (
            "helpers.ts",
            "export async function prepare(page) { await page.goto('/cart'); }",
        ),
        (
            "fixtures.ts",
            "import {test as base} from '@playwright/test'; import {prepare} from './helpers'; export const test=base.extend({cart:async({page},use)=>{await prepare(page);const state={page,items:['original']};await use(state);await page.goto('/cleanup/'+state.items.length);},ready:async({cart},use)=>{await use({cart});}});",
        ),
        (
            "case.spec.ts",
            "import {test} from './fixtures';test('one',async({ready})=>{ready.cart.items.push('one');await ready.cart.page.goto('/one');});test('two',async({ready})=>{await ready.cart.page.goto('/two');});",
        ),
    ]);
    let p = f.plan();
    let recipe = &test(&p, "one")["restoration"];
    assert_eq!(test(&p, "one")["disposition"], "automatic");
    assert_eq!(recipe["version"], 1);
    assert_eq!(recipe["fixtures"][0]["name"], "cart");
    assert_eq!(recipe["fixtures"][1]["name"], "ready");
    assert_eq!(recipe["fixtures"][0]["locals"], json!(["state"]));
    assert!(
        recipe["fixtures"][0]["teardown"]
            .as_str()
            .unwrap()
            .contains("/cleanup/")
    );
    assert!(
        p["checkpoints"]
            .as_array()
            .unwrap()
            .iter()
            .any(|c| c["depth"] == 0 && c["automatic"] == true)
    );
    assert!(
        test(&p, "one")["steps"]
            .as_array()
            .unwrap()
            .iter()
            .all(|s| s["portable"] == false)
    );
}

#[test]
fn unsupported_fixture_lifecycles_remain_native() {
    for fixture in [
        "value:[async({},use)=>{await use(1);},{scope:'worker'}]",
        "value:async({page},use)=>{if(await page.title())await use(page);}",
        "value:async({page},use)=>{page.on('request',()=>{});await use(page);}",
        "page:async({browser},use)=>{await use(await browser.newPage());}",
        "value:async({},use)=>{class State {public static count=0;}await use(new State());}",
    ] {
        let source = format!(
            "import {{test as base}} from '@playwright/test';const test=base.extend({{{fixture}}});test('a',async({{value}})=>{{await value.click();}});"
        );
        let p = Fixture::new(&[("case.spec.ts", &source)]).plan();
        assert_eq!(
            test(&p, "a")["disposition"],
            "adapter-required",
            "{fixture}"
        );
        assert!(test(&p, "a").get("restoration").is_none());
    }
}

#[test]
fn fixture_frames_keep_only_locals_needed_after_use() {
    let p=Fixture::new(&[("case.spec.ts", "import {test as base} from '@playwright/test';const test=base.extend({record:async({request},use)=>{const response=await request.post('/records',{data:{name:'sample'}});const record=await response.json();try{await use(record);}finally{await request.delete('/records/'+record.id);}}});test('a',async({record})=>{if(!record.id)throw new Error('missing');});")]).plan();
    let recipe = &test(&p, "a")["restoration"];
    assert_eq!(recipe["fixtures"][0]["locals"], json!(["record"]));
    assert!(
        recipe["fixtures"][0]["setup"]
            .as_str()
            .unwrap()
            .contains("response.json()")
    );
}

#[test]
fn described_fixture_tests_restore_but_module_side_effects_remain_native() {
    let declaration = "import {test as base} from '@playwright/test';const test=base.extend({data:async({page},use)=>{await page.goto('/');await use({ready:true});}});test.describe('group',()=>{test('a',async({data})=>{if(!data.ready)throw new Error('missing');});});";
    let p = Fixture::new(&[("case.spec.ts", declaration)]).plan();
    assert_eq!(test(&p, "group › a")["disposition"], "automatic");
    let p = Fixture::new(&[(
        "case.spec.ts",
        &format!("{declaration}\nconfigureExternalService();"),
    )])
    .plan();
    assert_eq!(test(&p, "group › a")["disposition"], "adapter-required");
}

#[test]
fn fixture_continuations_preserve_automatic_and_parameter_order() {
    let p=Fixture::new(&[("case.spec.ts","import {test as base} from '@playwright/test';const test=base.extend({z:async({},use)=>{await use('z');},a:async({},use)=>{await use('a');},autoZ:[async({},use)=>{await use('auto-z');},{auto:true}],autoA:[async({},use)=>{await use('auto-a');},{auto:true}]});test('a',async({z,a})=>{});")]).plan();
    let names: Vec<_> = test(&p, "a")["restoration"]["fixtures"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["autoZ", "autoA", "z", "a"]);
}

#[test]
fn approximate_fixture_costs_can_justify_reuse_with_a_restorable_boundary() {
    let f = Fixture::new(&[
        (
            "fixtures.ts",
            r#"import {test as base} from '@playwright/test';
          async function prepare(page) { if (await page.locator('#empty').isVisible()) {
            for(let i=0;i<500;i++) await page.goto('/item');
          }}
          export const test=base.extend({cart:async({page},use)=>{await prepare(page);await use(page);}});"#,
        ),
        (
            "case.spec.ts",
            "import {test} from './fixtures';test('a',async({cart})=>{await cart.goto('/a');});test('b',async({cart})=>{await cart.goto('/b');});test('c',async({cart})=>{await cart.goto('/c');});test('d',async({cart})=>{await cart.goto('/d');});test('e',async({cart})=>{await cart.goto('/e');});",
        ),
    ]);
    let p = f.plan();
    let estimate = &test(&p, "a")["fixtureEstimate"];
    assert!(
        estimate["estimatedPoints"].as_u64().unwrap()
            > estimate["lowerBoundPoints"].as_u64().unwrap()
    );
    assert_eq!(estimate["confidence"], "medium");
    assert!(
        !p["assessment"]["costPlan"]["selected"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert_eq!(p["assessment"]["costBasis"], "approximate-operation-points");
    assert_eq!(test(&p, "a")["disposition"], "automatic");
    assert!(
        p["checkpoints"]
            .as_array()
            .unwrap()
            .iter()
            .any(|c| c["depth"] == 0 && c["automatic"] == true)
    );
}

#[test]
fn approximate_counts_preserve_small_unknown_and_non_database_fixture_controls() {
    let f = Fixture::new(&[(
        "case.spec.ts",
        &format!(
            r#"{IMPORT}
      test('small',async({{page}})=>{{if(await page.locator('#x').isVisible()) await page.goto('/');}});
      test('unknown',async({{page}})=>{{await unprovidedClient.query('SELECT lots');}});
      test('loop',async({{page}})=>{{for(const item of await page.locator('li').all()) await item.click();}});
    "#
        ),
    )]);
    let p = f.plan();
    let small = &test(&p, "small")["steps"][0]["estimate"];
    assert!(small["estimatedPoints"].as_u64().unwrap() < 9);
    assert_eq!(
        test(&p, "unknown")["steps"][0]["estimate"]["estimatedPoints"],
        0
    );
    let repeated = &test(&p, "loop")["steps"][0]["estimate"];
    assert!(
        repeated["estimatedPoints"].as_u64().unwrap()
            > repeated["lowerBoundPoints"].as_u64().unwrap()
    );
    assert!(
        repeated["assumptions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v.as_str().unwrap().contains("iterations"))
    );
    assert_eq!(repeated["estimatedOperations"]["interaction"], 3.0);
    assert!(
        p["assessment"]["costPlan"]["selected"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}

#[test]
fn request_workload_bands_count_calls_and_distinguish_bulk_payloads() {
    let large = "x".repeat(70_000);
    let f = Fixture::new(&[(
        "case.spec.ts",
        &format!(
            r#"{IMPORT}
       test('small',async({{request}})=>{{await request.post('/seed',{{data:{{name:'a'}}}});}});
       test('medium',async({{request}})=>{{await request.post('/seed',{{data:{{rows:'{}'}}}});}});
       test('large',async({{request}})=>{{await request.post('/seed',{{data:{{rows:'{large}'}}}});}});
       test('runtime',async({{request}})=>{{await request.post('/seed',{{data:JSON.parse(process.env.ROWS)}});}});
    "#,
            "x".repeat(5000)
        ),
    )]);
    let p = f.plan();
    let e = |name| &test(&p, name)["steps"][0]["estimate"];
    assert!(
        e("small")["estimatedPoints"].as_u64().unwrap()
            < e("medium")["estimatedPoints"].as_u64().unwrap()
    );
    assert!(
        e("medium")["estimatedPoints"].as_u64().unwrap()
            < e("large")["estimatedPoints"].as_u64().unwrap()
    );
    for name in ["small", "medium", "large", "runtime"] {
        assert_eq!(e(name)["operations"]["request"], 1);
    }
    assert_eq!(e("runtime")["confidence"], "medium");
    assert_eq!(
        e("small")["operations"].get("database"),
        None,
        "A fixture or request alone is not proof of a database query"
    );
}

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
    assert_eq!(p["assessment"]["version"], "js-ts-points-v4");
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
       async function journey(page) {{ for(let i=0;i<300;i++) {{await page.goto('/step');}} }}
       test('a',async ({{page}})=>{{await journey(page);await page.goto('/a');}});
       test('b',async ({{page}})=>{{await journey(page);await page.goto('/b');}});
    "#
        ),
    )]);
    let p = f.plan();
    assert_eq!(points(&test(&p, "a")["steps"][0]), 2400);
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
            "import {test as base} from '@playwright/test';export const test=base.extend({cart:async({page},use)=>{for(let i=0;i<300;i++){await page.goto('/cart');}await use(page);}});",
        ),
        (
            "case.spec.ts",
            r#"import {test} from './fixtures';test('a',async({cart})=>{await cart.click('#x');await cart.click('#a');});test('b',async({cart})=>{await cart.click('#x');await cart.click('#b');});"#,
        ),
    ]);
    let p = f.plan();
    assert_eq!(test(&p, "a")["fixtureEstimate"]["points"], 2400);
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
            .any(|d| d["combinedUnits"] == 2401)
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

#[test]
fn recursively_resolves_barrels_json_and_pure_helpers() {
    let f = Fixture::new(&[
        (
            "data.json",
            r#"{"path":"/cart","fields":{"one":"a","two":"b"}}"#,
        ),
        ("barrel.ts", "export * from '@playwright/test';"),
        (
            "helpers.ts",
            r#"import data from './data.json'; export async function prepare(page){ const parsed=JSON.parse(JSON.stringify(data)); if(typeof parsed.path!=='string')throw new Error('invalid path'); await page.goto(parsed.path); for(const [name,value] of Object.entries(data.fields)){await page.locator(name).fill(value);} }"#,
        ),
        (
            "case.spec.ts",
            "import {test,expect} from './barrel';import {prepare} from './helpers';test('a',async({page})=>{await prepare(page);await expect(page).toHaveURL('/cart');});",
        ),
    ]);
    let p = f.plan();
    let s = &test(&p, "a")["steps"];
    assert_eq!(points(&s[0]), 10);
    assert_eq!(s[0]["estimate"]["complete"], true);
    assert_eq!(points(&s[1]), 1);
    assert_eq!(s[1]["estimate"]["complete"], true);
}

#[test]
fn browser_context_response_and_promise_chains_keep_receiver_types() {
    let f = Fixture::new(&[(
        "case.spec.ts",
        &format!(
            r#"{IMPORT}
      test('a',async({{page}})=>{{
        const context=page.context();
        await context.cookies();
        const data=await page.request.get('/data').then(response=>response.json());
        const url=page.url();
        await page.goto(url);
      }});
    "#
        ),
    )]);
    let p = f.plan();
    let s = test(&p, "a")["steps"].as_array().unwrap();
    assert!(s.iter().all(|s| s["estimate"]["complete"] == true), "{s:?}");
    assert_eq!(points(&s[0]), 0);
    assert_eq!(points(&s[2]), 4);
    assert_eq!(points(&s[3]), 0);
    assert_eq!(points(&s[4]), 8);
}

#[test]
fn tracks_unary_switch_break_continue_and_terminating_while_loops() {
    let f = Fixture::new(&[(
        "case.spec.ts",
        &format!(
            r#"{IMPORT}
      async function prepare(page){{
        for(let i=0;i<5;i++){{if(i===1)continue;if(i===4)break;await page.click('#x');}}
        let left=2;while(left>0){{await page.goto('/');left--;}}
        switch(2){{case 1:await page.click('#unused');break;case 2:await page.click('#x');break;default:throw new Error('bad');}}
      }}
      test('a',async({{page}})=>{{await prepare(page);}});
    "#
        ),
    )]);
    let p = f.plan();
    let s = &test(&p, "a")["steps"][0];
    assert_eq!(points(s), 20);
    assert_eq!(s["estimate"]["complete"], true);
}

#[test]
fn inherited_methods_getters_and_class_fields_are_recursively_assessed() {
    let f = Fixture::new(&[
        (
            "helpers.ts",
            r#"export class Base {constructor(protected page:any){} get button(){return this.page.locator('#submit');} async open(){await this.page.goto('/');}} export class Checkout extends Base {readonly label='ready';async ready(){await this.open();await this.button.click();}}"#,
        ),
        (
            "case.spec.ts",
            &format!(
                "{IMPORT} import {{Checkout}} from './helpers';test('a',async({{page}})=>{{const checkout=new Checkout(page);await checkout.ready();}});"
            ),
        ),
    ]);
    let p = f.plan();
    let s = &test(&p, "a")["steps"][1];
    assert_eq!(points(s), 9);
    assert_eq!(s["estimate"]["complete"], true);
}

#[test]
fn runtime_data_helpers_do_not_erase_the_cost_of_known_browser_work() {
    let f = Fixture::new(&[
        (
            "helpers.ts",
            r#"import fs from 'node:fs';import path from 'node:path';export function config(){const file=path.join('config','data.json');if(!fs.existsSync(file))return [];try{return JSON.parse(fs.readFileSync(file,'utf8').trim());}catch{return [];}}"#,
        ),
        (
            "case.spec.ts",
            &format!(
                "{IMPORT} import {{config}} from './helpers';test('a',async({{page}})=>{{config();await page.goto('/');}});"
            ),
        ),
    ]);
    let p = f.plan();
    let t = test(&p, "a");
    assert!(t["estimate"]["lowerBoundPoints"].as_u64().unwrap() >= 8);
    assert!(
        t["steps"][0]["estimate"]["upperBoundPoints"].is_number(),
        "local data processing has a bounded operation cost"
    );
}

#[test]
fn runtime_early_returns_bound_the_remaining_helper_body() {
    let f = Fixture::new(&[(
        "case.spec.ts",
        &format!(
            r#"{IMPORT}
      async function maybe(page){{if(await page.isVisible('#ready'))return;for(let i=0;i<80;i++){{await page.goto('/');}}}}
      test('a',async({{page}})=>{{await maybe(page);await page.goto('/a');}});
    "#
        ),
    )]);
    let p = f.plan();
    let s = &test(&p, "a")["steps"][0];
    assert_eq!(s["estimate"]["lowerBoundPoints"], 1);
    assert_eq!(s["estimate"]["upperBoundPoints"], 641);
    assert_eq!(test(&p, "a")["estimate"]["lowerBoundPoints"], 9);
}

#[test]
fn known_expensive_work_can_justify_reuse_despite_an_unpriced_dependency() {
    let f = Fixture::new(&[
        (
            "fixtures.ts",
            "import {test as base} from '@playwright/test';export const test=base.extend({ready:async({page},use)=>{await opaqueDependency();await use(page);}});",
        ),
        (
            "case.spec.ts",
            "import {test} from './fixtures';async function prepare(page){for(let i=0;i<300;i++){await page.goto('/');}}test('a',async({ready})=>{await prepare(ready);await ready.click('#a');});test('b',async({ready})=>{await prepare(ready);await ready.click('#b');});",
        ),
    ]);
    let p = f.plan();
    assert_eq!(test(&p, "a")["fixtureEstimate"]["complete"], false);
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
            .any(|d| d["combinedUnits"] == 2400)
    );
}

#[test]
fn pure_unknown_length_collection_processing_does_not_become_browser_work() {
    let f = Fixture::new(&[(
        "case.spec.ts",
        &format!(
            r#"{IMPORT}
      function clean(values){{const output=[];for(const value of values){{if(!value)continue;output.push(String(value).trim());}}return output;}}
      test('a',async({{page}})=>{{const payload=await page.request.get('/data').then(r=>r.json());clean(payload.items);await page.goto('/');}});
    "#
        ),
    )]);
    let p = f.plan();
    let s = &test(&p, "a")["steps"][1];
    assert_eq!(s["estimate"]["lowerBoundPoints"], 0);
    assert_eq!(s["estimate"]["upperBoundPoints"], 0);
    assert_eq!(test(&p, "a")["estimate"]["lowerBoundPoints"], 12);
}

#[test]
fn top_level_conditional_exit_and_block_shadowing_do_not_invent_savings() {
    let f = Fixture::new(&[(
        "case.spec.ts",
        &format!(
            r#"{IMPORT}
      test('a',async({{page}})=>{{if(await page.isVisible('#done'))return;for(let i=0;i<80;i++){{await page.goto('/');}}await page.click('#a');}});
      test('b',async({{page}})=>{{if(await page.isVisible('#done'))return;for(let i=0;i<80;i++){{await page.goto('/');}}await page.click('#b');}});
      test('shadow',async({{page}})=>{{let count=0;{{let count=80;}}for(let i=0;i<count;i++){{await page.goto('/');}}}});
    "#
        ),
    )]);
    let p = f.plan();
    assert_eq!(test(&p, "a")["steps"][1]["estimate"]["lowerBoundPoints"], 0);
    assert_eq!(points(&test(&p, "shadow")["steps"][2]), 0);
    assert_eq!(p["assessment"]["costPlan"]["selected"], json!([]));
}

#[test]
fn deterministic_recursion_is_expanded_until_its_base_case() {
    let f = Fixture::new(&[(
        "case.spec.ts",
        &format!(
            r#"{IMPORT}
      async function repeat(page,n){{if(n<=0)return;await page.click('#x');await repeat(page,n-1);}}
      test('a',async({{page}})=>{{await repeat(page,4);}});
    "#
        ),
    )]);
    let p = f.plan();
    let s = &test(&p, "a")["steps"][0];
    assert_eq!(points(s), 4);
    assert_eq!(s["estimate"]["complete"], true);
}

#[test]
fn spread_and_mutable_local_collections_preserve_known_iteration_counts() {
    let f = Fixture::new(&[(
        "case.spec.ts",
        &format!(
            r#"{IMPORT}
      test('a',async({{page}})=>{{const initial=[1,2];const values=[...initial,3];const options={{...{{a:1}},b:2}};for(const n of values){{await page.click('#x');}}for(const [key,value] of Object.entries(options)){{await page.fill(key,String(value));}}}});
    "#
        ),
    )]);
    let p = f.plan();
    let s = &test(&p, "a")["steps"];
    assert_eq!(points(&s[3]), 3);
    assert_eq!(points(&s[4]), 2);
}

#[test]
fn fixture_metadata_typed_parameters_and_collection_types_survive_recursive_analysis() {
    let f = Fixture::new(&[
        (
            "fixtures.ts",
            r#"import {test as base} from '@playwright/test';export const scenario=base.extend({ready:async({page},use)=>{const worker=scenario.info().parallelIndex;const project=scenario.info().project.name;await use(page);}});"#,
        ),
        (
            "case.spec.ts",
            r#"import {scenario} from './fixtures';function pattern(value:string){return new RegExp(value.replace('x','y'));}scenario('a',async({ready})=>{pattern(runtimeValue);const seen=new Map();const payload=await ready.request.get('/items').then(r=>r.json());for(const item of payload.items){seen.set(String(item.id),true);}const items=[...seen];items.every(([key,value])=>seen.get(key)===value);await ready.goto('/');});"#,
        ),
    ]);
    let p = f.plan();
    let t = test(&p, "a");
    assert_eq!(t["fixtureEstimate"]["upperBoundPoints"], 0);
    assert_eq!(t["steps"][0]["estimate"]["upperBoundPoints"], 0);
    assert!(
        !t["estimate"]["reasons"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r.as_str().unwrap().starts_with("Unresolved")),
        "{t}"
    );
}

#[test]
fn mutations_through_helper_arguments_and_aliases_cannot_leave_stale_loop_bounds() {
    let f = Fixture::new(&[(
        "case.spec.ts",
        &format!(
            r#"{IMPORT}
      function reset(options){{options.count=0;}}
      test('helper',async({{page}})=>{{const options={{count:80}};reset(options);for(let i=0;i<options.count;i++){{await page.goto('/');}}}});
      test('alias',async({{page}})=>{{const options={{count:80}};const alias=options;alias.count=0;for(let i=0;i<options.count;i++){{await page.goto('/');}}}});
    "#
        ),
    )]);
    let p = f.plan();
    assert_eq!(
        test(&p, "helper")["steps"][2]["estimate"]["lowerBoundPoints"],
        0
    );
    assert_eq!(
        test(&p, "alias")["steps"][3]["estimate"]["lowerBoundPoints"],
        0
    );
}

#[test]
fn collection_short_circuit_and_reduce_follow_callback_control_flow() {
    let f = Fixture::new(&[(
        "case.spec.ts",
        &format!(
            r#"{IMPORT}
      test('some',async({{page}})=>{{[1,2,3].some(()=>{{page.click('#x');return true;}});}});
      test('reduce',async({{page}})=>{{const count=[1,2,3].reduce((sum,n)=>sum+n,0);for(let i=0;i<count;i++){{await page.click('#x');}}}});
      test('spread',async({{page}})=>{{const values=[...runtimeItems,await page.goto('/')];}});
    "#
        ),
    )]);
    let p = f.plan();
    // An unawaited callback has no guaranteed sequential browser time.
    assert_eq!(
        test(&p, "some")["steps"][0]["estimate"]["lowerBoundPoints"],
        0
    );
    assert_eq!(
        test(&p, "reduce")["steps"][1]["estimate"]["lowerBoundPoints"],
        6
    );
    assert_eq!(
        test(&p, "spread")["steps"][0]["estimate"]["lowerBoundPoints"],
        8
    );
}

#[test]
fn static_collections_and_assertion_callbacks_are_recursively_assessed() {
    let f = Fixture::new(&[(
        "case.spec.ts",
        &format!(
            r#"{IMPORT}
      class Monitor {{static seen=new WeakMap();constructor(private page:any){{}} start(){{if(Monitor.seen.has(this.page))return;Monitor.seen.set(this.page,true);}}}}
      test('a',async({{page}})=>{{new Monitor(page).start();await expect(async()=>{{await page.goto('/');}}).toPass();await expect.poll(async()=>{{await page.click('#x');return 1;}}).toBe(1);const values=await page.locator('p').allInnerTexts();values[0].split(' ').join('-');await page.waitForResponse('/');await page.isHidden('#x');expect(page.url()).toEqual(expect.stringContaining('x'));}});
    "#
        ),
    )]);
    let p = f.plan();
    let s = &test(&p, "a")["steps"];
    assert_eq!(s[0]["estimate"]["upperBoundPoints"], 0);
    assert_eq!(s[1]["estimate"]["lowerBoundPoints"], 8);
    assert_eq!(s[1]["estimate"]["upperBoundPoints"], Value::Null);
    assert_eq!(s[2]["estimate"]["lowerBoundPoints"], 1);
    for i in [3, 4, 5, 6, 7] {
        assert_eq!(s[i]["estimate"]["complete"], true, "step {i}: {}", s[i]);
    }
}

#[test]
fn hooks_propagate_page_objects_and_request_clients_to_test_bodies() {
    let f = Fixture::new(&[(
        "case.spec.ts",
        &format!(
            r#"{IMPORT}
      import {{request}} from '@playwright/test';
      class Client {{context;async create(){{this.context=await request.newContext();return this;}} async load(){{await this.context.get('/');}}}}
      let client;test.beforeEach(async()=>{{client=await new Client().create();}});
      test('a',async()=>{{await client.load();}});test('b',async()=>{{await client.load();}});
    "#
        ),
    )]);
    let p = f.plan();
    let t = test(&p, "a");
    assert_eq!(t["steps"][1]["estimate"]["lowerBoundPoints"], 4);
    assert!(
        !t["estimate"]["reasons"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v.as_str().unwrap().starts_with("Unresolved")),
        "{t}"
    );
}

#[test]
fn candidate_ranges_distinguish_cheap_work_from_uncertain_benefit() {
    for (prefix, classification) in [
        ("await page.goto('/');", "below-variable-cost"),
        (
            "if(runtimeCondition){for(let i=0;i<300;i++){await page.goto('/');}}",
            "shared-overhead-not-recovered",
        ),
        (
            "for(let i=0;i<300;i++){await page.goto('/');}",
            "estimated-saving",
        ),
    ] {
        let f = Fixture::new(&[(
            "case.spec.ts",
            &format!(
                "{IMPORT}test('a',async({{page}})=>{{{prefix}await page.click('#a');}});test('b',async({{page}})=>{{{prefix}await page.click('#b');}});"
            ),
        )]);
        let p = f.plan();
        let candidates = p["assessment"]["candidates"]
            .as_array()
            .expect("explicit candidate cost ranges");
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0]["classification"], classification);
    }
}

#[test]
fn before_all_state_is_typed_recursively_but_worker_cost_is_not_repeated() {
    let f = Fixture::new(&[(
        "case.spec.ts",
        &format!(
            r#"{IMPORT}
      import {{request}} from '@playwright/test';
      class Client {{context;async create(){{this.context=await request.newContext();return this;}} async load(){{await this.context.get('/');}}}}
      test.describe('group',()=>{{let client;test.beforeAll(async()=>{{client=await new Client().create();}});test('a',async()=>{{await client.load();}});test('b',async()=>{{await client.load();}});}});
    "#
        ),
    )]);
    let p = f.plan();
    let t = test(&p, "group › a");
    assert_eq!(t["steps"][0]["estimate"]["lowerBoundPoints"], 4);
    assert_eq!(t["fixtureEstimate"]["lowerBoundPoints"], 0);
    assert_eq!(t["workerEstimate"]["lowerBoundPoints"], 1);
    assert!(
        t["reasons"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r.as_str().unwrap().starts_with("beforeAll requires")),
        "runtime boundary still needs worker-state support"
    );
    assert!(
        p["checkpoints"]
            .as_array()
            .unwrap()
            .iter()
            .all(|cp| cp["automatic"] == false)
    );
}

#[test]
fn optional_switches_and_loop_exits_do_not_credit_unexecuted_work() {
    let f = Fixture::new(&[(
        "case.spec.ts",
        &format!(
            r#"{IMPORT}
      test('switch',async({{page}})=>{{switch(runtimeValue){{case 1:await page.goto('/');break;}}}});
      test('loop',async({{page}})=>{{for(const value of runtimeItems){{if(value)return;}}for(let i=0;i<80;i++){{await page.goto('/');}}}});
      test('while',async({{page}})=>{{while(runtimeValue){{return;}}for(let i=0;i<80;i++){{await page.goto('/');}}}});
      test('external',async({{page}})=>{{const options={{count:80}};unknownHelper(options);for(let i=0;i<options.count;i++){{await page.goto('/');}}}});
    "#
        ),
    )]);
    let p = f.plan();
    assert_eq!(
        test(&p, "switch")["steps"][0]["estimate"]["lowerBoundPoints"],
        0
    );
    for name in ["loop", "while"] {
        assert_eq!(
            test(&p, name)["steps"][1]["estimate"]["lowerBoundPoints"],
            0
        );
    }
    assert_eq!(
        test(&p, "external")["steps"][2]["estimate"]["lowerBoundPoints"],
        0
    );
}

#[test]
fn class_initializers_follow_constructor_and_super_order() {
    let f = Fixture::new(&[(
        "case.spec.ts",
        &format!(
            r#"{IMPORT}
      class Base{{count=80;constructor(){{this.count=0;}}}}
      class Child extends Base{{count=80;constructor(){{super();this.count=0;}}}}
      test('base',async({{page}})=>{{const value=new Base();for(let i=0;i<value.count;i++){{await page.goto('/');}}}});
      test('derived',async({{page}})=>{{const value=new Child();for(let i=0;i<value.count;i++){{await page.goto('/');}}}});
    "#
        ),
    )]);
    let p = f.plan();
    for name in ["base", "derived"] {
        assert_eq!(
            test(&p, name)["steps"][1]["estimate"]["lowerBoundPoints"],
            0
        );
    }
}

#[test]
fn installed_package_exports_and_transitive_helpers_are_assessed_and_fingerprinted() {
    let f = Fixture::new(&[
        (
            "node_modules/@example/journey/package.json",
            r#"{"name":"@example/journey","exports":{".":{"types":"./missing.d.ts","import":"./entry.js","require":"./legacy.cjs"}}}"#,
        ),
        (
            "node_modules/@example/journey/entry.js",
            "export {open} from './steps.js';",
        ),
        (
            "node_modules/@example/journey/steps.js",
            "export async function open(page){await page.goto('/');await page.click('#ready');}",
        ),
        (
            "node_modules/@example/journey/legacy.cjs",
            "exports.open=async(page)=>{await page.click('#legacy');};",
        ),
        (
            "node_modules/unused/bad.spec.js",
            "this is not valid JavaScript !!!",
        ),
        (
            "case.spec.ts",
            &format!(
                "{IMPORT}import {{open}} from '@example/journey';test('a',async({{page}})=>{{await open(page);}});"
            ),
        ),
        (
            "other.spec.cjs",
            "const {test}=require('@playwright/test');const {open}=require('@example/journey');test('b',async({page})=>{await open(page);});",
        ),
    ]);
    let p = f.plan();
    assert_eq!(test(&p, "a")["steps"][0]["estimate"]["lowerBoundPoints"], 9);
    assert_eq!(test(&p, "b")["steps"][0]["estimate"]["lowerBoundPoints"], 1);
    let paths: Vec<_> = p["sources"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v["path"].as_str().unwrap())
        .collect();
    assert!(paths.contains(&"node_modules/@example/journey/package.json"));
    assert!(paths.contains(&"node_modules/@example/journey/steps.js"));
    assert!(!paths.iter().any(|p| p.contains("unused")));
    fs::write(
        f.0.join("src/node_modules/@example/journey/steps.js"),
        "export async function open(page){await page.goto('/');}",
    )
    .unwrap();
    let updated = f.plan();
    assert_ne!(p["sourceDigest"], updated["sourceDigest"]);
    assert_eq!(
        test(&updated, "a")["steps"][0]["estimate"]["lowerBoundPoints"],
        8
    );
}

#[test]
fn package_resolution_preserves_condition_order_subpaths_and_nested_versions() {
    let f = Fixture::new(&[
        (
            "node_modules/steps/package.json",
            r#"{"exports":{".":{"node":"./node.js","default":"./default.js"},"./helpers/*":"./src/*.js"}}"#,
        ),
        (
            "node_modules/steps/node.js",
            "export async function run(page){await page.goto('/');}",
        ),
        (
            "node_modules/steps/default.js",
            "export async function run(page){await page.click('#wrong');}",
        ),
        (
            "node_modules/steps/src/add.js",
            "export async function add(page){await page.fill('#q','x');}",
        ),
        (
            "nested/node_modules/steps/package.json",
            r#"{"main":"index.js"}"#,
        ),
        (
            "nested/node_modules/steps/index.js",
            "export async function run(page){await page.click('#local');}",
        ),
        (
            "case.spec.ts",
            &format!(
                "{IMPORT}import {{run}} from 'steps';import {{add}} from 'steps/helpers/add';test('a',async({{page}})=>{{await run(page);await add(page);}});"
            ),
        ),
        (
            "nested/case.spec.ts",
            &format!(
                "{IMPORT}import {{run}} from 'steps';test('b',async({{page}})=>{{await run(page);}});"
            ),
        ),
    ]);
    let p = f.plan();
    assert_eq!(test(&p, "a")["estimate"]["lowerBoundPoints"], 9);
    assert_eq!(test(&p, "b")["estimate"]["lowerBoundPoints"], 1);
}

#[test]
fn dependency_effect_analysis_distinguishes_data_libraries_from_io_and_callbacks() {
    let f = Fixture::new(&[
        (
            "node_modules/data-kit/package.json",
            r#"{"exports":"./index.js"}"#,
        ),
        (
            "node_modules/data-kit/index.js",
            "export const data={person:{name(){return ['one','two'][Math.floor(Math.random()*2)];}}};export function apply(callback){return callback();}",
        ),
        ("node_modules/io-kit/package.json", r#"{"main":"index.js"}"#),
        (
            "node_modules/io-kit/index.js",
            "import {readFileSync} from 'node:fs';export function load(){return readFileSync('input.json','utf8');}",
        ),
        (
            "case.spec.ts",
            &format!(
                "{IMPORT}import {{data,apply}} from 'data-kit';import {{load}} from 'io-kit';test('a',async({{page}})=>{{const name=data.person.name();await page.fill('#name',name);load();await apply(async()=>{{await page.goto('/');}});}});"
            ),
        ),
    ]);
    let p = f.plan();
    let s = &test(&p, "a")["steps"];
    assert_eq!(s[0]["estimate"]["lowerBoundPoints"], 0);
    assert_eq!(s[0]["estimate"]["upperBoundPoints"], 0);
    assert_eq!(s[1]["estimate"]["lowerBoundPoints"], 1);
    assert_eq!(s[2]["estimate"]["lowerBoundPoints"], 1);
    assert_eq!(s[3]["estimate"]["lowerBoundPoints"], 8);
    assert!(
        !test(&p, "a")["estimate"]["reasons"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r.as_str().unwrap().starts_with("Unresolved"))
    );
}

#[test]
fn missing_packages_are_explicit_analysis_gaps_and_never_free_operations() {
    let f = Fixture::new(&[(
        "case.spec.ts",
        &format!(
            "{IMPORT}import {{run}} from 'uninstalled-helper';test('a',async({{page}})=>{{await run();await page.goto('/');}});"
        ),
    )]);
    let p = f.plan();
    let s = &test(&p, "a")["steps"][0];
    assert_eq!(s["estimate"]["upperBoundPoints"], Value::Null);
    assert!(
        s["estimate"]["issues"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["kind"] == "missing-dependency")
    );
    assert_eq!(test(&p, "a")["steps"][1]["estimate"]["lowerBoundPoints"], 8);
}

#[test]
fn closed_bundled_data_objects_get_generic_effect_summaries_without_running_them() {
    let f = Fixture::new(&[
        (
            "node_modules/bundled-kit/package.json",
            r#"{"exports":"./index.js"}"#,
        ),
        (
            "node_modules/bundled-kit/index.js",
            "const methods={one:()=>Math.random(),two:()=>Date.now()};class Kit{data(){return methods[Math.random()?'one':'two']();}read(){return this['data']();}}export const kit=new Kit();",
        ),
        (
            "case.spec.ts",
            &format!(
                "{IMPORT}import {{kit}} from 'bundled-kit';test('a',async({{page}})=>{{const value=kit.read();await page.fill('#value',String(value));}});"
            ),
        ),
    ]);
    let p = f.plan();
    let t = test(&p, "a");
    assert_eq!(t["estimate"]["lowerBoundPoints"], 1);
    assert_eq!(t["estimate"]["upperBoundPoints"], 1);
    assert_eq!(t["estimate"]["analysisComplete"], true);
    assert!(
        p["assessment"]["dependencyAnalysis"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v["dataOnly"] == true)
    );
}

#[test]
fn effect_summaries_never_hide_ambient_io_or_dynamic_code() {
    for source in [
        "class Kit{async load(){await fetch('/');}}export const kit=new Kit();",
        "class Kit{run(value){return value['constructor']['constructor']('return fetch(1)')();}}export const kit=new Kit();",
        "import {writeFileSync} from 'node:fs';class Kit{run(){writeFileSync('x','y');}}export const kit=new Kit();",
    ] {
        let f = Fixture::new(&[
            (
                "node_modules/unsafe-kit/package.json",
                r#"{"main":"index.js"}"#,
            ),
            ("node_modules/unsafe-kit/index.js", source),
            (
                "case.spec.ts",
                &format!(
                    "{IMPORT}import {{kit}} from 'unsafe-kit';test('a',async()=>{{await kit.run({{}});}});"
                ),
            ),
        ]);
        let p = f.plan();
        assert!(
            p["assessment"]["dependencyAnalysis"]
                .as_array()
                .unwrap()
                .iter()
                .all(|v| v["dataOnly"] == false)
        );
        assert_ne!(test(&p, "a")["estimate"]["upperBoundPoints"], 0);
    }
}

#[test]
fn data_library_callbacks_and_opaque_inputs_are_resolved_from_method_bodies() {
    let f = Fixture::new(&[
        (
            "node_modules/value-kit/package.json",
            r#"{"main":"index.js"}"#,
        ),
        (
            "node_modules/value-kit/index.js",
            "class Kit{choose(values){if(values.length===0)throw new Error('empty');return values[0];}async apply(callback){return await callback();}}export const kit=new Kit();",
        ),
        (
            "case.spec.ts",
            &format!(
                "{IMPORT}import {{kit}} from 'value-kit';test('a',async({{page}})=>{{kit.choose(runtimeItems);await kit.apply(async()=>{{await page.goto('/');}});expect.soft('x').toBe('x');await expect.soft(page.locator('#x')).toBeVisible();}});"
            ),
        ),
    ]);
    let p = f.plan();
    let s = &test(&p, "a")["steps"];
    assert_eq!(s[0]["estimate"]["upperBoundPoints"], 0);
    assert_eq!(s[1]["estimate"]["lowerBoundPoints"], 8);
    assert_eq!(s[2]["estimate"]["upperBoundPoints"], 0);
    assert_eq!(s[3]["estimate"]["lowerBoundPoints"], 1);
    assert_eq!(test(&p, "a")["estimate"]["analysisComplete"], true);
}

#[test]
fn blocked_exports_and_node_builtins_cannot_resolve_to_unrelated_packages() {
    let f = Fixture::new(&[
        (
            "node_modules/blocked/package.json",
            r#"{"exports":{"node":null,"default":"./fallback.js"}}"#,
        ),
        (
            "node_modules/blocked/fallback.js",
            "export async function run(page){await page.goto('/wrong');}",
        ),
        ("node_modules/fs/package.json", r#"{"main":"index.js"}"#),
        (
            "node_modules/fs/index.js",
            "export function readFileSync(){return 'wrong';}",
        ),
        (
            "case.spec.ts",
            &format!(
                "{IMPORT}import {{run}} from 'blocked';import {{readFileSync}} from 'fs';test('a',async({{page}})=>{{await run(page);readFileSync('data');}});"
            ),
        ),
    ]);
    let p = f.plan();
    let s = &test(&p, "a")["steps"];
    assert_eq!(s[0]["estimate"]["lowerBoundPoints"], 0);
    assert_eq!(s[0]["estimate"]["upperBoundPoints"], Value::Null);
    assert_eq!(s[1]["estimate"]["lowerBoundPoints"], 1);
    assert!(
        !p["sources"]
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s["path"] == "node_modules/fs/index.js")
    );
}

#[test]
fn async_library_callbacks_and_ts_access_modifiers_preserve_concurrency_bounds() {
    let f = Fixture::new(&[
        (
            "node_modules/callback-kit/package.json",
            r#"{"main":"index.js"}"#,
        ),
        (
            "node_modules/callback-kit/index.js",
            "class Kit{async apply(callback){return await callback();}}export const kit=new Kit();",
        ),
        (
            "case.spec.ts",
            &format!(
                "{IMPORT}import {{kit}} from 'callback-kit';class Task{{public async run(page){{await page.goto('/');}}}}test('a',async({{page}})=>{{kit.apply(async()=>{{await page.goto('/');}});new Task().run(page);await page.click('#end');}});"
            ),
        ),
    ]);
    let p = f.plan();
    let s = &test(&p, "a")["steps"];
    for i in 0..2 {
        {
            assert_eq!(s[i]["estimate"]["lowerBoundPoints"], 0);
            assert_eq!(s[i]["estimate"]["upperBoundPoints"], Value::Null);
        }
    }
}

#[test]
fn analysis_status_distinguishes_runtime_ranges_from_missing_implementation() {
    for (body, status, expected) in [
        ("if(runtimeFlag){await page.goto('/');}", "complete", 1),
        ("await unavailableHelper();", "partial", 0),
    ] {
        let f = Fixture::new(&[(
            "case.spec.ts",
            &format!("{IMPORT}test('a',async({{page}})=>{{{body}}});"),
        )]);
        let p = f.plan();
        assert_eq!(p["assessment"]["analysis"]["status"], status);
        assert_eq!(p["assessment"]["analysis"]["analyzedStatements"], expected);
        assert_eq!(p["assessment"]["analysis"]["totalStatements"], 1);
    }
}

#[test]
fn star_reexports_do_not_shadow_javascript_globals_in_worker_fixtures() {
    let f = Fixture::new(&[
        (
            "fixtures.ts",
            r#"import {test as base} from '@playwright/test';import fs from 'node:fs';export * from '@playwright/test';export const test=base.extend({ready:[async({browser},use)=>{const parsed=JSON.parse(fs.readFileSync('state.json','utf8'));const seen=new Set(parsed.items);const context=await browser.newContext();const page=await context.newPage();await Promise.race([page.waitForURL('/'),page.waitForSelector('#ready')]);await test.info().attach('state',{body:JSON.stringify(parsed)});await use(page);},{scope:'worker'}]});"#,
        ),
        (
            "case.spec.ts",
            "import {test} from './fixtures';test('a',async({ready})=>{await ready.goto('/');});",
        ),
    ]);
    let p = f.plan();
    let t = test(&p, "a");
    assert_eq!(
        t["workerEstimate"]["analysisComplete"], true,
        "{}",
        t["workerEstimate"]
    );
    assert_eq!(t["steps"][0]["estimate"]["lowerBoundPoints"], 8);
}

#[test]
fn minified_module_classes_keep_constructor_types() {
    let f = Fixture::new(&[
        (
            "helpers.js",
            "var Failure=class extends Error{};export function validate(items){if(items.length===0)throw new Failure('empty');return items[0];}",
        ),
        (
            "case.spec.ts",
            &format!(
                "{IMPORT}import {{validate}} from './helpers';test('a',async()=>{{validate(runtimeItems);}});"
            ),
        ),
    ]);
    let p = f.plan();
    assert_eq!(test(&p, "a")["estimate"]["analysisComplete"], true);
}

#[test]
fn data_summaries_are_invalidated_after_runtime_capabilities_escape_into_library_state() {
    let f = Fixture::new(&[
        (
            "node_modules/stateful-kit/package.json",
            r#"{"main":"index.js"}"#,
        ),
        (
            "node_modules/stateful-kit/index.js",
            "class Kit{run(){return this.page.goto('/');}}export const kit=new Kit();export function configure(page){kit.page=page;}",
        ),
        (
            "case.spec.ts",
            &format!(
                "{IMPORT}import {{kit,configure}} from 'stateful-kit';test('a',async({{page}})=>{{configure(page);await kit.run();}});"
            ),
        ),
    ]);
    let p = f.plan();
    assert_ne!(
        test(&p, "a")["steps"][1]["estimate"]["upperBoundPoints"],
        0,
        "runtime capabilities cannot become free data work"
    );
}

#[test]
fn local_loop_and_catch_variables_do_not_make_module_constructors_mutable() {
    let f = Fixture::new(&[
        (
            "helpers.js",
            "var E=class extends Error{};function other(){for(let E=0;E<3;E++){}try{throw 1;}catch(E){E=2;}}export function validate(v){if(v.length===0)throw new E('empty');return v[0];}",
        ),
        (
            "case.spec.ts",
            &format!(
                "{IMPORT}import {{validate}} from './helpers';test('a',async()=>{{validate(runtimeItems);}});"
            ),
        ),
    ]);
    let p = f.plan();
    assert_eq!(test(&p, "a")["estimate"]["analysisComplete"], true);
}

#[test]
fn direct_and_builtin_library_mutations_invalidate_data_summaries() {
    for setup in [
        "kit.page=page;",
        "kit['page']=page;",
        "Object.assign(kit,{page});",
    ] {
        let f = Fixture::new(&[
            (
                "node_modules/stateful-kit/package.json",
                r#"{"main":"index.js"}"#,
            ),
            (
                "node_modules/stateful-kit/index.js",
                "class Kit{run(){return this.page.goto('/');}}export const kit=new Kit();",
            ),
            (
                "case.spec.ts",
                &format!(
                    "{IMPORT}import {{kit}} from 'stateful-kit';test('a',async({{page}})=>{{{setup}await kit.run();}});"
                ),
            ),
        ]);
        let p = f.plan();
        assert_ne!(
            test(&p, "a")["steps"][1]["estimate"]["upperBoundPoints"],
            0,
            "{setup}"
        );
    }
}

#[test]
fn shared_library_mutations_are_conservative_across_test_order() {
    let f = Fixture::new(&[
        (
            "node_modules/stateful-kit/package.json",
            r#"{"main":"index.js"}"#,
        ),
        (
            "node_modules/stateful-kit/index.js",
            "class Kit{run(){return this.page.goto('/');}}export const kit=new Kit();export function configure(page){kit.page=page;}",
        ),
        (
            "case.spec.ts",
            &format!(
                "{IMPORT}import {{kit,configure}} from 'stateful-kit';test('read',async()=>{{await kit.run();}});test('write',async({{page}})=>{{configure(page);}});"
            ),
        ),
    ]);
    let p = f.plan();
    assert_ne!(
        test(&p, "read")["steps"][0]["estimate"]["upperBoundPoints"],
        0
    );
}

#[test]
fn installed_package_analysis_follows_exported_javascript_before_adjacent_typescript() {
    let f = Fixture::new(&[
        (
            "node_modules/published-kit/package.json",
            r#"{"exports":"./index.js"}"#,
        ),
        (
            "node_modules/published-kit/index.js",
            "export async function visit(page){await page.goto('/');}",
        ),
        (
            "node_modules/published-kit/index.ts",
            "export async function visit(page){for(let i=0;i<50;i++){await page.goto('/');}}",
        ),
        (
            "case.spec.ts",
            &format!(
                "{IMPORT}import {{visit}} from 'published-kit';test('a',async({{page}})=>{{await visit(page);}});"
            ),
        ),
    ]);
    let p = f.plan();
    assert_eq!(test(&p, "a")["steps"][0]["estimate"]["lowerBoundPoints"], 8);
}

#[test]
fn template_titles_and_unnamed_suites_are_assessed_with_native_modifiers_preserved() {
    let f = Fixture::new(&[(
        "case.spec.ts",
        &format!(
            r#"{IMPORT}
      test(`template title`,async({{page}})=>{{await page.goto('/');}});
      test.describe(()=>{{test.skip(runtimeFlag,'optional');test('nested',async({{page}})=>{{await page.goto('/');}});}});
      test('outside',async({{page}})=>{{await page.goto('/');}});
    "#
        ),
    )]);
    let p = f.plan();
    assert_eq!(p["tests"].as_array().unwrap().len(), 3);
    assert_eq!(
        test(&p, "template title")["estimate"]["lowerBoundPoints"],
        8
    );
    assert_eq!(test(&p, "nested")["disposition"], "adapter-required");
    assert_ne!(test(&p, "nested")["scope"], test(&p, "outside")["scope"]);
    assert_eq!(p["diagnostics"].as_array().unwrap().len(), 0);
}

#[test]
fn deterministic_parameterized_registration_preserves_inputs_and_costs() {
    let f = Fixture::new(&[
        (
            "cases.json",
            r#"[{"name":"a","count":2},{"name":"b","count":3}]"#,
        ),
        (
            "case.spec.ts",
            &format!(
                r#"{IMPORT}import cases from './cases.json';
        test.describe('data',()=>{{
          for(const {{name,count}} of cases){{test(`case ${{name}}`,async({{page}})=>{{for(let i=0;i<count;i++){{await page.goto('/');}}}});}}
          [1,2].forEach((count)=>{{test(`mapped ${{count}}`,async({{page}})=>{{for(let i=0;i<count;i++){{await page.click('#x');}}}});}});
        }});
      "#
            ),
        ),
    ]);
    let p = f.plan();
    assert_eq!(p["tests"].as_array().unwrap().len(), 4);
    for (title, points) in [
        ("data › case a", 16),
        ("data › case b", 24),
        ("data › mapped 1", 1),
        ("data › mapped 2", 2),
    ] {
        assert_eq!(
            test(&p, title)["estimate"]["lowerBoundPoints"],
            points,
            "{title}"
        );
        assert_eq!(test(&p, title)["disposition"], "adapter-required");
    }
    assert_eq!(p["diagnostics"].as_array().unwrap().len(), 0);
    assert_ne!(
        test(&p, "data › case a")["scope"],
        test(&p, "data › case b")["scope"]
    );
}

#[test]
fn metadata_platform_dates_and_urls_keep_static_operation_types() {
    let f = Fixture::new(&[(
        "case.spec.ts",
        &format!(
            r#"{IMPORT}import assert from 'node:assert';
      test('a',async({{page}},info)=>{{const stamp=String(new Date().getDate()).padStart(2,'0');const iso=new Date().toISOString().split('T')[0];const url=new URL('/','https://example.test').toString();assert(url);await info.attach(stamp,{{body:iso}});const file=info.snapshotPath(stamp);await page.goto(url);}});
    "#
        ),
    )]);
    let p = f.plan();
    assert_eq!(
        test(&p, "a")["estimate"]["analysisComplete"],
        true,
        "{}",
        test(&p, "a")["estimate"]
    );
}

#[test]
fn destructured_receivers_frames_promises_and_recursive_runtime_trees_are_assessed() {
    let f = Fixture::new(&[(
        "case.spec.ts",
        &format!(
            r#"{IMPORT}
      class Scanner {{constructor(private page:any){{}} async inspect(frame){{const {{page}}=this;const child=(await frame.evaluateHandle(()=>null)).asElement();const nested=await child.contentFrame();if(nested)await this.inspect(nested);const frames=page.frames();for(const frame of frames){{const pending=new Promise((resolve,reject)=>{{setTimeout(()=>reject(new Error('timeout')),1000);}});await Promise.race([frame.evaluate('true'),pending]);}}}}}}
      test('a',async({{page}})=>{{const scan=new Scanner(page);await scan.inspect(page.mainFrame());const caught=(promise)=> (promise.catch(()=>{{}}),promise);await caught(page.goto('/'));}});
    "#
        ),
    )]);
    let p = f.plan();
    assert_eq!(
        test(&p, "a")["estimate"]["analysisComplete"],
        true,
        "{}",
        test(&p, "a")["estimate"]
    );
    assert_eq!(test(&p, "a")["estimate"]["upperBoundPoints"], Value::Null);
}

#[test]
fn promise_types_and_late_lexical_bindings_survive_helper_mutations() {
    let f = Fixture::new(&[(
        "case.spec.ts",
        &format!(
            r#"{IMPORT}
      class Tasks {{items=[];add(p){{this.items.push(p);}}async read(){{const pending=this.items.map(p=>p.catch(()=>null));return (await Promise.all(pending)).flat(1);}}}}
      test('a',async({{page}})=>{{const tasks=new Tasks();tasks.add(page.goto('/'));await tasks.read();async function later(){{await child.goto('/');}}const child=await page.context().newPage();await later();}});
    "#
        ),
    )]);
    let p = f.plan();
    assert_eq!(
        test(&p, "a")["estimate"]["analysisComplete"],
        true,
        "{}",
        test(&p, "a")["estimate"]
    );
    assert_eq!(test(&p, "a")["steps"][5]["estimate"]["lowerBoundPoints"], 8);
}

#[test]
fn recursive_results_preserve_class_and_promise_return_types() {
    let f = Fixture::new(&[(
        "case.spec.ts",
        &format!(
            r#"{IMPORT}
      const caught=(p)=> (p.catch(()=>null),p);
      class Tree {{children=[];constructor(p){{this.p=caught(p);}}add(child){{this.children.push(child);}}async flatten(){{const parent=await this.p;const children=this.children.map(c=>c?caught(c.flatten()):[null]);return [parent,...(await Promise.all(children)).flat(1)];}}}}
      async function scan(frame){{const tree=new Tree(frame.evaluate('true'));for(const child of frame.childFrames()){{tree.add(await scan(child));}}return tree;}}
      test('a',async({{page}})=>{{const tree=await scan(page.mainFrame());await tree.flatten();}});
    "#
        ),
    )]);
    let p = f.plan();
    assert_eq!(
        test(&p, "a")["estimate"]["analysisComplete"],
        true,
        "{}",
        test(&p, "a")["estimate"]
    );
}

#[test]
fn flatten_depth_and_settled_results_do_not_invent_concrete_loop_counts() {
    let f = Fixture::new(&[(
        "case.spec.ts",
        &format!(
            r#"{IMPORT}
      test('negative',async({{page}})=>{{const xs=[[1,2,3]].flat(-1);for(const x of xs){{await page.click('#x');}}}});
      test('dynamic',async({{page}})=>{{const xs=[[1,2,3]].flat(runtimeDepth);for(const x of xs){{await page.click('#x');}}}});
      test('settled',async({{page}})=>{{const results=await Promise.allSettled([Promise.resolve(1)]);if(results[0]===1){{await page.goto('/');}}}});
    "#
        ),
    )]);
    let p = f.plan();
    assert_eq!(test(&p, "negative")["estimate"]["lowerBoundPoints"], 1);
    assert_eq!(test(&p, "dynamic")["estimate"]["lowerBoundPoints"], 0);
    assert_eq!(test(&p, "settled")["estimate"]["lowerBoundPoints"], 0);
}
