// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
test('checkpoint adapter preserves project browser settings and enforces pinned Chrome',async()=>{
    let launched,executed,closed=false;
    const browser={version:()=> '156.0.8078.80',close:async()=>{closed=true;}};
    const sandbox={module:{exports:{}},require:id=>{
        if(id==='@playwright/test')return {chromium:{launch:async options=>{launched=options;return browser;}}};
        if(id==='@playwright/test/package.json')return {version:'1.65.0'};
        if(id==='../../../playwright/branching.cjs')return {runBranches:async options=>{executed=options;}};
        if(id==='./native.cjs')return {};
        throw new Error('Unexpected import '+id);
    }};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../branching/runners/playwright/adapter.cjs'),'utf8'),sandbox);
    const runtime=await sandbox.module.exports.open({PLAYWRIGHT_VERSION:'1.65.0',CHROME_VERSION:'156.0.8078.80',PLAYWRIGHT_BASE_URL:'https://test.invalid'},
        {launchOptions:{channel:'wrong',args:['--disable-features=ViewTransition']},contextOptions:{userAgent:'suite-agent',viewport:{width:1280,height:720}}});
    await runtime.run({workflow:'example'});await runtime.close();
    assert.equal(launched.channel,'chrome');assert.equal(launched.args[0],'--disable-features=ViewTransition');
    assert.equal(executed.contextOptions.userAgent,'suite-agent');assert.equal(executed.contextOptions.viewport.width,1280);assert.equal(closed,true);
});
