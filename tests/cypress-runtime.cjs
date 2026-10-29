// Real Cypress checks for Node-side TLS, proxy decompression and concurrent artifacts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const {execFileSync, spawn} = require('node:child_process');
const {gzipSync} = require('node:zlib');

async function worker(project) {
    const result = await require('cypress').run({project, browser: 'electron', headed: true});
    fs.writeFileSync(path.join(project, 'result.json'), JSON.stringify(result, null, 2));
    assert.equal(result.totalTests, 3);
    assert.equal(result.totalPassed, 3);
    assert.equal(result.totalFailed, 0);
    assert.equal(result.totalPending, 0);
    assert.equal(result.totalSkipped, 0);
    assert.ok(!result.failures);
}

async function main() {
    assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, '0');
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-cypress-tls-'));
    const output = path.resolve('coverage/cypress-runtime', path.basename(temporary));
    fs.mkdirSync(output, {recursive: true});
    let server;
    try {
        const key = path.join(temporary, 'key.pem');
        const cert = path.join(temporary, 'cert.pem');
        execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
            '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
            '-keyout', key, '-out', cert], {stdio: 'ignore'});
        server = https.createServer({key: fs.readFileSync(key), cert: fs.readFileSync(cert)}, (req, res) => {
            const html = '<!doctype html><html><body><h1>HTTPS fixture</h1><script>window.fixtureHits = 1;</script></body></html>';
            res.setHeader('Content-Type', 'text/html');
            if (req.url === '/compressed') {
                res.setHeader('Content-Encoding', 'x-gzip');
                res.end(gzipSync(html));
            } else res.end(html);
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const baseUrl = `https://127.0.0.1:${server.address().port}`;
        const projects = ['first', 'second'].map(shard => {
            const project = path.join(output, shard);
            fs.mkdirSync(project);
            fs.writeFileSync(path.join(project, 'cypress.config.cjs'), `
const https = require('node:https');
const ca = require('node:fs').readFileSync(${JSON.stringify(cert)});
const request = options => new Promise(resolve => {
    https.get(${JSON.stringify(baseUrl)}, options, response => {
        response.resume(); response.on('end', () => resolve({status: response.statusCode}));
    }).on('error', error => resolve({code: error.code}));
});
module.exports = {
    video: false, retries: 0,
    screenshotsFolder: ${JSON.stringify(path.join(project, 'screenshots'))},
    e2e: {baseUrl: ${JSON.stringify(baseUrl)}, supportFile: false, specPattern: 'runtime.cy.js',
        setupNodeEvents(on) {
            on('task', {tls: async () => ({
                untrusted: await request({}), trusted: await request({ca}),
                wrongHost: await request({ca, servername: 'wrong.invalid'})
            })});
        }
    }
};
`);
            fs.writeFileSync(path.join(project, 'runtime.cy.js'), `
describe('Cypress runtime', () => {
    it('validates Node-side certificates and hostnames', () => {
        cy.task('tls').then(result => {
            expect(result.untrusted.code).to.equal('DEPTH_ZERO_SELF_SIGNED_CERT');
            expect(result.trusted.status).to.equal(200);
            expect(result.wrongHost.code).to.equal('ERR_TLS_CERT_ALTNAME_INVALID');
        });
    });
    it('injects scripts into x-gzip HTTPS responses', () => {
        cy.visit('/compressed');
        cy.contains('h1', 'HTTPS fixture');
        cy.window().its('fixtureHits').should('equal', 1);
    });
    it('retains an identically named screenshot in each shard', () => {
        cy.visit('/');
        cy.contains('h1', 'HTTPS fixture');
        cy.screenshot('parallel-artifact');
    });
});
`);
            return project;
        });
        const statuses = await Promise.all(projects.map(project => new Promise((resolve, reject) => {
            const log = fs.openSync(path.join(project, 'run.log'), 'w');
            const child = spawn(process.execPath, [__filename, '--worker', project], {
                env: {...process.env, CYPRESS_BASE_URL: baseUrl}, stdio: ['ignore', log, log]
            });
            fs.closeSync(log);
            child.once('error', reject);
            child.once('exit', code => resolve({project, code}));
        })));
        for (const {project, code} of statuses) {
            assert.equal(code, 0, `Cypress runtime failed; inspect ${project}/run.log`);
            const result = JSON.parse(fs.readFileSync(path.join(project, 'result.json')));
            const screenshots = result.runs.flatMap(run => run.screenshots);
            assert.equal(screenshots.length, 1);
            const screenshot = screenshots[0].path;
            assert.ok(screenshot.startsWith(project + path.sep), 'Shard artifacts must remain isolated');
            assert.equal(fs.readFileSync(screenshot).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
        }
        console.log(`PASS: TLS validation, x-gzip injection and both concurrent screenshots: ${output}`);
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        fs.rmSync(temporary, {recursive: true, force: true});
    }
}

(process.argv[2] === '--worker' ? worker(process.argv[3]) : main()).catch(error => {
    console.error(error);
    process.exitCode = 1;
});
