// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function write(file, content) {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, content);
}

function filesBelow(directory) {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
        const file = path.join(directory, entry.name);
        return entry.isDirectory() ? filesBelow(file) : [file];
    });
}

function playwrightProject(project) {
    const support = JSON.stringify(path.join(root, 'playwright/support.cjs'));
    const serializer = JSON.stringify(path.join(root, 'cypress/support/failure-html.cjs'));
    write(path.join(project, 'coverage/run.json'), '{"id":"failure-snapshot-playwright-run"}\n');
    write(path.join(project, 'playwright.config.cjs'), `module.exports = {
        testDir: ${JSON.stringify(project)},
        testMatch: ['01-passing.spec.cjs', '02-failing.spec.cjs'],
        outputDir: ${JSON.stringify(path.join(project, 'artifacts'))},
        workers: 1,
        retries: 0,
        timeout: 30000,
        expect: {timeout: 2000},
        reporter: 'list',
        use: {browserName: 'chromium', channel: 'chrome', baseURL: 'https://magelens.test', ignoreHTTPSErrors: true, headless: false, screenshot: 'only-on-failure', trace: 'retain-on-failure'}
    };\n`);
    write(path.join(project, '01-passing.spec.cjs'), `
const {test, expect} = require(${support});
const {failureSnapshotDocument} = require(${serializer});

test('serializes live DOM without altering custom elements', async ({page}) => {
    let assetRequests = 0;
    await page.route('https://assets.invalid/**', route => { assetRequests++; return route.abort(); });
    await page.setContent(\`<!doctype html><html><head><style>STYLE_PAYLOAD_OMITTED</style><link rel="stylesheet" href="https://assets.invalid/app.css"></head><body>
        <main id="application"><p id="client-state">initial</p>
        <button id="checkout" disabled hidden readonly value="" aria-label="">Checkout</button>
        <input id="empty-field" disabled hidden readonly value="">
        <img src="https://assets.invalid/image.png">
        <template id="conditional"><button data-template-control="" hidden>Template control</button></template>
        <x-snapshot-probe data-probe=""></x-snapshot-probe>
        <script>window.__snapshotScriptPayload = 'SCRIPT_PAYLOAD_OMITTED'; document.querySelector('#client-state').textContent = 'client-side DOM state';</script></main>
    </body></html>\`);
    await page.evaluate(() => {
        window.__snapshotCustomEffects = 0;
        class SnapshotProbe extends HTMLElement {
            static get observedAttributes() { return ['data-probe']; }
            constructor() { super(); window.__snapshotCustomEffects++; }
            attributeChangedCallback() { window.__snapshotCustomEffects++; }
        }
        customElements.define('x-snapshot-probe', SnapshotProbe);
    });
    const effectsBefore = await page.evaluate(() => window.__snapshotCustomEffects);
    const requestsBefore = assetRequests;
    const html = await page.evaluate(failureSnapshotDocument, {runner: 'playwright', runId: 'serializer-run', test: 'serializer', attempt: 1});
    const effectsAfter = await page.evaluate(() => window.__snapshotCustomEffects);
    expect(html).toContain('client-side DOM state');
    expect(html).toContain('disabled=""');
    expect(html).toContain('hidden=""');
    expect(html).toContain('readonly=""');
    expect(html).toContain('value=""');
    expect(html).toContain('data-template-control=""');
    expect(html).toContain('Template control');
    expect(html).toContain('data-snapshot-href="https://assets.invalid/app.css"');
    expect(html).toContain('data-snapshot-src="https://assets.invalid/image.png"');
    expect(html).not.toContain('STYLE_PAYLOAD_OMITTED');
    expect(html).not.toContain('SCRIPT_PAYLOAD_OMITTED');
    expect(effectsAfter).toBe(effectsBefore);
    expect(assetRequests).toBe(requestsBefore);
});
`);
    write(path.join(project, '02-failing.spec.cjs'), `
const {test, expect} = require(${support});

test.describe('nested cleanup', () => {
    test.afterEach(async ({page}) => { await page.goto('about:blank'); });
    test('captures a client-side failure before cleanup and after another spec', async ({page}) => {
        await page.setContent('<!doctype html><main id="failed-page"><p data-testid="failure">initial</p></main>');
        await page.locator('[data-testid="failure"]').evaluate(element => { element.textContent = 'updated DOM before nested cleanup'; });
        await expect(page.locator('[data-testid="failure"]')).toHaveText('expected text that is not present');
    });
});
`);
}

async function verifyPlaywright() {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-playwright-failure-'));
    try {
        playwrightProject(project);
        const cli = path.join(path.dirname(require.resolve('@playwright/test')), 'cli.js');
        const result = require('node:child_process').spawnSync(process.execPath, [cli, 'test', '--config=playwright.config.cjs'], {
            cwd: project, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024
        });
        const output = `${result.stdout || ''}\n${result.stderr || ''}`;
        assert.equal(result.status, 1, `Expected exactly one intentional Playwright failure.\n${output}`);
        assert.match(output, /1 passed/);
        assert.match(output, /1 failed/);

        const artifacts = path.join(project, 'artifacts');
        const allFiles = filesBelow(artifacts);
        const snapshots = allFiles.filter(file => file.endsWith('.html'));
        assert.equal(snapshots.length, 1, `Expected one snapshot for the later failing spec; got ${snapshots.length}.\n${output}`);
        const html = fs.readFileSync(snapshots[0], 'utf8');
        assert.match(html, /updated DOM before nested cleanup/);
        assert.match(html, /&quot;runId&quot;:&quot;failure-snapshot-playwright-run&quot;/);
        assert.match(html, /&quot;attempt&quot;:1/);
        assert.match(html, /&quot;phase&quot;:&quot;test-body&quot;/);
        assert.ok(allFiles.some(file => file.endsWith('.png')), 'The existing failure screenshot must remain present.');
        assert.ok(allFiles.some(file => file.endsWith('.zip')), 'The existing failure trace must remain present.');
        console.log('PASS: Playwright multi-spec, pre-cleanup capture, serializer edge cases, screenshot and trace.');
    } finally {
        fs.rmSync(project, {recursive: true, force: true});
    }
}

async function verifyCypress() {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-cypress-failure-'));
    try {
        const applicationDomain = process.env.APPLICATION_DOMAIN || 'magelens.test';
        write(path.join(project, 'cypress/support/failure-snapshot.js'), fs.readFileSync(path.join(root, 'cypress/support/failure-snapshot.js')));
        write(path.join(project, 'cypress/support/failure-html.cjs'), fs.readFileSync(path.join(root, 'cypress/support/failure-html.cjs')));
        write(path.join(project, 'cypress/support/failure-metadata.cjs'), fs.readFileSync(path.join(root, 'cypress/support/failure-metadata.cjs')));
        write(path.join(project, 'cypress.config.cjs'), `
const fs = require('node:fs');
const path = require('node:path');
module.exports = {
    video: false,
    retries: 1,
    screenshotsFolder: path.join(__dirname, 'screenshots'),
    expose: {coverageRun: 'failure-snapshot-cypress-run'},
    e2e: {
        baseUrl: ${JSON.stringify(`https://${applicationDomain}`)},
        supportFile: 'cypress/support/failure-snapshot.js',
        specPattern: ['cypress/e2e/**/*.cy.js', 'src/app/code/**/Test/Cypress/**/*.cy.js'],
        setupNodeEvents(on, config) {
            const root = path.resolve(config.screenshotsFolder);
            on('task', {'failureSnapshot:write'({relativePath, html}) {
                if (Buffer.byteLength(html) > 1024 * 1024) return {saved: false, reason: 'oversized'};
                const target = path.resolve(root, relativePath);
                if (!target.startsWith(root + path.sep)) return {saved: false, reason: 'invalid-path'};
                fs.mkdirSync(path.dirname(target), {recursive: true});
                for (let attempt = 0; attempt < 32; attempt++) {
                    const candidate = attempt ? target.replace(/\\.html$/, '--' + (attempt + 1) + '.html') : target;
                    try { fs.writeFileSync(candidate, html, {encoding: 'utf8', flag: 'wx'}); return {saved: true}; }
                    catch (error) { if (error.code !== 'EEXIST') return {saved: false, reason: error.code || 'write-error'}; }
                }
                return {saved: false, reason: 'name-collision'};
            }});
            return config;
        }
    }
};\n`);
        write(path.join(project, 'cypress/e2e/failure.cy.js'), `
const {failureSnapshotDocument} = require('../support/failure-html.cjs');
describe('failure snapshot serialization', () => {
    it('preserves empty attributes, template content and inert custom-element cloning', () => {
        cy.visit('/');
        cy.document().then(document => {
            document.body.innerHTML = '<button disabled hidden readonly value="" aria-label="">Checkout</button><template><button data-template-control="">Template control</button></template><x-snapshot-probe data-probe=""></x-snapshot-probe><script>SCRIPT_PAYLOAD_OMITTED</script><style>STYLE_PAYLOAD_OMITTED</style>';
            const win = document.defaultView;
            win.__snapshotCustomEffects = 0;
            class SnapshotProbe extends win.HTMLElement {
                static get observedAttributes() { return ['data-probe']; }
                constructor() { super(); win.__snapshotCustomEffects++; }
                attributeChangedCallback() { win.__snapshotCustomEffects++; }
            }
            win.customElements.define('x-snapshot-probe', SnapshotProbe);
            const effectsBefore = win.__snapshotCustomEffects;
            const html = failureSnapshotDocument(document, {runner: 'cypress', test: 'serializer'});
            expect(html).to.include('disabled=""');
            expect(html).to.include('hidden=""');
            expect(html).to.include('readonly=""');
            expect(html).to.include('value=""');
            expect(html).to.include('data-template-control=""');
            expect(html).to.include('Template control');
            expect(html).not.to.include('SCRIPT_PAYLOAD_OMITTED');
            expect(html).not.to.include('STYLE_PAYLOAD_OMITTED');
            expect(win.__snapshotCustomEffects).to.equal(effectsBefore);
        });
    });
    it('captures the failed page and its actual retry number', () => {
        cy.visit('/');
        cy.document().then(document => {
            document.body.innerHTML = '<main><p id="failure">initial</p></main>';
            document.querySelector('#failure').textContent = 'client-side state from failing attempt';
            expect(document.querySelector('#failure').textContent).to.equal('expected text that is not present');
        });
    });
});
`);
        write(path.join(project, 'src/app/code/Regression/Test/Cypress/anchor.cy.js'), `
describe('module spec path anchor', () => {
    it('passes', () => {});
});
`);
        const cypress = require('cypress');
        const result = await cypress.run({project, browser: 'chrome-for-testing', headed: true});
        assert.equal(result.totalTests, 3, JSON.stringify({totalTests: result.totalTests, failures: result.failures}));
        assert.equal(result.totalFailed, 1, JSON.stringify({totalFailed: result.totalFailed, failures: result.failures}));
        assert.equal(result.totalPassed, 2, JSON.stringify({totalPassed: result.totalPassed}));

        const allFiles = filesBelow(path.join(project, 'screenshots'));
        const snapshots = allFiles.filter(file => file.endsWith('.html'));
        assert.equal(snapshots.length, 2, `Expected one HTML snapshot per failed retry; found ${snapshots.length}.`);
        for (const [index, file] of snapshots.entries()) {
            const expectedAttempt = index + 1;
            const html = fs.readFileSync(file, 'utf8');
            assert.match(path.basename(file), new RegExp(`attempt-${expectedAttempt}`));
            assert.match(html, new RegExp(`&quot;attempt&quot;:${expectedAttempt}`));
            assert.match(html, /client-side state from failing attempt/);
            assert.match(html, /&quot;runId&quot;:&quot;failure-snapshot-cypress-run&quot;/);
        }
        const screenshots = allFiles.filter(file => file.endsWith('.png'));
        assert.ok(screenshots.length > 0, 'Cypress must retain its failure screenshot.');
        assert.ok(snapshots.every(file => path.dirname(file) === path.dirname(screenshots[0])), 'HTML snapshots must sit alongside Cypress screenshots.');
        console.log('PASS: Cypress retry metadata, live DOM, serializer edge cases and failure screenshot.');
    } finally {
        fs.rmSync(project, {recursive: true, force: true});
    }
}

async function main() {
    const runner = process.argv[2];
    if (runner === 'playwright') return verifyPlaywright();
    if (runner === 'cypress') return verifyCypress();
    throw new Error('Usage: node tests/failure-snapshot-regressions.cjs cypress|playwright');
}

if (require.main === module) main().catch(error => {console.error(error); process.exitCode = 1;});
