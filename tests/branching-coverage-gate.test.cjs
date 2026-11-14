// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const test = require('node:test'), assert = require('node:assert/strict');
const {CoverageGate,javascript,templates} = require('../branching/coverage-gate.cjs');
function js(id, count) {
    const location = {start:{line:1,column:0},end:{line:1,column:10}};
    return {id,coverage:{'/source/file.js':{path:'/source/file.js',statementMap:{0:location},fnMap:{0:{name:'f',loc:location,decl:location}},
        branchMap:{0:{type:'if',loc:location,locations:[location,location]}},s:{0:count},f:{0:count},b:{0:[count,0]}}}};
}
test('JavaScript restoration work stays separate without losing prefix or suffix execution', () => {
    const gate = new CoverageGate(javascript,'id');
    gate.receive(js('restored',5)); gate.resume();
    let value = gate.receive(js('restored',7)).coverage['/source/file.js'];
    assert.deepEqual([value.s[0],value.f[0],value.b[0]],[2,2,[2,0]]);
    gate.pause(); assert.equal(gate.receive(js('restored',11)),null); gate.resume();
    value = gate.receive(js('restored',12)).coverage['/source/file.js'];
    assert.equal(value.s[0],3);
    assert.equal(gate.receive(js('restored',12)).coverage['/source/file.js'].s[0],3,'Repeated publications do not double count');
    assert.equal(gate.receive(js('navigation',4)).coverage['/source/file.js'].s[0],4,'A real navigation counts its initialization');
});
test('template restoration excludes its hits and DOM observations but retains subsequent execution', () => {
    const gate = new CoverageGate(templates,'document');
    const snapshot = (sequence,hits,ids) => ({document:'page',sequence,hits:{template:{statement:hits}},ids,references:[]});
    gate.receive(snapshot(1,3,['restore-only'])); gate.resume();
    assert.deepEqual(gate.receive(snapshot(2,5,['restore-only','test-dom'])),snapshot(2,2,['test-dom']));
    gate.pause(); gate.receive(snapshot(3,9,['restore-only','test-dom'])); gate.resume();
    assert.deepEqual(gate.receive(snapshot(4,10,['restore-only','test-dom','suffix-dom'])),snapshot(4,3,['test-dom','suffix-dom']));
});
