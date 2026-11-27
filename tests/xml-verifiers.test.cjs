// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const assert = require('node:assert/strict');
const {constants: {MAX_STRING_LENGTH}} = require('node:buffer');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const {writeXmlJson} = require(projectFile('bin/xml-report/json.cjs'));

test('Admin navigation verifier checks original source and evidence in an oversized XML report', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-xml-verifier-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const write = (name, content) => {
        const file = path.join(root, name);
        fs.mkdirSync(path.dirname(file), {recursive: true});
        fs.writeFileSync(file, content);
    };
    const fixture = 'app/code/MageLens/AdminNavigation/etc/';
    const blog = 'app/code/Application/Blog/etc/';
    const xmlFile = (file, declarations) => {
        const source = fs.readFileSync(file.startsWith(fixture)
            ? path.join(__dirname, 'fixtures/admin-navigation/module/etc', file.slice(fixture.length))
            : projectFile('src', file));
        write('src/' + file, source);
        return {path: file, sourceHash: createHash('sha256').update(source).digest('hex'), declarations};
    };
    const acl = (request, outcome) => ({type: 'acl-check', area: 'adminhtml', request, outcome});
    const emitted = {request: 'menu', type: 'menu-emitted', outcome: 'observed'};
    const menu = (name, startLine, destination, action) => ({
        path: 'MageLens_AdminNavigation::' + name, startLine, endLine: startLine + 1,
        binding: {command: 'add', action},
        effectStates: {'menu-emitted': 'covered', 'menu-followed': destination ? 'covered' : 'uncovered'},
        evidence: destination ? [emitted, {type: 'menu-followed', origin: 'browser', request: 'menu', destination}] : [emitted]
    });
    const files = [
        xmlFile(fixture + 'acl.xml', [
            {path: 'MageLens_AdminNavigation::browse', startLine: 12, endLine: 12, binding: {parent: 'Application_Blog::manage'},
                effectStates: {'acl-check': 'covered'}, evidence: [acl('menu', 'allowed')]},
            {path: 'MageLens_AdminNavigation::unused', startLine: 13, endLine: 13, effectStates: {'acl-check': 'uncovered'},
                hits: 0, supported: true}
        ]),
        xmlFile(blog + 'acl.xml', [{path: 'Application_Blog::manage', startLine: 9, endLine: 9,
            evidence: [acl('menu', 'allowed'), acl('denied', 'denied')]}]),
        xmlFile(fixture + 'adminhtml/menu.xml', [
            menu('inherited_posts', 9, 'posts'), menu('inherited_categories', 11), menu('interrupted', 16),
            menu('products', 18, 'catalog', 'catalog/product/'),
            {...menu('removed', 13), outcome: 'displaced', hits: 0, reason: 'remove command'},
            {path: 'MageLens_AdminNavigation::removed', startLine: 15, endLine: 15,
                binding: {command: 'remove'}, state: 'unmeasured', reason: 'remove command'}
        ]),
        xmlFile(blog + 'adminhtml/menu.xml', [{path: 'Application_Blog::manage', startLine: 10, endLine: 10,
            binding: {command: 'add'}, effects: ['menu-emitted']}])
    ];
    write('coverage/raw/php/current/denied.json', JSON.stringify({method: 'POST', status: 403, uri: '/admin/application_blog/manage/save/'}));
    write('coverage/raw/php/current/catalog.json', JSON.stringify({status: 200, uri: '/admin/catalog/product/index/key/fixture/'}));
    const directory = path.join(root, 'coverage/xml');
    fs.mkdirSync(directory);
    const file = path.join(directory, 'coverage.json');
    const padding = 'x'.repeat(1024 * 1024);
    const requests = Array.from({length: Math.floor(MAX_STRING_LENGTH / padding.length) + 1},
        (_, id) => ({id, events: [], padding}));
    writeXmlJson(file, {run: 'current', files, requests});
    assert.ok(fs.statSync(file).size > MAX_STRING_LENGTH);

    const output = execFileSync(process.execPath, [path.join(__dirname, 'verify-xml-admin-navigation.cjs')], {cwd: root, encoding: 'utf8'});
    assert.match(output, /Verified Admin ACL decisions and individual menu emission\/navigation against original XML/);
});
