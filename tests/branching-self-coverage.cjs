// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const threads = require('node:worker_threads');
const {createHash} = require('node:crypto');
const {createInstrumenter} = require('istanbul-lib-instrument');
const {createCoverageMap} = require('istanbul-lib-coverage');
const {createContext} = require('istanbul-lib-report');
const reports = require('istanbul-reports');

// Instrument only disposable in-memory code. Original files and line maps stay
// unchanged. Never enable this harness for performance measurements.
function selfCoverage(output) {
    const root = path.resolve(__dirname, '..');
    const scope = [
        ...fs.readdirSync(path.join(root, 'branching'), {recursive: true})
            .filter(file => file.endsWith('.cjs') || file.endsWith('.mjs'))
            .map(file => 'branching/' + file.split(path.sep).join('/')),
        'branching/dashboard/app.js', 'playwright/branching.cjs'
    ].sort();
    const sources = new Map(), instrumented = new Map(), hashes = {}, coverage = createCoverageMap({});
    for (const relative of scope) {
        const file = path.join(root, relative), source = fs.readFileSync(file, 'utf8'); sources.set(file, source);
        hashes[relative] = createHash('sha256').update(source).digest('hex');
        const instrumenter = createInstrumenter({coverageGlobalScope: 'globalThis', coverageGlobalScopeFunc: false, compact: false});
        instrumented.set(file, instrumenter.instrumentSync(source, file));
        coverage.addFileCoverage(instrumenter.lastFileCoverage());
    }
    const previous = Module._extensions['.cjs'], fallback = previous ?? Module._extensions['.js'];
    Module._extensions['.cjs'] = (module, file) => instrumented.has(file) ? module._compile(instrumented.get(file), file) : fallback(module, file);
    const OriginalWorker = threads.Worker, workerReports = path.join(output, 'workers');
    fs.mkdirSync(workerReports, {recursive: true}); let workerNumber = 0;
    threads.Worker = class extends OriginalWorker {
        constructor(file, options) {
            if (!instrumented.has(file)) { super(file, options); return; }
            const report = path.join(workerReports, `${++workerNumber}.json`);
            super(instrumented.get(file) + `\nprocess.on('exit', () => require('node:fs').writeFileSync(${JSON.stringify(report)}, JSON.stringify(globalThis.__coverage__ ?? {})));`, {...options, eval: true});
        }
    };
    return {
        transformAsset: (file, source) => instrumented.get(file) ?? source,
        async browser(page) {
            if (page.isClosed()) return;
            const data = await page.evaluate(() => {
                const value = JSON.parse(JSON.stringify(globalThis.__coverage__ ?? {}));
                for (const file of Object.values(globalThis.__coverage__ ?? {})) {
                    for (const key of Object.keys(file.s)) file.s[key] = 0;
                    for (const key of Object.keys(file.f)) file.f[key] = 0;
                    for (const counts of Object.values(file.b)) counts.fill(0);
                }
                return value;
            });
            coverage.merge(data);
        },
        finish(result) {
            coverage.merge(globalThis.__coverage__ ?? {});
            threads.Worker = OriginalWorker;
            for (const file of fs.readdirSync(workerReports)) coverage.merge(JSON.parse(fs.readFileSync(path.join(workerReports, file), 'utf8')));
            if (previous) Module._extensions['.cjs'] = previous; else delete Module._extensions['.cjs'];
            for (const [file, source] of sources) {
                if (fs.readFileSync(file, 'utf8') !== source) throw new Error('Source changed during self-coverage');
            }
            fs.mkdirSync(output, {recursive: true});
            const context = createContext({dir: output, coverageMap: coverage, sourceFinder: file => sources.get(file)});
            for (const reporter of ['html', 'json', 'json-summary', 'text-summary']) reports.create(reporter).execute(context);
            const summary = coverage.getCoverageSummary().toJSON();
            fs.writeFileSync(path.join(output, 'qualification.json'), JSON.stringify({schemaVersion: 1, ...result,
                scope, sourceSha256: hashes, summary, originalSourcesUnchanged: true,
                exclusions: 'Magento/PHP backends and application-test coverage are outside this self-coverage report. Native Rust coverage, when enabled by the self-test image, is reported separately.'}, null, 2) + '\n');
            return summary;
        }
    };
}
module.exports = {selfCoverage};
