// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {parse} = require('@babel/parser');
const {matrix, renderSuite} = require('./performance/branching/matrix.cjs');
const provenance = require('./performance/branching/provenance.json');

test('recovered workloads preserve every original generated journey byte', () => {
    assert.equal(matrix.length, 13);
    assert.deepEqual(matrix.map(row => row.id), provenance.generatedSuites.map(row => row.id));
    for (const [index, row] of matrix.entries()) {
        const source = renderSuite(row);
        assert.equal(crypto.createHash('sha256').update(source).digest('hex'),
            provenance.generatedSuites[index].sha256, row.id);
        const ast = parse(source, {sourceType: 'module'});
        const tests = ast.program.body.filter(node => node.type === 'ExpressionStatement' &&
            node.expression.type === 'CallExpression' && node.expression.callee.name === 'test');
        assert.equal(tests.length, row.consumers, row.id);
        assert.equal(tests.length, provenance.generatedSuites[index].tests, row.id);
        assert.equal(row.expected, undefined, 'Historical economics cannot assert current decisions');
        assert.equal(row.expectedCost, undefined);
    }
});

test('workload inventory retains short, deep, unrelated and stateful fixture cases', () => {
    assert.ok(matrix.some(row => row.products === 1));
    assert.ok(matrix.some(row => row.products === 80));
    assert.ok(matrix.some(row => row.consumers === 2));
    assert.ok(matrix.some(row => row.consumers === 36));
    assert.ok(matrix.some(row => row.disjoint));
    assert.ok(matrix.some(row => row.levels === 12));
    const state = renderSuite(matrix.find(row => row.fixtureState));
    assert.match(state, /expect\(state.history\).toEqual\(\['completed'\]\)/);
    assert.match(state, /expect\(checkoutReady.cart\).toBe\(checkoutState\)/);
    assert.match(state, /expect\(checkoutState.history\).toEqual\(\[\]\)/);
});
