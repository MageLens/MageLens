// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {request} = require('node:https');
const {test} = require('node:test');
const {apiJourneys, routingJourneys} = require(projectFile('src/app/code/Application/Blog/Test/Configuration/journeys.cjs'));

const run = process.env.MAGELENS_ROUTING_COLLECT === '1' ? readFileSync('coverage/.active-run', 'utf8').trim() : null;
if (run) assert.match(run, /^[a-f0-9]{32}$/);
const mode = run ? 'with collection' : 'without collection';
const base = new URL(process.env.MAGELENS_ROUTING_BASE_URL || process.env.CYPRESS_BASE_URL || process.env.PLAYWRIGHT_BASE_URL);
assert.equal(base.protocol, 'https:');
assert.ok(base.hostname.endsWith('.test'), 'Use a disposable test domain');

function nativeRequest(method, path, headers, body) {
    const url = new URL(path, base);
    assert.equal(url.origin, base.origin, 'Native routing proof must stay on the disposable installation');
    if (run) headers = {...headers, 'x-application-coverage': run};
    return new Promise((resolve, reject) => {
        const outgoing = request(url, {method, rejectUnauthorized: false, headers}, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => resolve({url, status: response.statusCode, headers: response.headers, text: Buffer.concat(chunks).toString()}));
            response.on('error', reject);
        });
        outgoing.on('error', reject);
        outgoing.end(body);
    });
}

for (const [method, path, status, expected] of [
    ...routingJourneys, ...apiJourneys.map(([path, body]) => ['GET', path, 200, body]),
    ['GET', '/blog/index/configuration?case=default-read', 200, {heading: 'Journal'}]
]) test(method + ' ' + path + ' ' + mode, async () => {
    const response = await nativeRequest(method, path, {accept: 'application/json'});
    const body = JSON.parse(response.text);
    assert.equal(response.status, status, JSON.stringify(body));
    if (expected) assert.deepEqual(body, expected);
});

test('Blog Admin route renders through its generated menu link ' + mode, async () => {
    const cookies = new Map();
    async function visit(path, form) {
        for (let redirects = 0; redirects < 6; redirects++) {
            const headers = {accept: 'text/html', cookie: [...cookies].map(([name, value]) => name + '=' + value).join('; ')};
            if (form) {
                headers['content-type'] = 'application/x-www-form-urlencoded';
                headers['content-length'] = Buffer.byteLength(form);
            }
            const response = await nativeRequest(form ? 'POST' : 'GET', path, headers, form);
            for (const cookie of response.headers['set-cookie'] || []) {
                const [name, ...value] = cookie.split(';', 1)[0].split('=');
                cookies.set(name, value.join('='));
            }
            if (response.status < 300 || response.status >= 400) return response;
            assert.ok(response.headers.location, 'Expected a native Admin redirect');
            path = new URL(response.headers.location, response.url);
            form = undefined;
        }
        assert.fail('Exceeded the Admin redirect limit');
    }

    const login = await visit('/admin/');
    assert.equal(login.status, 200);
    const formKey = login.text.match(/<input name="form_key" type="hidden" value="([^"]+)"/)?.[1];
    assert.ok(formKey, 'The native Magento login form key is required');
    // The isolated installer creates this disposable application account.
    const admin = await visit(login.url, new URLSearchParams({
        'form_key': formKey, 'login[username]': 'application', 'login[password]': 'ApplicationOnly123456!'
    }).toString());
    assert.equal(admin.status, 200);
    const link = admin.text.match(/href="([^"]*\/application_blog\/manage\/index\/section\/posts\/[^"]*)"/)?.[1];
    assert.ok(link, 'Expected the authenticated Blog posts menu entry');
    const page = await visit(link.replaceAll('&amp;', '&'));
    assert.equal(page.status, 200);
    assert.ok(page.text.includes('data-cy="blog-admin"'), 'Expected the Blog Manage controller output');
});
