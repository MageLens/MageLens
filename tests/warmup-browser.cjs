// Isolated browser regression: ./bin/application-compose exec -T runner node tests/warmup-browser.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const execute = promisify(execFile);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-warmup-'));
const root = path.resolve(__dirname, '..');
const requests = [];
let scenario = 'loaded';
const server = http.createServer((request, response) => {
    requests.push({url: request.url, cookie: request.headers.cookie || ''});
    const send = (body, type = 'text/html') => {
        response.writeHead(200, {'content-type': type, 'cache-control': 'no-store'});
        response.end(body);
    };
    if (request.url === '/late.js') return setTimeout(() => send('window.lateScript = true;', 'text/javascript'), 700);
    if (request.url === '/late.css') return setTimeout(() => send('body { color: black; }', 'text/css'), 700);
    if (request.url === '/template.html') return setTimeout(() => send('<p data-cy="rendered-template">Loaded article</p>'), 700);
    if (request.url === '/admin.css') return setTimeout(() => send('body { color: blue; }', 'text/css'), 2000);
    if (request.url === '/admin-login/') return send('<html><head><link rel="stylesheet" href="/admin.css"></head><body data-mage-init="{}">Admin login</body></html>');
    if (request.url === '/unfinished-template.html') return; // Deliberate unresolved request.
    if (request.url === '/' && scenario !== 'loaded') return send(`<html><body data-mage-init="{}"><script>
        window.requirejs = {s: {contexts: {_: {registry: ${scenario === 'module'
            ? "{unfinished: {enabled: true, map: {url: '/unfinished-template.html'}}}" : '{}'}}}}};
        ${scenario === 'request' ? "window.addEventListener('load', () => fetch('/unfinished-template.html'));" : ''}
    </script></body></html>`);
    if (request.url === '/') return send(`<html><body data-mage-init="{}"><script>
        window.requirejs = {s: {contexts: {_: {registry: {late: {enabled: true, map: {url: '/late.js'}}}}}}};
        window.__coverage__ = {warmupOnly: {path: '/warmup-only.js', s: {0: 1}}};
        window.addEventListener('load', () => setTimeout(async () => {
            const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = '/late.css'; document.head.append(style);
            const script = document.createElement('script'); script.src = '/late.js'; document.head.append(script);
            script.onload = async () => {
                delete window.requirejs.s.contexts._.registry.late;
                window.requirejs.s.contexts._.registry.template = {enabled: true, map: {url: '/template.html'}};
                const template = await fetch('/template.html').then(response => response.text());
                document.body.insertAdjacentHTML('beforeend', template);
                delete window.requirejs.s.contexts._.registry.template;
                // A retained declaration must not block an otherwise idle page.
                window.localStorage.setItem('warmup-only', 'set');
                window.sessionStorage.setItem('warmup-only', 'set');
                document.cookie = 'warmup-only=set; path=/';
            };
        }, 500));
    </script></body></html>`);
    send('<html><body>Fresh storefront</body></html>');
});

function write(file, text) {
    fs.mkdirSync(path.dirname(path.join(scratch, file)), {recursive: true});
    fs.writeFileSync(path.join(scratch, file), text);
}
function read(file) { return JSON.parse(fs.readFileSync(path.join(scratch, file))); }

async function browser(warmup, shouldFail = false) {
    try {
        await execute(process.execPath, ['bin/run-browser.cjs', ...(warmup ? ['--warmup'] : [])], {
            cwd: scratch, env: {...process.env, CYPRESS_BASE_URL: `http://127.0.0.1:${server.address().port}`},
            timeout: 90000, maxBuffer: 2 * 1024 * 1024
        });
        assert.equal(shouldFail, false, 'Expected preparation to reject unresolved assets');
    } catch (error) {
        if (!shouldFail || error.code !== 1) {
            console.error(error.stdout, error.stderr);
            throw error;
        }
    }
}

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    for (const file of ['cypress.config.cjs', 'bin/run-browser.cjs', 'bin/project.cjs',
        'cypress/support/warmup.js', 'cypress/support/e2e.js', 'cypress/support/javascript-coverage.js', 'cypress/warmup/storefront.cy.js']) {
        write(file, fs.readFileSync(path.join(root, file)));
    }
    fs.symlinkSync(path.dirname(path.dirname(require.resolve('cypress/package.json'))), path.join(scratch, 'node_modules'));
    write('coverage/project-fixtures.json', JSON.stringify({Admin: {warmupPaths: ['/admin-login/']}}));
    write('coverage/run.json', JSON.stringify({id: 'a'.repeat(32)}));
    await browser(true);
    assert.equal(read('coverage/warmup-results.json').totalPassed, 1);
    const loaded = read('coverage/warmup-diagnostics.json');
    assert.equal(loaded.initializerMarkers, 1, 'The retained marker regression did not execute');
    assert.deepEqual(loaded.pendingRequests, []);
    assert.deepEqual(loaded.pendingModules, []);
    for (const url of ['/late.js', '/late.css', '/template.html', '/admin-login/', '/admin.css']) {
        assert.ok(requests.some(request => request.url === url), `Warm-up missed ${url}`);
    }
    assert.ok(loaded.page.endsWith('/admin-login/'), 'Warm-up did not finish the fixture page');
    assert.ok(!fs.existsSync(path.join(scratch, '.nyc_output')), 'Warm-up wrote JavaScript coverage');
    assert.ok(!fs.existsSync(path.join(scratch, 'coverage/raw')), 'Warm-up wrote raw coverage');
    assert.ok(requests.every(request => !request.cookie.includes('application_coverage=')), 'Warm-up sent a PHP collection cookie');

    write('cypress/e2e/fresh.cy.js', `it('starts the coverage suite with fresh browser state', () => {
        cy.visit('/fresh');
        cy.window().then(win => {
            expect(win.localStorage.getItem('warmup-only')).to.equal(null);
            expect(win.sessionStorage.getItem('warmup-only')).to.equal(null);
            expect(win.__coverage__).not.to.have.property('warmupOnly');
        });
        cy.getCookie('warmup-only').should('equal', null);
        cy.getCookie('application_coverage').its('value').should('equal', '${'a'.repeat(32)}');
        expect(Cypress.config('pageLoadTimeout')).to.equal(60000);
        expect(Cypress.config('defaultCommandTimeout')).to.equal(15000);
    });`);
    await browser(false);
    assert.equal(read('coverage/cypress-results.json').totalPassed, 1);
    assert.ok(requests.filter(request => request.url === '/fresh').every(request => request.cookie.includes('application_coverage=')));
    console.log('PASS: homepage and fixture assets finish loading; retained initializer markers do not block; warm-up produces no coverage; tests start with fresh state and existing timeouts.');

    write('cypress/warmup/storefront.cy.js', fs.readFileSync(path.join(root, 'cypress/warmup/storefront.cy.js'), 'utf8')
        .replace("describe('Storefront warm-up',", "describe('Storefront warm-up', {defaultCommandTimeout: 1500},"));
    for (scenario of ['module', 'request']) {
        await browser(true, true);
        const diagnostics = read('coverage/warmup-diagnostics.json');
        assert.equal(diagnostics.failed, true);
        if (scenario === 'module') {
            assert.ok(diagnostics.pendingModules.some(module => module.id === 'unfinished'));
            assert.deepEqual(diagnostics.pendingRequests, []);
        } else {
            assert.ok(diagnostics.pendingRequests.some(request => request.url.endsWith('/unfinished-template.html')));
            assert.deepEqual(diagnostics.pendingModules, []);
        }
        assert.equal(read('coverage/warmup-results.json').totalFailed, 1);
    }
    console.log('PASS: unfinished requests and RequireJS modules independently block readiness and produce diagnostics.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
    server.closeAllConnections();
    server.close();
    fs.rmSync(scratch, {recursive: true, force: true});
});
