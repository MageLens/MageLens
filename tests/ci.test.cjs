// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {cases} = require('./ci/cases.cjs');
const {verifyCase} = require('./ci/gate.cjs');
const {sanitizedCoverage} = require('./ci/evidence.cjs');
const {writeCoverage} = require('./ci-coverage-fixture.cjs');
const {provenance} = require('../docker/runner/cypress-source/provenance.cjs');
const {snapshot, validateSnapshot, compareThemes} = require('./ci/report-equivalence.cjs');
const {snapshotFile, xmlFile, readProjection, writeProjection} = require('./ci/report-artifact.cjs');
const pins = Object.fromEntries([...fs.readFileSync(path.join(__dirname, '../dependencies.yaml'), 'utf8').matchAll(/^(\w+): "([^"]+)"$/gm)].map(m => [m[1], m[2]]));
const {browserTitles, cliTitles} = require('./verify-scenarios.cjs');
const counts = {totalTests: 8, totalPassed: 8, totalFailed: 0, totalSkipped: 0, totalPending: 0};
function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-ci-unit-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    const write = (file, data) => {fs.mkdirSync(path.dirname(`${directory}/${file}`), {recursive: true}); fs.writeFileSync(`${directory}/${file}`, JSON.stringify(data));};
    const entry = cases[0];
    write('run.json', {id: 'fresh', runner: entry.runner, sources: {private: 'SECRET'}});
    write('installation.json', {...entry, version: pins.MAGENTO_VERSION, credential: 'SECRET', runnerBuild: provenance('x64')});
    write('cypress-runner-results.json', {browserName: 'chrome-for-testing', browserVersion: pins.CHROME_VERSION,
        cypressVersion: pins.CYPRESS_VERSION, totalTests: 11, totalPassed: 11, totalFailed: 0, totalSkipped: 0, totalPending: 0,
        build: provenance('x64')});
    const browser = {name: 'chrome-for-testing', version: pins.CHROME_VERSION};
    write(`${entry.runner}-results.json`, {run: 'fresh', browser, ...counts, tests: browserTitles.map(title => ({title, status: 'passed', error: 'SECRET'}))});
    write('cli-results.json', {run: 'fresh', ...counts, totalTests: cliTitles.length, totalPassed: cliTitles.length,
        tests: cliTitles.map(title => ({title, status: 'passed', error: 'SECRET'}))});
    write('project-fixtures.json', {Application_Blog: {themePaths: ['Magento/luma'], password: 'SECRET'}});
    writeCoverage(directory);
    const evidence = {...entry, sha: 'candidate', workflowRun: '123', attempt: '1', host: 'Linux', image: 'ubuntu', imageVersion: 'today', architecture: 'x64', passed: true,
        feasibility: {passed: true, sha: 'candidate'}, steps: Object.fromEntries(['probe', 'resources', 'isolation', 'e2e', 'cleanup'].map(step => [step, {outcome: 'success'}])), dependencies: pins, counts, browser};
    return {directory, entry, evidence, context: {sha: 'candidate', run: '123', attempt: '1'}};
}
test('required matrix runs every Linux mode and Mage-OS/Luma/Cypress on Windows', () => {
    assert.equal(cases.length, 9);
    assert.equal(new Set(cases.map(c => `${c.platform}/${c.theme}/${c.runner}`)).size, 8);
    const linux = cases.filter(c => c.os === 'ubuntu-latest');
    assert.equal(linux.length, 8);
    assert.equal(new Set(linux.map(c => `${c.platform}/${c.theme}/${c.runner}`)).size, 8);
    assert.deepEqual(cases.filter(c => c.os !== 'ubuntu-latest').map(({os, platform, theme, runner}) => ({os, platform, theme, runner})), [
        {os: 'windows-latest', platform: 'mageos', theme: 'luma', runner: 'cypress'}
    ]);
    const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/ci.yml'), 'utf8');
    const mageos = workflow.split('  e2e:')[1].split('  magento:')[0];
    const declared = [...mageos.matchAll(/- os: ([\w-]+)\s+platform: (\w+)\s+theme: (\w+)\s+runner: (\w+)/g)]
        .map(([, os, platform, theme, runner]) => `${os}/${platform}/${theme}/${runner}`).sort();
    assert.deepEqual(declared, cases.filter(entry => entry.platform === 'mageos')
        .map(entry => `${entry.os}/${entry.platform}/${entry.theme}/${entry.runner}`).sort(), 'Workflow and qualification must require the same cases');
    const release = fs.readFileSync(path.join(__dirname, '../.github/workflows/release.yml'), 'utf8');
    assert.match(release, /\.expectedCases == 9 and \.completedCases == 9 and \.expectedAcceptanceTests == 72/);
});
test('artifact projection removes credentials, source, private packages and arbitrary test errors', t => {
    const {directory} = fixture(t);
    const safe = sanitizedCoverage(directory);
    assert.doesNotMatch(JSON.stringify(safe), /SECRET|password|credential|vendor\/private/);
    assert.equal(safe['php/line-coverage.json']['/shop/app/code/Application/Blog/Model/Article.php']['1'], 1);
    assert.equal(safe['cypress-results.json'].totalPassed, 8);
});
test('a large sanitized report preserves its complete inventory within the artifact limit', t => {
    const {directory, entry, evidence, context} = fixture(t);
    fs.copyFileSync(path.join(__dirname, '../dependencies.yaml'), path.join(directory, 'dependencies.yaml'));
    fs.writeFileSync(path.join(directory, 'magelens-result'), directory);
    const rawXml = path.join(directory, 'xml/coverage.json');
    const xml = JSON.parse(fs.readFileSync(rawXml));
    const warning = {path: xml.files[1].path, reason: 'SECRET'};
    xml.warnings = Array.from({length: 60_000}, () => warning);
    fs.writeFileSync(rawXml, JSON.stringify(xml));
    const expected = snapshot(directory);
    assert.ok(Buffer.byteLength(JSON.stringify(expected)) > 5 * 1024 * 1024);
    const result = spawnSync(process.execPath, [path.join(__dirname, 'ci/evidence.cjs')], {cwd: directory, encoding: 'utf8', env: {...process.env,
        CI_CASE: entry.id, CI_SHA: context.sha, RUNNER_TEMP: directory, GITHUB_STEP_SUMMARY: '', RUNNER_OS: 'Linux',
        ImageOS: 'ubuntu', ImageVersion: 'today', GITHUB_RUN_ID: context.run, GITHUB_RUN_ATTEMPT: context.attempt,
        CI_STEPS: JSON.stringify(evidence.steps)}});
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const coverage = path.join(directory, 'ci-reports', entry.id, 'coverage');
    const readGzip = name => JSON.parse(require('node:zlib').gunzipSync(fs.readFileSync(path.join(coverage, name))));
    const projected = readGzip(snapshotFile);
    assert.deepEqual(projected, JSON.parse(JSON.stringify(expected)));
    assert.deepEqual(readGzip(xmlFile), JSON.parse(JSON.stringify(expected.xml)));
    assert.doesNotMatch(JSON.stringify(projected), /SECRET/);
    assert.equal(verifyCase(entry, evidence, coverage, context), 'fresh');
});
test('case gate accepts complete evidence and rejects stale, skipped, canceled and forged host evidence', t => {
    const {directory, entry, evidence, context} = fixture(t);
    assert.equal(verifyCase(entry, evidence, directory, context), 'fresh');
    for (const patch of [{passed: false}, {sha: 'older'}, {attempt: '0'}, {workflowRun: 'other'}, {host: 'Windows'},
        {browser: null}, {browser: {name: 'electron', version: pins.CHROME_VERSION}},
        {counts: {...counts, totalSkipped: 1}}, {feasibility: {passed: false}}, {steps: {...evidence.steps, cleanup: {outcome: 'cancelled'}}},
        {steps: {...evidence.steps, resources: undefined}}, {steps: {...evidence.steps, resources: {outcome: 'failure'}}}]) {
        assert.throws(() => verifyCase(entry, {...evidence, ...patch}, directory, context));
    }
});
test('final gate fails when reports are missing even if all job results claim success', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-ci-gate-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    const result = spawnSync(process.execPath, [path.join(__dirname, 'ci/gate.cjs'), 'absent'], {cwd: directory, encoding: 'utf8', env: {...process.env,
        CI_SHA: 'candidate', GITHUB_STEP_SUMMARY: '', CI_NEEDS: JSON.stringify(Object.fromEntries(['static', 'integration', 'copyright', 'e2e', 'magento', 'images'].map(job => [job, {result: 'success'}])))}});
    assert.equal(result.status, 1);
    const report = JSON.parse(fs.readFileSync(`${directory}/ci-gate/qualification.json`));
    assert.equal(report.passed, false);
    assert.equal(report.completedCases, 0);
    assert.equal(report.expectedCases, 9);
    assert.equal(report.expectedAcceptanceTests, 72);
    assert.equal(report.expectedCliTests, 27);
    assert.match(result.stdout, /Matrix comparison incomplete/);
});
test('complete qualification compares all eight Linux modes and independently requires Windows', t => {
    const {directory, evidence} = fixture(t);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-ci-complete-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    fs.copyFileSync(path.join(__dirname, '../dependencies.yaml'), path.join(root, 'dependencies.yaml'));
    const artifacts = new Map();
    for (const entry of cases) {
        const artifact = path.join(root, 'ci-artifacts', `case-${entry.id}-attempt-1`);
        const coverage = path.join(artifact, 'coverage');
        fs.cpSync(directory, coverage, {recursive: true});
        const read = file => JSON.parse(fs.readFileSync(path.join(coverage, file)));
        const write = (file, value) => fs.writeFileSync(path.join(coverage, file), JSON.stringify(value));
        for (const file of ['summary.json', 'php/coverage-summary.json', 'javascript-summary.json', 'javascript-scope.json', 'xml/coverage.json']) {
            write(file, {...read(file), run: entry.id});
        }
        write('run.json', {...read('run.json'), id: entry.id, runner: entry.runner});
        write('cli-results.json', {...read('cli-results.json'), run: entry.id});
        write('installation.json', {...read('installation.json'), ...entry, version: pins[entry.platform === 'mageos' ? 'MAGEOS_VERSION' : 'MAGENTO_VERSION']});
        write('project-fixtures.json', {Application_Blog: {themePaths: [entry.theme === 'hyva' ? 'Hyva/default-csp' : 'Magento/luma']}});
        const browser = {name: entry.runner === 'cypress' ? 'chrome-for-testing' : 'chrome', version: pins.CHROME_VERSION};
        const results = {...read('cypress-results.json'), run: entry.id, browser};
        fs.rmSync(path.join(coverage, 'cypress-results.json'));
        write(`${entry.runner}-results.json`, results);
        // The shared-code comparator requires a complete application inventory.
        const php = read('php/line-coverage.json');
        for (let index = 0; index < 11; index++) php[`/shop/app/code/Application/Blog/Model/Example${index}.php`] = {'1': 0};
        write('php/line-coverage.json', php);
        write('php/coverage-summary.json', {...read('php/coverage-summary.json'), total: 13, covered: 1, percent: 7.69});
        const summary = read('summary.json'); summary.metrics.php.percent = 7.69; write('summary.json', summary);
        const js = read('js/coverage-final.json');
        const file = '/shop/app/code/Application/Blog/view/adminhtml/web/js/other.js';
        js[file] = {...Object.values(js)[0], path: file}; write('js/coverage-final.json', js);
        const javascript = read('javascript-summary.json');
        const totals = require('istanbul-lib-coverage').createCoverageMap(js).getCoverageSummary().toJSON();
        javascript.groups.all = totals; javascript.groups.application = totals; write('javascript-summary.json', javascript);
        const scope = read('javascript-scope.json');
        scope.included.push({path: file.slice('/shop/'.length), group: 'application'}); write('javascript-scope.json', scope);
        const complete = snapshot(coverage);
        const layoutSource = 'app/code/Application/Blog/view/frontend/layout/blog_index_index.xml';
        const fingerprint = 'a'.repeat(64);
        const covered = entry.theme === 'hyva';
        const state = covered ? 'covered' : 'uncovered';
        complete.xml.files[layoutSource] = {source: fingerprint, lines: {1: state}, declarations: [{
            supported: true, state, id: fingerprint,
            layout: ['template', 'page', 1, ...Array(6).fill(fingerprint)],
            evidence: covered ? [['layout-template-executed', 'frontend', fingerprint]] : [],
        }]};
        complete.xml.layout.total++;
        if (covered) complete.xml.layout.covered++;
        writeProjection(coverage, complete);
        fs.writeFileSync(path.join(artifact, 'evidence.json'), JSON.stringify({...evidence, ...entry, browser,
            host: entry.os === 'windows-latest' ? 'Windows' : 'Linux'}));
        artifacts.set(entry.id, artifact);
    }
    const run = () => spawnSync(process.execPath, [path.join(__dirname, 'ci/gate.cjs')], {cwd: root, encoding: 'utf8', env: {...process.env,
        CI_SHA: 'candidate', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_STEP_SUMMARY: '',
        CI_NEEDS: JSON.stringify(Object.fromEntries(['static', 'integration', 'copyright', 'e2e', 'magento', 'images'].map(job => [job, {result: 'success'}])))}});
    const complete = run();
    assert.equal(complete.status, 0, complete.stdout + complete.stderr);
    const qualification = JSON.parse(fs.readFileSync(path.join(root, 'ci-gate/qualification.json')));
    assert.equal(qualification.completedCases, 9);
    assert.equal(qualification.expectedAcceptanceTests, 72);
    const comparison = JSON.parse(fs.readFileSync(path.join(root, 'ci-gate/matrix-comparison.json')));
    assert.equal(comparison.runs.length, 8);
    assert.ok(comparison.runs.every(entry => !entry.directory.includes('windows-latest')));
    assert.ok(comparison.runs.some(entry => entry.directory.includes('ubuntu-latest-mageos-luma-cypress')));
    const hyva = cases.find(entry => entry.theme === 'hyva');
    const hyvaCoverage = path.join(artifacts.get(hyva.id), 'coverage');
    const original = readProjection(hyvaCoverage, snapshotFile);
    const divergent = structuredClone(original);
    const layout = divergent.xml.files['app/code/Application/Blog/view/frontend/layout/blog_index_index.xml'];
    layout.declarations[0].evidence = [];
    layout.declarations[0].state = layout.lines[1] = 'uncovered';
    divergent.xml.layout.covered--;
    writeProjection(hyvaCoverage, divergent);
    assert.equal(run().status, 1, 'A valid report with different layout outcomes in the same theme must fail');
    const failed = JSON.parse(fs.readFileSync(path.join(root, 'ci-gate/qualification.json')));
    assert.equal(failed.completedCases, 9);
    assert.equal(failed.themeReportsEqual, false);
    writeProjection(hyvaCoverage, original);
    const windows = cases.find(entry => entry.os === 'windows-latest');
    fs.renameSync(artifacts.get(windows.id), path.join(root, 'ci-artifacts', 'withheld-windows-case'));
    const missing = run();
    assert.equal(missing.status, 1);
    assert.match(missing.stdout, /Matrix comparison incomplete: 8\/9/);
});
test('layout qualification compares static declarations across storefronts', t => {
    const {directory} = fixture(t);
    const complete = snapshot(directory);
    const source = 'app/code/Application/Blog/view/frontend/layout/shared.xml';
    const fingerprint = 'a'.repeat(64);
    complete.xml.files[source] = {source: fingerprint, lines: {1: 'uncovered'}, declarations: [{
        id: fingerprint, supported: true, state: 'uncovered', range: [1, 1],
        layout: ['template', 'page', 1, ...Array(6).fill(fingerprint)], evidence: [],
    }]};
    const sharedProvider = 'app/design/frontend/MageLens/child/MageLens_Compatibility/layout/shared.xml';
    complete.xml.files[sharedProvider] = structuredClone(complete.xml.files[source]);
    complete.xml.layout.total = 2;
    const reports = cases.map(entry => ({...entry, snapshot: structuredClone(complete)}));
    assert.equal(compareThemes(reports, cases).passed, true);
    for (const change of [
        xml => { delete xml.files[source]; xml.layout.total--; },
        xml => { xml.files[source].source = 'b'.repeat(64); },
        xml => { xml.files[source].declarations[0].range = [2, 3]; },
        xml => { delete xml.files[sharedProvider]; xml.layout.total--; },
    ]) {
        const changed = structuredClone(reports);
        for (const report of changed.filter(entry => entry.theme === 'hyva')) change(report.snapshot.xml);
        assert.equal(compareThemes(changed, cases).passed, false, 'Storefront-wide change to shared layout passed qualification');
    }
});

test('layout qualification requires the summary even when every declaration is unmeasured', t => {
    const {directory} = fixture(t);
    const complete = snapshot(directory);
    const fingerprint = 'a'.repeat(64);
    complete.xml.files['app/code/Application/Blog/view/frontend/layout/shared.xml'] = {
        source: fingerprint, lines: {1: 'unmeasured'}, declarations: [{
            id: fingerprint, supported: false, state: 'unmeasured',
            layout: ['instruction', 'page', 0, ...Array(6).fill(fingerprint)], evidence: [],
        }],
    };
    delete complete.xml.layout;
    const summary = JSON.parse(fs.readFileSync(path.join(directory, 'summary.json')));
    assert.throws(() => validateSnapshot(complete, complete.run, summary), /Missing layout coverage summary/);
});

test('layout qualification requires the same actual Admin theme evidence', () => {
    const hash = value => createHash('sha256').update(value).digest('hex');
    const custom = 'adminhtml/Custom/theme-4';
    const entries = ['magento', 'mageos'].map(platform => ({
        id: platform, theme: 'luma', platform,
        snapshot: {xml: {files: {'app/code/Application/Blog/view/adminhtml/layout/shared.xml': {
            declarations: [{layout: ['template'], evidence: [hash('adminhtml/Magento/backend'), hash(custom)].sort()
                .map(theme => ['layout-template-executed', 'adminhtml', theme])}],
        }}}},
    }));
    assert.equal(compareThemes(entries, entries).passed, true);
    const declaration = Object.values(entries[1].snapshot.xml.files)[0].declarations[0];
    declaration.evidence.find(row => row[2] === hash('adminhtml/Magento/backend'))[2] = hash('adminhtml/MageOS/m137-admin-theme');
    assert.equal(compareThemes(entries, entries).passed, false);
});

test('case gate rejects missing or incomplete runner regressions and stale source builds', t => {
    const {directory, entry, evidence, context} = fixture(t);
    const file = path.join(directory, 'cypress-runner-results.json');
    const complete = JSON.parse(fs.readFileSync(file));
    for (const patch of [{totalTests: 0}, {totalPassed: 8}, {totalFailed: 1}, {totalPending: 1}, {totalSkipped: 1},
        {cypressVersion: '16.2.0'}, {browserName: 'electron'}, {build: {...complete.build, patchSha256: 'stale'}}]) {
        fs.writeFileSync(file, JSON.stringify({...complete, ...patch}));
        assert.throws(() => verifyCase(entry, evidence, directory, context), /runner regressions|source build/);
    }
    fs.rmSync(file);
    assert.throws(() => verifyCase(entry, evidence, directory, context), /ENOENT/);
    fs.writeFileSync(file, JSON.stringify(complete));
    const installationFile = path.join(directory, 'installation.json');
    const installation = JSON.parse(fs.readFileSync(installationFile));
    delete installation.runnerBuild;
    fs.writeFileSync(installationFile, JSON.stringify(installation));
    assert.throws(() => verifyCase(entry, evidence, directory, context), /Cypress source build/);
});
test('case gate rejects missing, different or unpinned browser results', t => {
    const {directory, entry, evidence, context} = fixture(t);
    const file = path.join(directory, `${entry.runner}-results.json`);
    const results = JSON.parse(fs.readFileSync(file));
    for (const browser of [null, {name: 'electron', version: pins.CHROME_VERSION},
        {name: 'chrome-for-testing', version: '0.0.0.0'}]) {
        fs.writeFileSync(file, JSON.stringify({...results, browser}));
        assert.throws(() => verifyCase(entry, {...evidence, browser}, directory, context), /Chrome browser/);
    }
});

test('final gate consumes only artifacts from the current workflow attempt', t => {
    const {directory, entry, evidence} = fixture(t);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-ci-attempt-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    fs.copyFileSync(path.join(__dirname, '../dependencies.yaml'), path.join(root, 'dependencies.yaml'));
    const install = attempt => {
        const artifact = path.join(root, 'ci-artifacts', `case-${entry.id}-attempt-${attempt}`);
        fs.cpSync(directory, path.join(artifact, 'coverage'), {recursive: true});
        fs.writeFileSync(path.join(artifact, 'evidence.json'), JSON.stringify({...evidence, attempt}));
    };
    const run = () => {
        const result = spawnSync(process.execPath, [path.join(__dirname, 'ci/gate.cjs')], {cwd: root, encoding: 'utf8', env: {...process.env,
            CI_SHA: 'candidate', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2', GITHUB_STEP_SUMMARY: '',
            CI_NEEDS: JSON.stringify(Object.fromEntries(['static', 'integration', 'copyright', 'e2e', 'magento', 'images'].map(job => [job, {result: 'success'}])))}});
        assert.equal(result.status, 1, 'A single report must never qualify the full matrix');
        return JSON.parse(fs.readFileSync(path.join(root, 'ci-gate/qualification.json')));
    };
    install('1');
    assert.equal(run().completedCases, 0, 'An older artifact cannot satisfy a rerun');
    install('2');
    const report = run();
    assert.equal(report.completedCases, 1, 'The current attempt must be found and verified');
    assert.equal(report.attempt, '2');
    assert.equal(report.passed, false);
});

test('case gate rejects stale collection reports and missing coverage evidence', t => {
    const {directory, entry, evidence, context} = fixture(t);
    const summaryFile = path.join(directory, 'summary.json');
    const summary = JSON.parse(fs.readFileSync(summaryFile));
    fs.writeFileSync(summaryFile, JSON.stringify({...summary, run: 'warmup'}));
    assert.throws(() => verifyCase(entry, evidence, directory, context), /warmup/);
    fs.writeFileSync(summaryFile, JSON.stringify(summary));
    fs.rmSync(path.join(directory, 'cypress-results.json'));
    assert.throws(() => verifyCase(entry, evidence, directory, context), /ENOENT/);
});

for (const file of ['php/line-coverage.json', 'js/coverage-final.json', 'templates/coverage-summary.json', snapshotFile, xmlFile]) {
    test(`every host case requires ${file}`, t => {
        const {directory, entry, evidence, context} = fixture(t);
        fs.rmSync(path.join(directory, file));
        assert.throws(() => verifyCase(entry, evidence, directory, context), /ENOENT/);
    });
}

test('failed harness uploads sanitized failing test counts without completed report pointers', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-ci-failed-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    fs.copyFileSync(path.join(__dirname, '../dependencies.yaml'), path.join(directory, 'dependencies.yaml'));
    const project = 'magelens-e2e-fixture';
    const coverage = path.join(directory, '.runtime/e2e', project, 'coverage');
    fs.mkdirSync(coverage, {recursive: true});
    fs.writeFileSync(path.join(directory, 'magelens-resource'), `${project} /tmp/magelens-e2e.fixture\n`);
    fs.writeFileSync(path.join(coverage, 'cypress-results.json'), JSON.stringify({
        run: 'failed-run', ...counts, totalPassed: 6, totalFailed: 1, message: 'SECRET',
        tests: [{title: browserTitles[0], status: 'failed', error: 'SECRET', screenshot: '/private/SECRET'}]
    }));
    fs.writeFileSync(path.join(coverage, 'cypress-runner-results.json'), JSON.stringify({
        ...counts, totalTests: 11, totalPassed: 10, totalFailed: 1, error: 'SECRET',
        build: {...provenance('x64'), credentials: 'SECRET'}
    }));
    const entry = cases[0];
    const result = spawnSync(process.execPath, [path.join(__dirname, 'ci/evidence.cjs')], {cwd: directory, encoding: 'utf8', env: {...process.env,
        CI_CASE: entry.id, CI_SHA: 'candidate', RUNNER_TEMP: directory, GITHUB_STEP_SUMMARY: '',
        CI_STEPS: JSON.stringify({e2e: {outcome: 'failure'}, cleanup: {outcome: 'success'}})}});
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(fs.readFileSync(path.join(directory, 'ci-reports', entry.id, 'evidence.json')));
    assert.equal(report.passed, false);
    assert.equal(report.counts.totalFailed, 1);
    assert.equal(report.counts.totalPassed, 6);
    assert.equal(report.runnerRegressionCounts.totalFailed, 1);
    assert.equal(report.runnerRegressionCounts.totalPassed, 10);
    const regressions = fs.readFileSync(path.join(directory, 'ci-reports', entry.id, 'cypress-runner-results.json'), 'utf8');
    assert.doesNotMatch(regressions, /SECRET|credentials/);
    const browser = fs.readFileSync(path.join(directory, 'ci-reports', entry.id, 'browser-results.json'), 'utf8');
    assert.doesNotMatch(browser, /SECRET|private|screenshot/);
    assert.match(browser, /failed/);
});

test('invalid full report fails its case while retaining safe acceptance and legacy coverage diagnostics', t => {
    const {directory, entry} = fixture(t);
    fs.copyFileSync(path.join(__dirname, '../dependencies.yaml'), path.join(directory, 'dependencies.yaml'));
    fs.writeFileSync(path.join(directory, 'magelens-result'), directory);
    fs.writeFileSync(path.join(directory, 'javascript-summary.json'), JSON.stringify({run: 'fresh', groups: {private: 'SECRET'}}));
    const result = spawnSync(process.execPath, [path.join(__dirname, 'ci/evidence.cjs')], {cwd: directory, encoding: 'utf8', env: {...process.env,
        CI_CASE: entry.id, CI_SHA: 'candidate', RUNNER_TEMP: directory, GITHUB_STEP_SUMMARY: '',
        CI_STEPS: JSON.stringify({e2e: {outcome: 'success'}, cleanup: {outcome: 'success'}})}});
    assert.equal(result.status, 1, result.stderr);
    const target = path.join(directory, 'ci-reports', entry.id);
    const evidence = JSON.parse(fs.readFileSync(path.join(target, 'evidence.json')));
    assert.equal(evidence.passed, false);
    assert.deepEqual(evidence.counts, counts);
    assert.ok(evidence.diagnosticLocations.some(location => location.includes('report-equivalence.cjs:')));
    assert.ok(fs.existsSync(path.join(target, 'coverage/php/line-coverage.json')));
    assert.ok(!fs.existsSync(path.join(target, 'coverage', snapshotFile)));
    assert.doesNotMatch(JSON.stringify(evidence), /SECRET/);
});
