// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const runner = require('../../../branching/runners/playwright/native.cjs');
const {validateNative} = require('../../../branching/suite.cjs');
(async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-native-check-'));
    try {
        const write = (name, text) => fs.writeFileSync(path.join(directory, name), text);
        const journal = path.join(directory, 'journal.jsonl');
        write('hooks.cjs', `const fs=require('node:fs');module.exports=kind=>fs.appendFileSync(${JSON.stringify(journal)},JSON.stringify(kind)+'\\n');`);
        write('setup.cjs', "module.exports=async()=>{require('./hooks.cjs')('global setup');};");
        write('teardown.cjs', "module.exports=async()=>{require('./hooks.cjs')('global teardown');};");
        write('seed.spec.ts', "import {test} from '@playwright/test';test('seed',async()=>require('./hooks.cjs')('seed'));");
        write('flow.spec.ts', `import {test as base,expect} from '@playwright/test';
const test=base.extend({token:async({},use)=>{require('./hooks.cjs')('fixture before');await use('fixture value');require('./hooks.cjs')('fixture after');}});
test.beforeEach(()=>require('./hooks.cjs')('before each'));
test.afterEach(()=>require('./hooks.cjs')('after each'));
for(let i=0;i<12;i++)test('generated '+i,async({page,token,browser})=>{expect(browser.version()).toBe('156.0.8078.80');await page.setContent('<button>'+token+'</button>');await expect(page.getByRole('button')).toHaveText('fixture value');require('./hooks.cjs')('body '+i);});
test.fixme('upstream pending',async()=>{});`);
        const config = path.join(directory, 'playwright.config.cjs');
        write('playwright.config.cjs', "module.exports={testDir:'.',globalSetup:'./setup.cjs',globalTeardown:'./teardown.cjs',timeout:15000,workers:1,use:{channel:'chrome'},projects:[{name:'setup',testMatch:'seed.spec.ts'},{name:'browser',testMatch:'flow.spec.ts',dependencies:['setup']}]};");
        const inventory = await runner.collect(config, path.join(directory, 'reports'));
        assert.equal(inventory.exitCode, 0); assert.equal(inventory.tests.length, 14);
        assert.equal(fs.existsSync(journal), false, 'collection must not execute hooks');
        const seed = inventory.tests.filter(t => t.project === 'setup');
        const main = inventory.tests.filter(t => t.project === 'browser');
        const first = await runner.run(config, path.join(directory, 'reports'), {tests: seed, teardown: false});
        validateNative(first, seed); assert.equal(first.exitCode, 0);
        const second = await runner.run(config, path.join(directory, 'reports'), {tests: main, setup: false});
        validateNative(second, main); assert.equal(second.exitCode, 0);
        assert.equal(second.results.filter(t => t.status === 'passed').length, 12);
        assert.equal(second.results.filter(t => t.status === 'skipped').length, 1);
        const events = fs.readFileSync(journal, 'utf8').trim().split('\n').map(JSON.parse);
        for (const kind of ['global setup', 'seed', 'global teardown']) assert.equal(events.filter(e => e === kind).length, 1);
        for (const kind of ['fixture before', 'fixture after', 'before each', 'after each']) assert.equal(events.filter(e => e === kind).length, 12);
        assert.equal(fs.readdirSync(directory).some(f => f.startsWith('.magelens-native-')), false);
        console.log('Native browser validation passed: 14 cases, dynamic registration, hooks, fixtures, setup, teardown and visible skip.');
    } finally { fs.rmSync(directory, {recursive: true, force: true}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
