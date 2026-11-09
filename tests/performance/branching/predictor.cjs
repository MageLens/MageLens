// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const predictor = require('../../../branching/predictor/index.cjs');
const read = file => JSON.parse(fs.readFileSync(file));
function sources(directory) {
    return ['journeys.spec.js', 'bootstrap.setup.js'].map(name => ({name, source: fs.readFileSync(path.join(directory, 'suite', name), 'utf8')}));
}
function capture(directory, context, model) {
    const request = {...context, sources: sources(directory), runner: 'playwright', unit: 'suite-tests'};
    const snapshot = predictor.prepare(request, model ? predictor.loadModel(model) : null);
    fs.writeFileSync(path.join(directory, 'prediction.json'), JSON.stringify(snapshot) + '\n', {flag: 'wx', mode: 0o600});
    return snapshot;
}
function complete(directory, timing) {
    const snapshot = read(path.join(directory, 'prediction.json'));
    const sourceDigest = predictor.features({...snapshot, sources: sources(directory)}).sourceDigest;
    return predictor.observe(snapshot, timing.testsMs, {sourceDigest,
        passed: timing.status === 'passed' && timing.passed === timing.tests.length && timing.fallbacks === 0 && timing.cleanup === true});
}
module.exports = {capture, complete};
if (require.main === module) {
    const [command, directory, input, model] = process.argv.slice(2);
    console.log(JSON.stringify(command === 'capture' ? capture(directory, read(input), model) : complete(directory, read(input))));
}
