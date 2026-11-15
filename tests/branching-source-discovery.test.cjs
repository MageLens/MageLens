// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {collector} = require('../branching/source-discovery.cjs');
const {discoveryContext} = require('../branching/discovery-context.cjs');
test('list-only discovery preserves dependency identities without inference or execution', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-discovery-'));
    t.after(() => fs.rmSync(root, {recursive:true, force:true}));
    const file = path.join(root, 'case.spec.js'), helper = path.join(root, 'helper.js');
    fs.writeFileSync(helper, 'export function ready() { throw new Error("must not execute"); }');
    fs.writeFileSync(file, 'import {ready} from "./helper.js"; test("works", async () => { ready(); });');
    collector({discoveryOnly:true,runner:'playwright'}, root, root)({file, hooks:[], tests:[{
        id:'test',titlePath:[],timingSource:'const work = async () => { ready(); };',expectedStatus:'passed'
    }]});
    const [row] = JSON.parse(fs.readFileSync(path.join(root, 'discovery.json')));
    assert.equal(row.prediction,undefined);
    assert.equal(row.files.length,2);
    assert.equal(discoveryContext(row,{root}).length,1);
    fs.appendFileSync(helper,'\n');
    assert.throws(() => discoveryContext(row,{root}), /changed/);
    assert.throws(() => collector({},root,root), /list-only/);
});
