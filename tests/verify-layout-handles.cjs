// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');

const report = JSON.parse(fs.readFileSync(process.argv[2] || 'coverage/xml/coverage.json'));
const directory = 'app/code/MageLens/Compatibility/view/frontend/layout';

function include(file, handle, effect, state) {
    const source = report.files.find(item => item.path === `${directory}/${file}.xml`);
    assert.ok(source, `Missing layout source ${file}`);
    const declarations = source.declarations.filter(item => item.layout?.kind === 'include' && item.layout.element === handle);
    assert.equal(declarations.length, 1, `Missing include origin for ${file}/${handle}`);
    const [declaration] = declarations;
    assert.equal(declaration.state, state);
    assert.deepEqual([...new Set(declaration.evidence.map(item => item.type))], [effect]);
    assert.ok(declaration.evidence.every(item => item.area === 'frontend'));
}

include('coverageprobe_handle_index', 'coverageprobe_layout_nested', 'layout-include-traversed', 'covered');
include('coverageprobe_handle_index', 'coverageprobe_layout_repeat', 'layout-include-duplicate', 'unmeasured');
include('coverageprobe_layout_nested', 'coverageprobe_layout_repeat', 'layout-include-traversed', 'covered');
include('coverageprobe_layout_repeat', 'coverageprobe_layout_nested', 'layout-include-cycle', 'unmeasured');
console.log('Verified exact source for traversed, duplicate and cyclic layout include edges.');
