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
const IMPORT: &str = "import {test,expect} from '@playwright/test';";
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
        // Keep inspecting diagnostics, including intentionally unsupported fixtures.
        // CLI tests separately require production planning to reject these reports.
        serde_json::to_value(magelens_plan::assess(&self.0.join("src")).unwrap()).unwrap()
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
    assert_eq!(p["assessment"]["version"], "ml-duration-v1");
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
fn static_registration_tables_survive_without_any_duration_interpreter() {
    let p=Fixture::new(&[("case.cy.js",r#"
      const mode=Object.freeze({ALLOW:1});
      const pages={cart:{title:'cart',unknown:runtimeValue},compare:{title:'compare'}};
      class Cases { static types=[{type:'simple',create:p=>api(p)},{type:'bundle',create:p=>api(p)}]; }
      Object.entries(pages).forEach(([key,value])=>{it(`page ${key}`,()=>cy.visit('/'));});
      Array.from({length:3},(_,i)=>i+1).forEach(i=>{it(`run ${i}`,()=>cy.visit('/'));});
      Cases.types.forEach(row=>{it(`type ${row.type}`,()=>row.create({}));});
      [{title:'allow',value:mode.ALLOW}].forEach(row=>{it(row.title,()=>cy.visit('/'));});
    "#)]).plan();
    assert_eq!(p["tests"].as_array().unwrap().len(), 8);
    assert_eq!(p["diagnostics"], json!([]));
    assert!(
        p["tests"]
            .as_array()
            .unwrap()
            .iter()
            .all(|t| t.get("estimate").is_none())
    );
}

#[test]
fn node_unit_tests_are_not_browser_collection_failures() {
    let f = Fixture::new(&[
        ("flow.cy.js", "it('browser',()=>{cy.visit('/');});"),
        (
            "common.test.js",
            "const test=require('node:test');test('unit',()=>{});",
        ),
        (
            "module.test.mjs",
            "import test from 'node:test';test('unit',()=>{});",
        ),
    ]);
    let p = f.plan();
    assert_eq!(p["tests"].as_array().unwrap().len(), 1);
    assert_eq!(p["diagnostics"], json!([]));
}

#[test]
fn repeated_fixture_detection_does_not_require_restoration_permission() {
    let p=Fixture::new(&[("flow.spec.ts", "import {test as base} from '@playwright/test';const test=base.extend({cart:async({page},use)=>{await page.goto(process.env.CART);await use({page});}});test('one',async({cart})=>{await cart.page.goto('/one');});test('two',async({cart})=>{await cart.page.goto('/two');});")]).plan();
    assert!(
        p["tests"]
            .as_array()
            .unwrap()
            .iter()
            .all(|t| t.get("restoration").is_none())
    );
    let cp = p["checkpoints"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["depth"] == 0)
        .unwrap();
    assert_eq!(cp["consumers"].as_array().unwrap().len(), 2);
    assert_eq!(cp["automatic"], false);
    assert!(
        test(&p, "one")["fixtureSetup"][0]
            .as_str()
            .unwrap()
            .contains("process.env.CART")
    );
}
