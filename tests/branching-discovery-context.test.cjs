// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {createHash} = require('node:crypto');
const {discoveryContext} = require('../branching/predictor/discovery-context.cjs');
test('discovery reads pinned dependency bytes only within selected roots', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(),'magelens-discovery-'));
    t.after(() => fs.rmSync(directory,{recursive:true,force:true}));
    const root = path.join(directory,'specs'), dependencies = path.join(directory,'node_modules');
    fs.mkdirSync(root); fs.mkdirSync(dependencies);
    const file = path.join(dependencies,'fixture.cjs'), source = 'throw new Error("never execute");';
    fs.writeFileSync(file,source);
    const hash = createHash('sha256').update(source).digest('hex');
    const row = {discoveryOnly:true,files:[{file,hash}],snapshot:{sourceArchive:[
        {name:'context/node_modules/fixture.cjs',role:'context',sha256:hash}
    ]}};
    assert.throws(() => discoveryContext(row,{root}),/escapes/);
    const options = {root,dependencyRoots:[dependencies]};
    assert.equal(discoveryContext(row,options)[0].source,source);
    fs.writeFileSync(file,source+' ');
    assert.throws(() => discoveryContext(row,options),/changed/);
    fs.writeFileSync(file,source);
    row.discoveryOnly = false;
    assert.throws(() => discoveryContext(row,options),/discovery-only/);
    row.discoveryOnly = true;
    row.snapshot.sourceArchive.push({...row.snapshot.sourceArchive[0]});
    assert.throws(() => discoveryContext(row,options),/unique verified/);
    row.snapshot.sourceArchive.pop();
    fs.unlinkSync(file); fs.symlinkSync(path.join(root,'other'),file);
    fs.writeFileSync(path.join(root,'other'),source);
    assert.throws(() => discoveryContext(row,options),/escapes/);
});
