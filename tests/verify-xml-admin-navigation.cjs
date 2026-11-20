// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {createHash} = require('node:crypto');

const report = JSON.parse(fs.readFileSync('coverage/xml/coverage.json'));
const fixture = 'app/code/MageLens/AdminNavigation/etc/';
const blog = 'app/code/Application/Blog/etc/';

function originalDeclaration(path, identity, startLine, endLine, command) {
    const file = report.files.find(entry => entry.path === path);
    assert.ok(file, 'Missing Admin XML source inventory');
    const source = fs.readFileSync('src/' + path);
    assert.equal(file.sourceHash, createHash('sha256').update(source).digest('hex'), 'Admin XML original fingerprint differs');
    const item = file.declarations.find(entry => entry.path === identity && (!command || entry.binding.command === command));
    assert.ok(item, 'Missing Admin XML declaration');
    assert.equal(item.startLine, startLine);
    assert.equal(item.endLine, endLine);
    return item;
}

const inherit = originalDeclaration(fixture + 'acl.xml', 'MageLens_AdminNavigation::browse', 12, 12);
assert.equal(inherit.binding.parent, 'Application_Blog::manage');
assert.equal(inherit.effectStates['acl-check'], 'covered');
assert.ok(inherit.evidence.some(event => event.type === 'acl-check' && event.outcome === 'allowed' && event.area === 'adminhtml'));
const unused = originalDeclaration(fixture + 'acl.xml', 'MageLens_AdminNavigation::unused', 13, 13);
assert.equal(unused.effectStates['acl-check'], 'uncovered');
assert.equal(unused.hits, 0);
assert.equal(unused.supported, true);

const resource = originalDeclaration(blog + 'acl.xml', 'Application_Blog::manage', 9, 9);
assert.ok(resource.evidence.some(event => event.outcome === 'allowed'));
assert.ok(resource.evidence.some(event => event.outcome === 'denied'));
const denied = new Set(resource.evidence.filter(event => event.outcome === 'denied').map(event => event.request));
const raw = 'coverage/raw/php/' + report.run;
assert.ok([...denied].some(request => {
    const record = JSON.parse(fs.readFileSync(raw + '/' + request + '.json'));
    return record.method === 'POST' && record.status === 403 && /\/application_blog\/manage\/save\//.test(record.uri);
}), 'Denial must be observed on the direct Blog controller attempt');

const posts = originalDeclaration(fixture + 'adminhtml/menu.xml', 'MageLens_AdminNavigation::inherited_posts', 9, 10, 'add');
const categories = originalDeclaration(fixture + 'adminhtml/menu.xml', 'MageLens_AdminNavigation::inherited_categories', 11, 12, 'add');
const interrupted = originalDeclaration(fixture + 'adminhtml/menu.xml', 'MageLens_AdminNavigation::interrupted', 16, 17, 'add');
const products = originalDeclaration(fixture + 'adminhtml/menu.xml', 'MageLens_AdminNavigation::products', 18, 19, 'add');
const parent = originalDeclaration(blog + 'adminhtml/menu.xml', 'Application_Blog::manage', 10, 10, 'add');
assert.deepEqual(parent.effects, ['menu-emitted']);
assert.equal(posts.effectStates['menu-emitted'], 'covered');
assert.equal(posts.effectStates['menu-followed'], 'covered');
assert.equal(categories.effectStates['menu-emitted'], 'covered');
assert.equal(categories.effectStates['menu-followed'], 'uncovered');
const follow = posts.evidence.filter(event => event.type === 'menu-followed');
assert.equal(follow.length, 1);
assert.equal(follow[0].origin, 'browser');
assert.ok(posts.evidence.some(event => event.request === follow[0].request && event.type === 'menu-emitted' && event.outcome === 'observed'));
assert.ok(categories.evidence.some(event => event.request === follow[0].request && event.type === 'menu-emitted' && event.outcome === 'observed'));
assert.ok(inherit.evidence.some(event => event.request === follow[0].request && event.type === 'acl-check' && event.outcome === 'allowed'));
assert.notEqual(follow[0].destination, follow[0].request);
assert.equal(interrupted.effectStates['menu-emitted'], 'covered');
assert.equal(interrupted.effectStates['menu-followed'], 'uncovered');
assert.equal(products.binding.action, 'catalog/product/');
assert.equal(products.effectStates['menu-followed'], 'covered');
const productFollow = products.evidence.filter(event => event.type === 'menu-followed');
assert.equal(productFollow.length, 1);
assert.equal(productFollow[0].origin, 'browser');
assert.ok(products.evidence.some(event => event.request === productFollow[0].request && event.type === 'menu-emitted' && event.outcome === 'observed'));
assert.notEqual(productFollow[0].destination, productFollow[0].request);
const catalog = JSON.parse(fs.readFileSync(raw + '/' + productFollow[0].destination + '.json'));
assert.equal(catalog.status, 200);
assert.ok(/\/catalog\/product\/index\/key\/[^/]+\//.test(catalog.uri), 'Destination used the native default action and an Admin secret key');

const removed = originalDeclaration(fixture + 'adminhtml/menu.xml', 'MageLens_AdminNavigation::removed', 13, 14, 'add');
assert.equal(removed.outcome, 'displaced');
assert.equal(removed.hits, 0);
assert.match(removed.reason, /remove command/);
const removalCommand = originalDeclaration(fixture + 'adminhtml/menu.xml', 'MageLens_AdminNavigation::removed', 15, 15, 'remove');
assert.equal(removalCommand.state, 'unmeasured');
assert.ok(removalCommand.reason);
console.log('Verified Admin ACL decisions and individual menu emission/navigation against original XML.');
