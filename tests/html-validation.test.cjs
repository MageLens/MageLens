// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {captureHtml, auditedUrl, writeReport} = require('../bin/html-validation.cjs');

const valid = '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><title>Valid</title></head><body><p>Fine</p></body></html>';
const invalid = '<!DOCTYPE html>\n<html lang="en"><head><title>Invalid</title></head><body>\n<p id="twice">One</p>\n<div id="twice"><button>Open</div>\n</body></html>';
const page = {runner: 'cypress', spec: 'cypress/e2e/pages.cy.js', test: 'storefront › audits pages', status: 200, contentType: 'text/html; charset=UTF-8'};
const results = () => JSON.parse(fs.readFileSync('coverage/html-validation/results.json'));

function workspace(t) {
    const cwd = process.cwd();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-html-validation-'));
    t.after(() => {process.chdir(cwd); fs.rmSync(root, {recursive: true, force: true});});
    process.chdir(root);
    fs.mkdirSync('coverage');
    fs.writeFileSync('coverage/run.json', JSON.stringify({id: 'current-run'}));
    return {id: 'current-run'};
}

test('valid markup is reported as an audited page without findings', t => {
    const run = workspace(t);
    assert.equal(captureHtml({...page, url: 'https://magelens.test/valid', html: valid}), null);
    assert.deepEqual(writeReport(run), {audits: 1, pages: 1, errors: 0, warnings: 0, notValidated: 0});
    const [audit] = results().audits;
    assert.deepEqual([audit.url, audit.status, audit.target, audit.notValidated, audit.messages], ['https://magelens.test/valid', 200, 'source', null, []]);
    assert.equal(audit.capture, 'raw/html-validation/' + fs.readdirSync('coverage/raw/html-validation')[0]);
    assert.equal('html' in audit, false, 'The report data must not repeat the captured response');
    const html = fs.readFileSync('coverage/html-validation/index.html', 'utf8');
    assert.match(html, /<code>https:\/\/magelens\.test\/valid<\/code>/);
    assert.match(html, new RegExp(`Captured response: <code>coverage/${audit.capture}</code>`));
    assert.match(html, /No issues found\./);
});

test('invalid markup is captured without an error and reported with severity, rule, message and location', t => {
    const run = workspace(t);
    assert.equal(captureHtml({...page, url: 'https://magelens.test/invalid', html: invalid}), null);
    const totals = writeReport(run);
    const [audit] = results().audits;
    assert.equal(totals.errors, audit.messages.length);
    assert.equal(audit.errorCount, audit.messages.length);
    const duplicate = audit.messages.find(message => message.rule === 'no-dup-id');
    assert.deepEqual({...duplicate, ruleUrl: null}, {severity: 'error', rule: 'no-dup-id', message: 'Duplicate ID "twice"',
        line: 4, column: 10, selector: 'html > body > div', ruleUrl: null});
    assert.match(duplicate.ruleUrl, /^https:\/\/html-validate\.org\/rules\/no-dup-id\.html$/);
    assert.ok(audit.messages.some(message => message.rule === 'close-order' && message.line === 4));
});

test('one report collects every audit of a run with its page and test', t => {
    const run = workspace(t);
    captureHtml({...page, url: 'https://magelens.test/valid', html: valid});
    captureHtml({...page, runner: 'playwright', spec: 'playwright/e2e/pages.spec.js', test: 'audits <the> cart',
        url: 'https://magelens.test/invalid?step=2', status: 404, html: invalid});
    const totals = writeReport(run);
    assert.equal(totals.audits, 2);
    assert.equal(totals.pages, 2);
    assert.ok(totals.errors > 0);
    const report = results();
    assert.equal(report.run, 'current-run');
    assert.equal(report.target, 'source');
    assert.deepEqual(report.engine, {name: 'html-validate', version: require('../package.json').devDependencies['html-validate'],
        preset: 'html-validate:standard'});
    assert.deepEqual(report.audits.map(audit => [audit.url, audit.runner, audit.status, audit.errorCount > 0]).sort(),
        [['https://magelens.test/invalid?step=2', 'playwright', 404, true], ['https://magelens.test/valid', 'cypress', 200, false]]);
    const html = fs.readFileSync('coverage/html-validation/index.html', 'utf8');
    assert.match(html, /2 audits · 2 pages/);
    assert.match(html, /Duplicate ID &quot;twice&quot;/);
    assert.match(html, /audits &lt;the&gt; cart/);
    assert.match(html, /HTTP 404/);
    assert.match(html, /before the browser parses it/);
});

test('a run without validateHtml invocations writes no validation report', t => {
    const run = workspace(t);
    assert.deepEqual(writeReport(run), {audits: 0, pages: 0, errors: 0, warnings: 0, notValidated: 0});
    assert.equal(fs.existsSync('coverage/html-validation'), false);
});

test('records from another run cannot be reported', t => {
    workspace(t);
    captureHtml({...page, url: 'https://magelens.test/valid', html: valid});
    assert.throws(() => writeReport({id: 'next-run'}), /another run/);
    assert.equal(fs.existsSync('coverage/html-validation'), false);
});

test('responses that cannot be validated are reported as not validated instead of clean', t => {
    const run = workspace(t);
    captureHtml({...page, url: 'https://magelens.test/rest/V1/items', contentType: 'application/json', html: {parsed: true}});
    captureHtml({...page, url: 'https://magelens.test/download', contentType: undefined, html: valid});
    captureHtml({...page, url: 'https://magelens.test/checkout/onepage/success/', status: 302, html: ''});
    captureHtml({...page, url: 'https://magelens.test/empty', html: ' \n'});
    captureHtml({runner: 'playwright', spec: page.spec, test: page.test, url: 'https://magelens.test/slow',
        error: 'Timeout 60000ms exceeded for https://magelens.test/slow?token=SeCrEt'});
    assert.deepEqual(writeReport(run), {audits: 5, pages: 5, errors: 0, warnings: 0, notValidated: 5});
    assert.deepEqual(results().audits.map(audit => [audit.status, audit.notValidated, audit.messages]), [
        [200, 'the response was application/json, not an HTML document', []],
        [200, 'the response was sent without a content type, not an HTML document', []],
        [302, 'the server answered with an HTTP 302 redirect', []],
        [200, 'the response was empty', []],
        [null, 'the request failed (Timeout 60000ms exceeded for https://magelens.test/slow?token=[redacted])', []]
    ]);
    const html = fs.readFileSync('coverage/html-validation/index.html', 'utf8');
    assert.match(html, /5 not validated/);
    assert.match(html, /Not validated: the server answered with an HTTP 302 redirect\./);
    assert.match(html, /<p class="context">0 errors/, 'A failed request has no HTTP status');
    assert.doesNotMatch(html, /No issues found|SeCrEt/);
});

test('markup that cannot be tokenized is reported as a partial validation', t => {
    const run = workspace(t);
    captureHtml({...page, url: 'https://magelens.test/broken', html: valid.replace('Fine', 'a < b <')});
    writeReport(run);
    assert.deepEqual(results().audits[0].messages.map(message => message.rule), ['parser-error']);
    assert.match(fs.readFileSync('coverage/html-validation/index.html', 'utf8'), /Validation stopped at the parser error; markup after it was not checked\./);
});

test('session secrets and page content stay out of the published report', t => {
    const run = workspace(t);
    const key = 'c0ffee'.repeat(11).slice(0, 64);
    assert.equal(auditedUrl(`https://magelens.test/admin/blog/post/edit/id/7/key/${key}/?form_key=AbC123&p=2#top`),
        'https://magelens.test/admin/blog/post/edit/id/7/key/[redacted]/?form_key=[redacted]&p=2');
    assert.equal(auditedUrl('https://shop.test:8443/review/form_key/AbC123/?SID=s1&token=t1&q=key'),
        'https://shop.test:8443/review/form_key/[redacted]/?SID=[redacted]&token=[redacted]&q=key');
    assert.equal(auditedUrl('https://magelens.test/catalog/keys/rings/?monkey=1'), 'https://magelens.test/catalog/keys/rings/?monkey=1');
    const secrets = `<a id="x" href="/admin/sales/order/view/key/${key}/">Jane Roe</a><input id="x" name="form_key" type="hidden" value="SeCrEtFormKey">`;
    captureHtml({...page, url: `https://magelens.test/admin/dashboard/index/key/${key}/`, html: valid.replace('<p>Fine</p>', secrets)});
    assert.equal(writeReport(run).errors, 1);
    const [record] = fs.readdirSync('coverage/raw/html-validation');
    assert.ok(!fs.readFileSync(path.join('coverage/raw/html-validation', record), 'utf8').includes(`key/${key}/"}`), 'The recorded URL is redacted');
    for (const file of ['coverage/html-validation/results.json', 'coverage/html-validation/index.html']) {
        const published = fs.readFileSync(file, 'utf8');
        for (const secret of [key, 'SeCrEtFormKey', 'Jane Roe']) assert.ok(!published.includes(secret), `${secret} in ${file}`);
    }
    assert.equal(results().audits[0].url, 'https://magelens.test/admin/dashboard/index/key/[redacted]/');
});
