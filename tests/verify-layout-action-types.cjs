// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const {readXmlJson} = require('../bin/xml-report/json.cjs');
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
for (const [suffix, parent, expected] of [
    ['coverageprobe_layout_arguments.xml', '/page/body/referenceContainer/block', ['covered', 'uncovered', 'covered']],
    ['coverageprobe_layout_arguments_overlay.xml', '/page/body/referenceBlock', ['covered', 'ambiguous', 'ambiguous']],
]) {
    const file = report.files.find(file => file.path.endsWith('/layout/' + suffix));
    assert.ok(file, suffix);
    for (let index = 1; index <= 3; index++) {
        const node = `${parent}/action[${index}]/argument/@xsi:type`;
        const item = file.declarations.find(item => item.node === node);
        assert.equal(item?.layout.kind, 'argument-type', node);
        const state = expected[index - 1];
        assert.equal(item.state, state === 'ambiguous' ? 'unmeasured' : state, node);
        assert.equal(item.hits > 0, state === 'covered', node);
        assert.deepEqual([...new Set(item.evidence.map(event => event.type))], state === 'covered'
            ? ['layout-argument-type-evaluated'] : state === 'ambiguous' ? ['layout-argument-type-ambiguous'] : [], node);
        if (state === 'ambiguous') assert.match(item.reason, /Multiple original action operands/);
    }
}
console.log('Verified original action type evaluation, suppressed evaluation and explicit ambiguous operands.');
