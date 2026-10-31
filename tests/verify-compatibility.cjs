// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const assert = require('node:assert/strict');
const read = file => JSON.parse(fs.readFileSync(file));
const php = read('coverage/php/coverage-summary.json');
const js = read('coverage/js/coverage-summary.json');
const templates = read('coverage/templates/coverage-summary.json');
const theme = process.argv[2];
assert.ok(php.requests.some(request => request.method === 'POST' && request.uri.includes('/coverageprobe/index/save')), 'Missing real Magento POST coverage');
assert.ok(php.covered > 0 && php.covered < php.total, 'PHP needs both covered and uncovered lines');
assert.ok(js.total.lines.covered > 0 && js.total.lines.covered < js.total.lines.total, 'JavaScript needs both covered and uncovered lines');
const suffix = theme === 'hyva' ? 'templates/probe-hyva.phtml' : 'web/template/probe.html';
const entry = templates.templates.find(entry => entry.path.endsWith(suffix));
assert.ok(entry && entry.status === 'observed' && entry.statementSummary.covered > 0, `Missing ${theme} execution: ${suffix}`);
const never = entry.source.split('\n').findIndex(line => line.includes('data-cy="probe-never"')) + 1;
assert.equal(entry.lineHits[never]?.hits, 0, 'A false template branch must stay uncovered');
assert.ok(templates.templates.some(entry => entry.path.endsWith('template/unused.html') && entry.status === 'unobserved' && entry.statementSummary.covered === 0));
if (theme === 'hyva') {
    assert.equal(entry.kind, 'browser-phtml');
    assert.ok(entry.statements.some(statement => statement.syntax === 'alpine:model' && statement.hits > 0));
    const unused = entry.statements.find(statement => statement.binding === '@click' && entry.source.split('\n')[statement.start.line - 1].includes('probe-unused'));
    assert.equal(unused.hits, 0, 'Unclicked Alpine events must stay uncovered');
    assert.deepEqual(entry.unsupportedDirectives || [], []);
    assert.ok(!entry.statements.some(statement => statement.binding === '@submit.prevent'));
    for (const prefix of ['@update-gallery-', '@update-prices-', '@unused-', '@missing-']) {
        const statement = entry.statements.find(statement => statement.binding.startsWith(prefix));
        assert.ok(statement?.binding.endsWith('?>.window'), `Incomplete event name: ${prefix}`);
        assert.ok(entry.source.split('\n')[statement.start.line - 1].includes(statement.binding), 'Event must map to its original PHTML line');
        assert.equal(statement.hits > 0, prefix.startsWith('@update-'), `Incorrect event execution: ${prefix}`);
    }
}
const javascript = read('coverage/js/coverage-final.json');
assert.ok(Object.keys(javascript).every(file => file.endsWith('.js')), 'Only whole .js files belong in JavaScript coverage');
const inlinePath = theme === 'hyva' ? 'templates/probe-hyva.phtml' : 'templates/probe.phtml';
const inline = templates.templates.find(entry => entry.path.endsWith(inlinePath));
assert.ok(inline?.scripts.some(script => script.status === 'instrumented'), 'Missing inline template instrumentation');
assert.ok(inline.statements.some(statement => statement.id.startsWith('script:') && statement.hits > 0), 'Missing executed inline statements');
assert.ok(inline.statements.some(statement => statement.id.startsWith('script:') && statement.hits === 0), 'Unused inline statements must stay uncovered');
assert.ok(inline.functions.find(fn => fn.name === 'renderInlineProbe')?.hits > 0, 'Called inline function must be covered');
assert.equal(inline.functions.find(fn => fn.name === 'unusedInlineProbe')?.hits, 0, 'Unused inline function must stay uncovered');
assert.ok(inline.branches.some(branch => branch.hits > 0) && inline.branches.some(branch => branch.hits === 0), 'Inline branches need both covered and uncovered outcomes');
console.log(`Verified ${theme} PHP, whole-file JavaScript and template execution, including inline scripts and untouched branches and templates.`);

const child = templates.templates.find(entry => entry.path.endsWith('templates/child-script.phtml'));
assert.ok(child?.statements.some(statement => statement.hits > 0), 'Missing child-template execution');
assert.ok(child.functions.find(fn => fn.name === 'childScriptValue')?.hits > 0);
assert.equal(child.functions.find(fn => fn.name === 'unusedChildScript')?.hits, 0);
assert.ok(child.branches.some(branch => branch.hits > 0) && child.branches.some(branch => branch.hits === 0));
const childReference = templates.scripts.references.find(reference => reference.path === inline.path);
assert.equal(childReference?.status, 'linked');
assert.ok(childReference.targets.some(target => target.id === child.id));
console.log('Verified PHP-rendered child source links and child counters without parent duplication.');

if (theme === 'hyva') {
    for (const suffix of ['Magento_Catalog/templates/product/list/image.phtml', 'Magento_Catalog/templates/product/price/amount/default.phtml', 'Magento_OrderCancellationUi/templates/cancel-order-modal.phtml']) {
        const vendor = templates.templates.find(entry => entry.path === `vendor/hyva-themes/magento2-default-theme-csp/${suffix}`);
        assert.ok(vendor, `Missing original Hyvä template: ${suffix}`);
        assert.deepEqual(vendor.unsupportedDirectives || [], [], `Unsupported Hyvä directives: ${suffix}`);
        if (suffix.includes('cancel-order-modal')) assert.ok(!vendor.statements.some(statement => statement.binding === '@submit.prevent'));
        else assert.ok(vendor.statements.some(statement => /^@update-(gallery|prices)-<\?=/.test(statement.binding) && statement.binding.endsWith('?>.window')));
    }
    const proof = read('coverage/csp-proof.json');
    assert.equal(proof.theme, 'Hyva/default-csp');
    assert.equal(proof.evalBlocked, true);
    assert.equal(proof.inlineBlocked, true);
    assert.equal(proof.inlineExecuted, false);
    console.log('Verified enforced CSP blocks dynamic code and unsigned inline scripts.');
}
