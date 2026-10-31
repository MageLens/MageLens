// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {createHash, randomBytes} = require('node:crypto');
const {setBadgeSection} = require('./badges.cjs');
const {discover, files, writeRuntime, writeChanged, nginxConfig, withThemeRoots, isCoverageExcluded, readCoverageConfig} = require('./project.cjs');
const {createJavascriptScope} = require('./javascript-scope.cjs');
const digest = value => createHash('sha256').update(value).digest('hex');
const browserFile = file => /\.(js|html|phtml)$/.test(file) && !isCoverageExcluded(file);

function applicationFiles(roots = discover().roots) {
    return roots.flatMap(root => files(`src/${root}`));
}

function sourceHashes(roots) {
    return Object.fromEntries(applicationFiles(roots).map(file => [file, digest(fs.readFileSync(file))]));
}

function runtimeHashes(roots) {
    return Object.fromEntries(roots.flatMap(root => fs.existsSync(`.runtime/${root}`) ? files(`.runtime/${root}`) : [])
        .map(file => [`src/${path.relative('.runtime', file)}`, digest(fs.readFileSync(file))]));
}

function prepare({plain = false, runtimeOnly = false, themeRoots} = {}) {
    const discovered = discover();
    const project = themeRoots === undefined ? discovered : withThemeRoots(discovered, themeRoots);
    const inputs = sourceHashes(discovered.roots); // Reject symlinks before changing copies.
    const before = runtimeHashes(discovered.roots);
    const scoped = file => project.roots.some(root => file.startsWith(`src/${root}/`));
    const selectedBrowser = Object.keys(inputs).filter(file => scoped(file) && browserFile(file));
    const javascriptScope = createJavascriptScope(Object.keys(inputs).filter(scoped));
    const cachePath = '.runtime/instrumentation.json';
    const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath)) : null;
    const signature = digest(JSON.stringify({roots: project.roots, config: readCoverageConfig(),
        sources: selectedBrowser.map(file => [file, inputs[file]]),
        tools: [__filename, require.resolve('./project.cjs'), require.resolve('./javascript-scope.cjs'), 'package-lock.json',
            ...files(path.dirname(require.resolve('@vitaliiboiko/magento-template-coverage'))).filter(file => file.endsWith('.js'))
        ].map(file => digest(fs.readFileSync(file)))}));
    const reuse = !plain && cache?.signature === signature
        && fs.existsSync('.runtime/template-manifest.json') && fs.existsSync('.runtime/js-baseline.json') && fs.existsSync('.runtime/javascript-scope.json')
        && selectedBrowser.every(file => before[file] === cache.outputs[file]);
    if (!plain && !runtimeOnly && cache && JSON.stringify(cache.mountRoots) !== JSON.stringify(discovered.roots)) {
        throw new Error('Source mount directories changed. Run ./install.sh before running coverage.');
    }
    for (const root of discovered.roots) fs.mkdirSync(`.runtime/${root}`, {recursive: true});
    for (const file of Object.keys(before)) {
        if (!(file in inputs)) fs.rmSync(path.join('.runtime', path.relative('src', file)));
    }
    for (const [file, hash] of Object.entries(inputs)) {
        const expected = reuse && scoped(file) && browserFile(file) ? cache.outputs[file] : hash;
        if (before[file] !== expected) {
            const target = path.join('.runtime', path.relative('src', file));
            fs.mkdirSync(path.dirname(target), {recursive: true});
            fs.copyFileSync(file, target);
        }
    }
    writeRuntime(project, discovered.roots);
    if (fs.existsSync('docker/nginx.conf')) writeChanged('.runtime/nginx.conf', nginxConfig(fs.readFileSync('docker/nginx.conf', 'utf8')));
    if (plain) {
        fs.rmSync(cachePath, {force: true});
        return;
    }
    if (!project.roots.length) throw new Error('No source found in src/app/code or selected themes');
    if (!reuse) {
        const {createInstrumenter} = require('istanbul-lib-instrument');
        const {createManifest, instrument} = require('@vitaliiboiko/magento-template-coverage');
        const manifest = createManifest({source: 'src', roots: project.roots});
        manifest.templates = manifest.templates.filter(entry => !isCoverageExcluded(entry.path));
        instrument({source: 'src', manifest, mappings: Object.fromEntries(project.roots.map(root => [root, `.runtime/${root}`]))});
        fs.writeFileSync('.runtime/template-manifest.json', JSON.stringify(manifest, null, 2));
        const baseline = {};
        for (const entry of javascriptScope.included) {
            const file = `src/${entry.path}`;
            const instrumenter = createInstrumenter({compact: false, preserveComments: true,
                coverageGlobalScope: 'window', coverageGlobalScopeFunc: false});
            const instrumented = instrumenter.instrumentSync(fs.readFileSync(file, 'utf8'), path.resolve(file));
            fs.writeFileSync(path.join('.runtime', path.relative('src', file)), instrumented);
            baseline[path.resolve(file)] = instrumenter.lastFileCoverage();
        }
        fs.writeFileSync('.runtime/js-baseline.json', JSON.stringify(baseline));
        fs.writeFileSync('.runtime/javascript-scope.json', JSON.stringify(javascriptScope, null, 2));
    }
    const after = runtimeHashes(discovered.roots);
    fs.writeFileSync(cachePath, JSON.stringify({signature, mountRoots: discovered.roots,
        outputs: Object.fromEntries(selectedBrowser.map(file => [file, after[file]]))}));
    console.log(reuse ? 'Reusing unchanged browser instrumentation.' : 'Prepared browser instrumentation.');
    if (runtimeOnly) return;

    fs.mkdirSync('coverage', {recursive: true});
    for (const name of fs.readdirSync('coverage')) fs.rmSync(`coverage/${name}`, {recursive: true, force: true});
    for (const directory of ['.nyc_output', 'cypress/screenshots', 'cypress/videos']) fs.rmSync(directory, {recursive: true, force: true});
    fs.mkdirSync('coverage/raw/templates', {recursive: true});
    const run = {id: randomBytes(16).toString('hex'), runner: process.env.MAGELENS_RUNNER || 'cypress', startedAt: new Date().toISOString(), roots: project.roots,
        sources: Object.fromEntries(Object.entries(inputs).filter(([file]) => scoped(file)))};
    fs.mkdirSync(`coverage/raw/php/${run.id}`, {recursive: true, mode: 0o777});
    fs.chmodSync(`coverage/raw/php/${run.id}`, 0o777);
    fs.writeFileSync('coverage/run.json', JSON.stringify(run, null, 2));
    fs.writeFileSync('coverage/javascript-scope.json', JSON.stringify({run: run.id, ...JSON.parse(fs.readFileSync('.runtime/javascript-scope.json'))}, null, 2));
    fs.copyFileSync('.runtime/template-manifest.json', 'coverage/template-manifest.json');
    setBadgeSection('Coverage has not completed for the current run.');
    console.log(`Prepared fresh coverage run ${run.id}.`);
    if (process.env.APPLICATION_DOMAIN) console.log(`Watch tests at https://${process.env.APPLICATION_DOMAIN}:${process.env.RUNNER_VIEW_PORT || process.env.CYPRESS_VIEW_PORT || 6080}/`);
}

if (require.main === module) {
    const themeOption = process.argv.indexOf('--theme-roots');
    prepare({plain: process.argv.includes('--plain'), runtimeOnly: process.argv.includes('--runtime-only'),
        themeRoots: themeOption < 0 ? undefined : JSON.parse(fs.readFileSync(process.argv[themeOption + 1], 'utf8'))});
}
module.exports = {sourceHashes, prepare};
