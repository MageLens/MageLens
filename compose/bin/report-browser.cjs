// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {createCoverageMap} = require('istanbul-lib-coverage');
const {createContext} = require('istanbul-lib-report');
const reports = require('istanbul-reports');
const {isCoverageExcluded} = require('./project.cjs');
const run = JSON.parse(fs.readFileSync('coverage/run.json'));
// out.json is the Cypress input, but a generated aggregate for Playwright.
// Never merge that aggregate back into the per-test snapshots on a re-report.
const raw = run.runner !== 'playwright' && fs.existsSync('.nyc_output/out.json') ? JSON.parse(fs.readFileSync('.nyc_output/out.json')) : {};
const actual = createCoverageMap(raw);
if (run.runner === 'playwright' && fs.existsSync('.nyc_output')) {
    for (const file of fs.readdirSync('.nyc_output').filter(file => /^playwright-.*\.json$/.test(file))) {
        actual.merge(JSON.parse(fs.readFileSync(`.nyc_output/${file}`)));
    }
}
const baseline = createCoverageMap(JSON.parse(fs.readFileSync('.runtime/js-baseline.json')));
const scope = JSON.parse(fs.readFileSync('coverage/javascript-scope.json'));
if (scope.run !== run.id) throw new Error('JavaScript scope belongs to another run');
// Also discard excluded records left by older instrumentation or coverage plugins.
actual.filter(file => !isCoverageExcluded(file));
baseline.filter(file => !isCoverageExcluded(file));
// Zero counters captured DURING instrumentation include JS never loaded by a test.
// Merging these cannot invent a hit, including when no scoped script was loaded.
for (const file of actual.files()) {
    if (!baseline.files().includes(file)) throw new Error(`Browser coverage outside the discovered scope: ${file}`);
    for (const key of ['statementMap', 'fnMap', 'branchMap']) {
        if (JSON.stringify(actual.fileCoverageFor(file).data[key]) !== JSON.stringify(baseline.fileCoverageFor(file).data[key])) {
            throw new Error(`Browser JavaScript instrumentation is stale: ${file}`);
        }
    }
}
baseline.merge(actual);
for (const file of scope.requiredExecuted) {
    if (!Object.values(baseline.fileCoverageFor(path.resolve('src', file)).s).some(count => count > 0)) throw new Error(`Required JavaScript asset did not execute: ${file}`);
}
fs.mkdirSync('.nyc_output', {recursive: true});
fs.writeFileSync('.nyc_output/out.json', JSON.stringify(baseline));
const entries = new Map(scope.included.map(entry => [entry.coveragePath, entry]));
const maps = Object.fromEntries(['all', 'application', 'libraries'].map(group => [group, createCoverageMap({})]));
for (const file of baseline.files()) {
    const entry = entries.get(file);
    if (!entry) throw new Error(`Missing JavaScript scope entry: ${file}`);
    const data = {...baseline.fileCoverageFor(file).toJSON(), path: path.resolve('src', entry.path)};
    for (const group of ['all', entry.group]) maps[group].addFileCoverage(structuredClone(data));
}
const groups = {};
for (const [group, coverageMap] of Object.entries(maps)) {
    const dir = group === 'all' ? 'coverage/js' : `coverage/js-${group}`;
    const context = createContext({dir, coverageMap, sourceFinder: file => fs.readFileSync(file, 'utf8')});
    for (const reporter of ['html', 'json', 'json-summary', ...(group === 'all' ? ['text-summary'] : [])]) reports.create(reporter).execute(context);
    groups[group] = coverageMap.getCoverageSummary().toJSON();
}
fs.writeFileSync('coverage/javascript-summary.json', JSON.stringify({run: run.id, metric: 'statements', groups,
    excluded: scope.excluded}, null, 2));
execFileSync('node_modules/.bin/magento-template-coverage', ['report',
    '--manifest', 'coverage/template-manifest.json', '--hits', 'coverage/raw/templates',
    '--output', 'coverage/templates'], {stdio: 'inherit'});
