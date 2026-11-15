// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');

const output = fs.readFileSync('.runtime/coverage-run.log', 'utf8');
const links = [...output.matchAll(/^Open the combined coverage report: (https?:\/\/\S+)$/gm)];
assert.equal(links.length, 1, 'Expected exactly one successful report URL');
const index = new URL(links[0][1]);
const base = new URL('./', index);
assert.equal(fs.readlinkSync('src/pub/media/coverage'), '../../../coverage');

function request(url) {
    return new Promise((resolve, reject) => {
        const client = url.protocol === 'https:' ? https : http;
        const req = client.get(url, {rejectUnauthorized: false}, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('error', reject);
            response.on('end', () => resolve({status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks)}));
        });
        req.setTimeout(30000, () => req.destroy(new Error(`Timed out fetching ${url}`)));
        req.on('error', reject);
    });
}

const verified = new Set();
async function verify(file) {
    if (verified.has(file)) return;
    const url = new URL(file.split('/').map(encodeURIComponent).join('/'), base);
    const response = await request(url);
    assert.equal(response.status, 200, `Cannot open ${url}`);
    assert.match(response.headers['cache-control'], /no-store/, `Stale caching allowed: ${url}`);
    assert.deepEqual(response.body, fs.readFileSync(path.join('coverage', file)), `Published content differs: ${url}`);
    verified.add(file);
    return response.body.toString('utf8');
}

async function verifyPage(file) {
    const html = await verify(file);
    if (!html) return;
    for (const match of html.matchAll(/(?:href|src)=["']([^"']+)["']/g)) {
        const url = new URL(match[1].replaceAll('&amp;', '&'), new URL(file, base));
        if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) continue;
        const relative = decodeURIComponent(url.pathname.slice(base.pathname.length));
        if (!relative || relative.endsWith('/')) continue;
        // HTML links are checked through the entry point and one nested page per report.
        if (/\.html$/.test(relative)) continue;
        await verify(relative);
    }
}

async function main() {
    await verifyPage('index.html');
    for (const type of ['php', 'js', 'templates']) {
        await verifyPage(`${type}/index.html`);
        const entries = fs.readdirSync(`coverage/${type}`, {recursive: true});
        const nested = entries.find(file => file.endsWith('.html') && file !== 'index.html' && !file.endsWith('/index.html'));
        assert.ok(nested, `Missing nested ${type} report`);
        await verifyPage(`${type}/${nested}`);
    }
    for (const file of ['summary.json', 'php/clover.xml', 'js/coverage-final.json', 'templates/coverage-summary.json']) await verify(file);
    const missing = await request(new URL('obsolete-publication.txt', base));
    assert.equal(missing.status, 404, 'Obsolete report content remains public');
    console.log(`Verified ${verified.size} published report pages, assets and exports through ${index}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
