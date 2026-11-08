// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {assessed} = require('./fixtures/branching/assessment.cjs');
const {assertAssessed, EstimationError, readManifest} = require('../branching/estimation.cjs');
const {verifySources, buildWorkflow} = require('../branching/automatic.cjs');
const {runSuite} = require('../branching/suite.cjs');
const {fileDigest} = require('../branching/engine.cjs');
function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-estimation-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const source = path.join(root, 'flow.spec.ts'); fs.writeFileSync(source, 'await page.goto("/");');
    const manifest = assessed({schemaVersion: 1, root, sources: [{path: 'flow.spec.ts', sha256: fileDigest(source)}],
        diagnostics: [], checkpoints: [], schedule: ['first', 'second'], tests: ['first', 'second'].map(id => ({id, title: id, file: 'flow.spec.ts', line: 1,
            disposition: 'adapter-required', reasons: ['Native fixture'], steps: [{kind: 'statement', line: 1, actionUnits: 8}]}))});
    return {root, manifest, file: path.join(root, 'manifest.json')};
}
const failed = error => error instanceof EstimationError && error.statusCode === 500 && error.code === 'ESTIMATION_FAILED' && error.issues.length > 0;
test('missing, unresolved and inconsistent estimates block every test before discovery, including explicit selections', async t => {
    for (const change of [m => delete m.assessment, m => m.implementation = 'rust-prefix-v1',
        m => m.diagnostics.push('Dynamic registration'), m => m.tests[1].steps[0].estimate.analysisComplete = false,
        m => delete m.tests[1].steps[0].estimate, m => delete m.tests[1].fixtureEstimate,
        m => m.tests[1].workerEstimate.analysisComplete = false, m => m.tests[1].lifecycleEstimate.analysisComplete = false,
        m => m.tests[1].estimate.analysisComplete = false, m => m.assessment.analysis.totalStatements++,
        m => m.tests[1] = null, m => m.tests[1].steps[0] = null,
        m => m.tests[1].steps[0].estimate.issues.push({kind: 'unsupported-analysis', message: 'Unresolved operation'})]) {
        const {manifest, root} = fixture(t); change(manifest);
        assert.throws(() => verifySources(manifest), failed);
        assert.throws(() => buildWorkflow(manifest, {}, ['first']), failed);
        await assert.rejects(runSuite({manifest, project: {}, directory: root,
            runner: {collect: () => assert.fail('Incomplete estimates must block collection')},
            runCheckpoint: () => assert.fail('Incomplete estimates must block execution')}), failed);
    }
});
test('native-only and setup tests without source assessments cannot fall back to execution', async t => {
    for (const setup of [false, true]) {
        const {manifest, root} = fixture(t), file = path.join(root, 'flow.spec.ts');
        await assert.rejects(runSuite({manifest, project: {native: {config: 'unused'}}, directory: root,
            runner: {collect: async () => ({exitCode: 0, errors: [], tests: [{id: 'missing', title: 'unassessed', file, line: 9, project: setup ? 'setup' : 'browser'}],
                config: {projects: [{name: 'setup'}, {name: 'browser', dependencies: ['setup']}]}}),
            run: () => assert.fail('Unassessed native work must not execute')},
            runCheckpoint: () => assert.fail('Unassessed native work must not execute')}), failed);
    }
});
test('execution and explicit calibration reject failed estimates before loading project configuration', async t => {
    const f = fixture(t), config = path.join(f.root, 'project.cjs'), marker = path.join(f.root, 'executed');
    fs.writeFileSync(config, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');module.exports={};`);
    f.manifest.tests[0].steps[0].estimate.analysisComplete = false;
    fs.writeFileSync(f.file, JSON.stringify(f.manifest));
    for (const cli of ['auto-cli', 'calibration-cli']) {
        await assert.rejects(require(`../branching/${cli}.cjs`).run([f.file, config, f.root]), failed);
        const command = require('node:child_process').spawnSync(process.execPath, [path.join(__dirname, `../branching/${cli}.cjs`), f.file, config, f.root], {encoding: 'utf8'});
        assert.equal(command.status, 1);
        assert.equal(JSON.parse(command.stderr).statusCode, 500);
        assert.equal(fs.existsSync(marker), false);
        assert.equal(JSON.parse(fs.readFileSync(f.file + '.error.json')).statusCode, 500);
    }
});

test('calibration checks external lifecycle before opening a backend or calibrating', async t => {
    const f = fixture(t), config = path.join(f.root, 'project.cjs');
    fs.writeFileSync(f.file, JSON.stringify(f.manifest)); fs.writeFileSync(config, 'module.exports={native:{config:"native"}};');
    const seen = [], module = {exports: {}}, base = path.resolve(__dirname, '../branching');
    const fakeRequire = name => {
        if (name === './runners/index.cjs') return {loadRunner: () => ({native: {collect: async () => {
            seen.push('collect');
            return {exitCode: 0, errors: [], tests: [{id: 'test'}], config: {unassessedLifecycle: ['External hooks']}};
        }}, open: () => assert.fail('Calibration must not open a runtime')})};
        if (name === './baseline.cjs') return {openProject: () => assert.fail('Calibration must not inspect the backend')};
        if (name === './retained-magento.cjs') return {RetainedMagentoBackend: class {constructor() {assert.fail('No backend');}}};
        if (name === './workflow-lease.cjs') return {acquire: () => ({}), release: () => {seen.push('release'); return true;}};
        if (name === './storage.cjs') return {probe: () => {}};
        return require(name.startsWith('.') ? path.resolve(base, name) : name);
    };
    require('node:vm').runInNewContext(fs.readFileSync(path.join(base, 'calibration-cli.cjs'), 'utf8'), {require: fakeRequire, module, process, console});
    await assert.rejects(module.exports.run([f.file, config, f.root]), failed);
    assert.deepEqual(seen, ['collect', 'release']);
});
test('a failed replan blocks the old manifest until a successful plan clears the failure', t => {
    const f = fixture(t); fs.writeFileSync(f.file, JSON.stringify(f.manifest));
    assert.doesNotThrow(() => readManifest(f.file));
    fs.writeFileSync(f.file + '.error.json', JSON.stringify(new EstimationError([{phase: 'source', message: 'Unresolved helper'}])));
    assert.throws(() => readManifest(f.file), failed);
    fs.unlinkSync(f.file + '.error.json');
    assert.doesNotThrow(() => readManifest(f.file));
});
test('dashboard returns HTTP 500 for partial analysis and failed replans, and recovers after repair', async t => {
    const f = fixture(t); fs.writeFileSync(f.file, JSON.stringify(f.manifest));
    const app = await require('../branching/dashboard/server.cjs').startDashboard({directory: path.join(f.root, 'events'), manifest: f.file, port: 0});
    t.after(() => app.close());
    assert.equal((await fetch(app.url + '/api/state')).status, 200);
    for (const sidecar of [false, true]) {
        if (sidecar) fs.writeFileSync(f.file + '.error.json', JSON.stringify(new EstimationError([{phase: 'source', message: 'Unresolved helper'}])));
        else { f.manifest.tests[0].steps[0].estimate.analysisComplete = false; fs.writeFileSync(f.file, JSON.stringify(f.manifest)); }
        await app.scan();
        for (const route of ['/api/state', '/events']) {
            const response = await fetch(app.url + route), state = await response.json();
            assert.equal(response.status, 500); assert.equal(state.error.code, 'ESTIMATION_FAILED');
            assert.equal(state.plan, null); assert.ok(state.warnings.some(w => w.includes('500')));
        }
        if (sidecar) fs.unlinkSync(f.file + '.error.json');
        f.manifest.tests[0].steps[0].estimate.analysisComplete = true; fs.writeFileSync(f.file, JSON.stringify(f.manifest)); await app.scan();
        assert.equal((await fetch(app.url + '/api/state')).status, 200);
        assert.equal(app.snapshot().error, null);
    }
});
test('runtime-dependent but fully analyzed estimates remain valid', t => {
    const {manifest} = fixture(t), estimate = manifest.tests[0].steps[0].estimate;
    estimate.complete = false; estimate.upperBoundPoints = null; estimate.lowerBoundPoints = 0;
    estimate.issues = [{kind: 'runtime-input', message: 'Iteration count depends on runtime data'}];
    assert.doesNotThrow(() => assertAssessed(manifest));
});

test('an open dashboard stream clears its preview when assessment fails', async t => {
    const f = fixture(t); fs.writeFileSync(f.file, JSON.stringify(f.manifest));
    const app = await require('../branching/dashboard/server.cjs').startDashboard({directory: path.join(f.root, 'events'), manifest: f.file, port: 0});
    t.after(() => app.close());
    const response = await fetch(app.url + '/events'), reader = response.body.getReader();
    t.after(() => reader.cancel());
    let buffer = '';
    async function next() {
        while (true) {
            const end = buffer.indexOf('\n\n');
            if (end < 0) { const chunk = await reader.read(); assert.equal(chunk.done, false); buffer += new TextDecoder().decode(chunk.value); continue; }
            const packet = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            if (packet.includes('event: journal')) return JSON.parse(packet.split('\n').find(line => line.startsWith('data: ')).slice(6));
        }
    }
    assert.ok((await next()).manifest);
    fs.writeFileSync(f.file + '.error.json', JSON.stringify(new EstimationError([{phase: 'fixture', message: 'Unresolved setup'}])));
    await app.scan();
    const failed = await next(); assert.equal(failed.manifest, null); assert.equal(failed.error.statusCode, 500);
    fs.unlinkSync(f.file + '.error.json'); await app.scan();
    const repaired = await next(); assert.ok(repaired.manifest); assert.equal(repaired.error, null);
});

test('dashboard browser retrieves HTTP 500 details when EventSource hides the response', async t => {
    const listeners = new Map(), seen = [], {connectStream} = await import('../branching/dashboard/stream.mjs');
    t.mock.method(globalThis, 'fetch', async route => {
        assert.equal(route, '/api/state');
        return {status: 500, json: async () => ({plan: null, runs: [], warnings: ['Assessment failed'], error: {code: 'ESTIMATION_FAILED'}})};
    });
    for (const [name, value] of Object.entries({EventSource: class {addEventListener(name, fn) { listeners.set(name, fn); } close() {}}, cancelAnimationFrame: () => {}})) {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
        Object.defineProperty(globalThis, name, {value, configurable: true, writable: true});
        t.after(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; });
    }
    const stream = connectStream({onData: data => seen.push(data), onConnection: connected => seen.push(connected)});
    await listeners.get('error')(); stream.close();
    assert.equal(seen[0], false); assert.equal(seen[1].error.code, 'ESTIMATION_FAILED'); assert.equal(seen[1].plan, null);
});
