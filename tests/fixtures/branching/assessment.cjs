// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Synthetic ML outputs for execution-mechanism tests. Real inference has separate tests.
const modelId='a'.repeat(64);
function estimate(ms=1) {return {prediction:{ms,modelId,qualified:true,outOfRange:false},predictionError:null,eligibilityError:null};}
function assessed(manifest) {
    const tests={},stages={};
    for (const test of manifest.tests) {
        test.scope ??= test.id;
        tests[test.id]=estimate();
        stages[`root-${test.scope.slice(0,20)}`]=estimate();
    }
    for(const cp of manifest.checkpoints)stages[cp.id]=estimate();
    manifest.implementation='rust-prefix-v3';
    manifest.assessment={version:'ml-duration-v1',modelId,modelQualified:true,executionEligible:true,status:'complete',issues:[],tests,stages,
        analysis:{status:'complete',collectionComplete:true,collectionDiagnostics:0}};
    return manifest;
}
module.exports={assessed,estimate};
