// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs'), path = require('node:path');
const p = require('./index.cjs'), native = require('./native.cjs');
const {identity} = require('../runners/cypress/native-support.cjs');
const {testResult} = require('../runners/cypress/native.cjs');

// Ordinary browser profiling uses the same test boundary as explicit training.
// No second browser run, test selection, checkpointing or model updates.
function start(settings, runner, model) {
    fs.mkdirSync('coverage', {recursive:true});
    const directory = fs.mkdtempSync(path.resolve('coverage/predictor-'));
    const profile = {...settings, ...model, directory, runner,
        sourceFamily:settings.sourceFamily ?? 'native-browser-suite',
        baselineMs:settings.baselineMs ?? require('../../branching-baseline.json').checkpointDecisionBaselineMs,
        environment:{...settings.environment, runner, architecture:process.arch,
            dependencies:p.sha256(fs.readFileSync('dependencies.yaml')),
            platform:process.env.MAGELENS_PLATFORM ?? 'unknown', theme:process.env.MAGELENS_THEME ?? 'unknown'}};
    const previous = {MAGELENS_NATIVE_PROFILE:process.env.MAGELENS_NATIVE_PROFILE, MAGELENS_NATIVE_REPORT:process.env.MAGELENS_NATIVE_REPORT};
    process.env.MAGELENS_NATIVE_PROFILE = JSON.stringify(profile);
    process.env.MAGELENS_NATIVE_REPORT = path.join(directory, 'report.json');
    return {
        finish({passed, results}) {
            try {
                if (runner === 'cypress' && fs.existsSync(path.join(directory, 'predictions.json'))) {
                    const measured = (results?.runs ?? []).flatMap(run => {
                        const occurrences = new Map();
                        return run.tests.map(test => {
                            const key = JSON.stringify(test.title), occurrence = occurrences.get(key) ?? 0;
                            occurrences.set(key, occurrence + 1);
                            return {id:identity(run.spec.absolute, test.title, occurrence), ...testResult(test)};
                        });
                    });
                    native.finish(directory, {results:measured});
                }
                const file = path.join(directory, 'prediction-samples.json');
                let samples = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : [];
                if (!passed) samples = samples.map(row => ({...row, eligible:false, exclusion:'Incomplete native suite'}));
                const report = {samples, quality:p.evaluate(samples)};
                fs.writeFileSync('coverage/prediction.json', JSON.stringify(report)+'\n', {mode:0o600});
                return report;
            } finally {
                for (const [key, value] of Object.entries(previous)) {
                    if (value === undefined) delete process.env[key]; else process.env[key] = value;
                }
            }
        }
    };
}

function installCypress(on, config) {
    if (!process.env.MAGELENS_NATIVE_PROFILE || config.expose?.warmup) return config;
    const profile = JSON.parse(process.env.MAGELENS_NATIVE_PROFILE);
    if (profile.runner !== 'cypress') return config;
    const support = config.supportFile && path.resolve(config.projectRoot, config.supportFile);
    const wrapper = path.join(profile.directory, 'support.cjs');
    fs.writeFileSync(wrapper, `require(${JSON.stringify(require.resolve('../runners/cypress/native-support.cjs'))}).install({profile:true,inventory:false});\n${support ? `require(${JSON.stringify(support)});` : ''}\n`, {flag:'wx', mode:0o600});
    on('task', {'magelens:timing:prepare':native.collector(profile, profile.directory, config.projectRoot)});
    config.supportFile = wrapper;
    return config;
}
module.exports = {start, installCypress};
