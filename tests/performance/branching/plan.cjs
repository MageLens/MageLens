// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const assert = require('node:assert/strict');
const {buildWorkflow} = require('../../../branching/automatic.cjs');
const {planWorkflow} = require('../../../branching/costs.cjs');
const {project} = require('./config.cjs');

function assess(manifest, limit = 4) {
    if(manifest.tests.some(test=>test.disposition!=='automatic')) {
        require('../../../branching/automatic.cjs').verifySources(manifest);
        const input={...manifest.assessment.costInput,maxCheckpointsPerTest:limit};
        const decision=require('../../../branching/costs.cjs').solveCosts(input);
        const stages=new Map(input.stages.map(stage=>[stage.id,stage]));
        const paths=input.parents.map((parent,index)=>{
            const chain=[];for(let id=parent;id;id=stages.get(id).parent)chain.push(stages.get(id));
            return {test:manifest.schedule[index],candidates:chain.filter(stage=>stage.checkpoint).length,
                selected:chain.filter(stage=>decision.selected.includes(stage.id)).length};
        });
        assert.ok(paths.every(path=>path.selected<=limit));
        return {decision,paths,execution:{eligible:false,reason:'This source contains unsupported lifecycle or restoration boundaries; inspect the manifest test reasons.'}};
    }
    const configuration = {...project(manifest), maxCheckpointsPerTest: limit};
    const {workflow} = buildWorkflow(manifest, configuration);
    const {decision} = planWorkflow(workflow);
    const paths = workflow.select().map(test => ({test: test.id,
        candidates: workflow.chain(test.parent).filter(stage => stage.checkpoint !== false).length,
        selected: workflow.chain(test.parent).filter(stage => decision.selected.includes(stage.id)).length}));
    assert.equal(decision.maxCheckpointsPerTest, limit);
    assert.ok(paths.every(path => path.selected <= limit));
    return {decision, paths};
}
if (require.main === module) {
    const manifest = JSON.parse(fs.readFileSync(process.argv[2]));
    console.log(JSON.stringify(assess(manifest, Number(process.argv[3] ?? 4)), null, 2));
}
module.exports = {assess};
