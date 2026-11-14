// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const assert = require('node:assert/strict');
const {createInstrumenter} = require('istanbul-lib-instrument');
const {createCoverageMap} = require('istanbul-lib-coverage');
const {PlaywrightState} = require('../branching/browser.cjs');
async function checkCoverage(browser) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(),'magelens-restore-coverage-'));
    const id = 'a'.repeat(32), filename = '/source/restore-fixture.js';
    const source = `function restoreOnly() { window.restoreRan = true; __mtcTemplateHit('${id}','restore'); }
function original() { window.originalRan = true; __mtcTemplateHit('${id}','original'); }
function pendingOriginal() { window.pendingOriginalRan = true; __mtcTemplateHit('${id}','pendingOriginal'); }
function suffix() { window.suffixRan = true; __mtcTemplateHit('${id}','suffix'); }
if (localStorage.getItem('initialized')) restoreOnly();
localStorage.setItem('initialized','yes');`;
    const instrumenter = createInstrumenter();
    const script = instrumenter.instrumentSync(source,filename);
    const server = http.createServer((request,response)=>{
        if (request.url==='/pending') { setTimeout(()=>response.end('ready'),150); return; }
        response.setHeader('Content-Type','text/html');response.end(`<!doctype html><title>Coverage fixture</title><!--mtc:${id}--><script>${script}</script>`);
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const state = new PlaywrightState(browser,{baseURL:`http://127.0.0.1:${server.address().port}`,
        javascriptCoverageDirectory:path.join(directory,'js'),templateCoverageDirectory:path.join(directory,'templates'),coverageRunId:'b'.repeat(32)});
    try {
        await state.open(); await state.resumeCoverage();
        await state.page.goto('/'); await state.page.evaluate(()=>window.original());
        await state.page.evaluate(()=>{ window.pendingRequest=fetch('/pending').then(()=>window.pendingOriginal()); });
        await require('../bin/browser-navigation.cjs').waitForPageCompletion(state.context);
        assert.equal(await state.page.evaluate(()=>window.pendingOriginalRan),true,'Original requests must finish before collection ends');
        await state.page.evaluate(()=>setTimeout(()=>window.pendingOriginal(),25));
        await state.freeze(); const saved = await state.save(); await state.pauseCoverage();
        assert.equal(await state.context.cookies().then(cookies=>cookies.some(cookie=>cookie.name==='application_coverage')),false);
        await state.open(saved);
        assert.equal(await state.page.evaluate(()=>window.restoreRan),true,'Restoration initialization really executed');
        assert.equal((await state.context.cookies()).some(cookie=>cookie.name==='application_coverage'),false);
        await state.resumeCoverage();
        assert.equal((await state.context.cookies()).some(cookie=>cookie.name==='application_coverage'),true);
        await state.page.evaluate(()=>window.suffix()); await state.pauseCoverage(); await state.close();
        const combined = createCoverageMap({});
        for (const file of fs.readdirSync(path.join(directory,'js'))) combined.merge(JSON.parse(fs.readFileSync(path.join(directory,'js',file))));
        const coverage = combined.fileCoverageFor(filename);
        const functions = Object.fromEntries(Object.entries(coverage.fnMap).map(([key,value])=>[value.name,coverage.f[key]]));
        assert.equal(functions.restoreOnly,0); assert.ok(functions.original>0); assert.ok(functions.suffix>0); assert.ok(functions.pendingOriginal>0);
        const hits = {};
        for (const file of fs.readdirSync(path.join(directory,'templates'))) {
            const record = JSON.parse(fs.readFileSync(path.join(directory,'templates',file)));
            for (const [statement,count] of Object.entries(record.hits[id] ?? {})) hits[statement]=(hits[statement] ?? 0)+count;
        }
        assert.equal(hits.restore ?? 0,0); assert.ok(hits.original>0); assert.ok(hits.suffix>0); assert.ok(hits.pendingOriginal>0);
        return {restorationExecuted:true,restorationExcluded:true,prefixAndSuffixPreserved:true,pendingOriginalPreserved:true};
    } finally {
        await state.close(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
        fs.rmSync(directory,{recursive:true,force:true});
    }
}
module.exports = {checkCoverage};
