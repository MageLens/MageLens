// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Synthetic constant-output model for orchestration tests. Never a product model.
function model(durationMs = 1000000) {
    const {REACHABLE_SCHEMA:featureSchema,REACHABLE_WIDTH:width}=require('../../../branching/predictor/index.cjs');
    return {schemaVersion:1,featureSchema,qualified:true,referenceBaselineMs:106638.8,errorLogP90:0,
        estimator:{intercept:Math.log1p(durationMs),inputTransform:'log1p',mean:Array(width).fill(0),scale:Array(width).fill(1),coefficients:Array(width).fill(0)},
        domains:['cypress','playwright'].flatMap(runner=>[
            {runner,unit:'test',...(runner==='cypress'?{timingBoundary:'cypress-test-duration-minus-preparation/v2'}:{})},
            {runner,unit:'prefix',timingBoundary:'checkpoint-prefix/v1'}
        ]).map(domain=>({...domain,environmentDigest:'synthetic-integration',ranges:Array(width).fill([0,1e12])}))};
}
module.exports={model};
