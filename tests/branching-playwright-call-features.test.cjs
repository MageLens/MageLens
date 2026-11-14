// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.
const test=require('node:test'),assert=require('node:assert/strict'),parser=require('@babel/parser');
const {playwrightCallFeature}=require('../branching/predictor/playwright-call-features.cjs');
const p=require('../branching/predictor/index.cjs');
const call=source=>parser.parseExpression(source);
test('locator spelling preserves terminal actions and lazy construction stays distinct',()=>{
    for(const source of ["page.locator('#query').fill('value')","page.getByRole('textbox').fill('value')",
        "page.locator('form').getByRole('textbox').fill('value')"])
        assert.equal(playwrightCallFeature(call(source)),'playwright.action.fill');
    assert.equal(playwrightCallFeature(call("page.getByRole('link').click()")),'playwright.action.click');
    assert.equal(playwrightCallFeature(call("page.locator('a').filter({hasText:'name'}).click()")),'playwright.action.click');
    assert.equal(playwrightCallFeature(call("page.locator('a').filter({hasText:'name'})")),null);
    assert.equal(playwrightCallFeature(call("page.goto('/catalog')")),undefined);
    assert.equal(playwrightCallFeature(call("other.locator('a').click()")),undefined);
    assert.equal(playwrightCallFeature(call("page.evaluate('value').click()")),undefined);
});
test('known DOM matchers retain assertion work without changing unknown matchers',()=>{
    for(const source of ["expect(page.locator('p')).toBeVisible()","expect(page.getByRole('alert')).toContainText('name')",
        "expect.soft(page.locator('p')).not.toHaveCount(0)"])
        assert.equal(playwrightCallFeature(call(source)),'playwright.assert.dom');
    assert.equal(playwrightCallFeature(call("expect(page).toHaveURL('/catalog')")),undefined);
    assert.equal(playwrightCallFeature(call("expect(page.locator('p')).customMatcher()")),undefined);
});
test('v6 preserves repeated work and isolates runner-dependent feature caches',()=>{
    const input={unit:'prefix',runner:'playwright',sources:[{name:'work.js',role:'work',
        source:"async function work(){await page.locator('a').click(); await page.getByRole('link').click();}"}]};
    const old=p.features({...input,featureSchema:p.REACHABLE_SCHEMA_V5});
    const current=p.features({...input,featureSchema:p.REACHABLE_SCHEMA_V6});
    const index=8+parseInt(p.sha256('call:playwright.action.click').slice(0,8),16)%504;
    assert.equal(current.vector[index],2);
    assert.equal(p.features({...input,runner:'cypress',featureSchema:p.REACHABLE_SCHEMA_V6}).vector[index],old.vector[index]);
    assert.deepEqual(p.features({...input,featureSchema:p.REACHABLE_SCHEMA_V5}),old);
    assert.equal(current.sourceDigest,old.sourceDigest);
    assert.notDeepEqual(current.vector,old.vector);
});
test('v7 distinguishes initial, parent and unknown prefix context without changing legacy vectors',()=>{
    const input={unit:'prefix',runner:'playwright',sources:[{name:'work.js',role:'work',source:"async function work(){await page.goto('/');}"}]};
    const extract=(featureSchema,segment)=>p.features({...input,featureSchema,segment});
    const initial=extract(p.REACHABLE_SCHEMA_V7,{fromDepth:0,toDepth:1});
    const parent=extract(p.REACHABLE_SCHEMA_V7,{fromDepth:1,toDepth:2});
    const unknown=extract(p.REACHABLE_SCHEMA_V7);
    assert.notDeepEqual(initial.vector,parent.vector);
    assert.notDeepEqual(parent.vector,unknown.vector);
    assert.equal(initial.sourceDigest,parent.sourceDigest);
    for(const schema of [p.REACHABLE_SCHEMA_V4,p.REACHABLE_SCHEMA_V5,p.REACHABLE_SCHEMA_V6])
        assert.deepEqual(extract(schema,{fromDepth:0,toDepth:1}),extract(schema,{fromDepth:1,toDepth:2}));
    assert.throws(()=>extract(p.REACHABLE_SCHEMA_V7,{fromDepth:-1,toDepth:2}),/Cost assessment failed/);
});
