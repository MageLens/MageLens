// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const path=require('node:path');
const {expect}=require('@playwright/test');
const assertionTimeout=30000;
const configuredExpect=expect.configure({timeout:assertionTimeout});
const observedPages=new WeakSet();
const runnerOptions={launchOptions:{args:['--disable-features=ViewTransition,ViewTransitionOnNavigation']},
    contextOptions:{ignoreHTTPSErrors:true,viewport:{width:1280,height:720},userAgent:'Playwright',serviceWorkers:'block'}};
function native(testDir) {
    return {testDir,timeout:600000,expect:{timeout:assertionTimeout},workers:1,retries:0,fullyParallel:false,forbidOnly:true,
        outputDir:process.env.MAGELENS_PERF_OUTPUT,reporter:[['line'],[path.join(__dirname,'reporter.cjs')]],
        use:{baseURL:process.env.PLAYWRIGHT_BASE_URL,channel:'chrome',headless:true,actionTimeout:30000,...runnerOptions.contextOptions,launchOptions:runnerOptions.launchOptions},
        projects:[{name:'setup',testMatch:'bootstrap.setup.js'},{name:'chromium',testMatch:'journeys.spec.js',dependencies:['setup']}]};
}
function project(manifest) {
    return {identity:'magelens-performance-checkout-v1',runnerOptions,maxCheckpointsPerTest:4,expect:configuredExpect,
        native:{config:path.join(manifest.root,'playwright.config.cjs'),splitSafe:true},
        assertCheckpoint:async runtime=>{
            await configuredExpect(runtime.page.locator('body')).toBeVisible();
            if(process.env.MAGELENS_PERF_DIAGNOSTICS==='1'&&!observedPages.has(runtime.page)) {
                observedPages.add(runtime.page);
                runtime.page.on('response',async response=>{
                    if(response.url().includes('/coupons/'))
                        console.log('Coupon response',JSON.stringify({time:Date.now(),status:response.status(),body:await response.text().catch(()=>'<unavailable>')}));
                });
            }
        },
        state:async runtime=>({url:runtime.page.url(),
            quote:runtime.sql("SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT('id',q.entity_id,'customer',q.customer_id,'items',q.items_count,'qty',q.items_qty,'coupon',q.coupon_code,'total',q.grand_total)),JSON_ARRAY()) FROM quote q JOIN customer_entity c ON c.entity_id=q.customer_id WHERE c.email='magelens.performance@example.test' AND q.is_active=1"),
            items:runtime.sql("SELECT qi.sku,qi.qty,qi.row_total FROM quote_item qi JOIN quote q ON q.entity_id=qi.quote_id JOIN customer_entity c ON c.entity_id=q.customer_id WHERE c.email='magelens.performance@example.test' AND q.is_active=1 ORDER BY qi.sku")})};
}
module.exports={native,project,runnerOptions};
