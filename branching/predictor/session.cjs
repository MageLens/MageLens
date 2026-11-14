// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const p = require('./index.cjs');
// Observational only: no rerun, fitting, baseline writes or checkpoint decisions.
function start(files, runner) {
    const sources = () => files.map(name => ({name, source: fs.readFileSync(name, 'utf8')}));
    const profileFile = '.runtime/predictor/profile.json';
    if (!fs.existsSync(profileFile) && !fs.existsSync('.runtime/predictor/enabled')) return {finish() { return null; }};
    const settings = fs.existsSync(profileFile) ? JSON.parse(fs.readFileSync(profileFile)) : {};
    const modelFile = path.resolve(settings.model ?? '.runtime/predictor/model.json');
    const loaded = settings.model || settings.modelDigest || fs.existsSync(modelFile) ? p.loadModel(modelFile,settings.modelDigest) : null;
    const unit = settings.unit ?? loaded?.model.domains[0]?.unit ?? 'test';
    if (unit === 'test') return require('./browser.cjs').start(settings, runner,
        loaded ? {model:modelFile,modelDigest:loaded.id} : {model:null});
    if (unit !== 'suite-tests') throw new (require('../estimation.cjs').EstimationError)([{phase:'predictor',message:'Native browser profiling requires a test or suite-tests model'}]);
    const request = {runner, unit:'suite-tests', sources:sources(), sourceFamily:settings.sourceFamily ?? 'native-browser-suite',
        group:settings.group ?? 'native-browser-suite', extraFeatures:settings.extraFeatures,
        baselineMs:settings.baselineMs,
        manualMultiplier:settings.multiplier ?? 1,
        environment:{boundary:'native-runner-process', runner, architecture:process.arch,
            dependencies:p.sha256(fs.readFileSync('dependencies.yaml')),
            platform:process.env.MAGELENS_PLATFORM ?? 'unknown', theme:process.env.MAGELENS_THEME ?? 'unknown'}};
    const snapshot = p.prepare(request, loaded);
    fs.mkdirSync('coverage',{recursive:true});
    fs.writeFileSync('coverage/prediction-before.json',JSON.stringify(snapshot)+'\n',{mode:0o600});
    const began = performance.now();
    return {
        finish({passed, attempts=1}) {
            const ms = performance.now()-began;
            const sample = p.observe(snapshot,ms,{passed,attempts,sourceDigest:p.features({...request,sources:sources()}).sourceDigest});
            fs.writeFileSync(path.join('coverage','prediction.json'),JSON.stringify({sample,quality:p.evaluate([sample])})+'\n',{mode:0o600});
            return sample;
        }
    };
}
module.exports = {start};
