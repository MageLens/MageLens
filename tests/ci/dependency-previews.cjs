// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {syncDependencies} = require('../../bin/sync-dependencies.cjs');
const repositories = {templateCoverage: 'VitaliyBoyko/magento-template-coverage', pcov: 'VitaliyBoyko/pcov'};
const configurationFile = '.github/dependency-previews.json';
const evidenceFile = '.runtime/dependency-preview-evidence.json';
function configuration(root = process.cwd()) {
    const file = path.join(root, configurationFile);
    if (!fs.existsSync(file)) return {};
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(data.schema, 1, 'Unknown dependency preview schema');
    const entries = {};
    for (const [key, value] of Object.entries(data)) {
        if (key === 'schema') continue;
        assert.ok(Object.hasOwn(repositories, key), 'Unknown preview library');
        assert.deepEqual(Object.keys(value).sort(), ['pullRequest', 'repository', 'sha', 'version']);
        assert.equal(value.repository, repositories[key], 'Unexpected source repository');
        assert.match(value.sha, /^[a-f0-9]{40}$/, 'Pin a full source commit');
        assert.match(value.version, /^\d+\.\d+\.\d+$/, 'Pin a stable release version');
        assert.ok(Number.isSafeInteger(value.pullRequest) && value.pullRequest > 0, 'Missing source PR');
        entries[key] = value;
    }
    assert.ok(Object.keys(entries).length, 'Remove an empty preview configuration');
    return entries;
}
function verifyEvidence(expected, actual = {}) {
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), 'Missing or unexpected preview provenance');
    for (const [key, value] of Object.entries(expected)) {
        for (const field of ['repository', 'pullRequest', 'sha', 'version']) assert.equal(actual[key][field], value[field], `Wrong preview ${key} ${field}`);
        assert.match(actual[key].tree, /^[a-f0-9]{40}$/, 'Missing source tree');
        assert.match(actual[key].archiveSha256, /^[a-f0-9]{64}$/, 'Missing archive digest');
    }
    return actual;
}
function evidence(root = process.cwd()) {
    const expected = configuration(root);
    const file = path.join(root, evidenceFile);
    const actual = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    return verifyEvidence(expected, actual);
}
function prepare(root = process.cwd()) {
    const entries = configuration(root);
    if (!Object.keys(entries).length) return;
    assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Dependency previews run in GitHub Actions');
    assert.equal(process.env.GITHUB_EVENT_NAME, 'pull_request', 'Dependency previews are PR-only');
    const pins = Object.fromEntries([...fs.readFileSync(path.join(root, 'dependencies.yaml'), 'utf8').matchAll(/^(\w+): "([^"]+)"$/gm)].map(m => [m[1], m[2]]));
    const run = (command, args, cwd = root) => execFileSync(command, args, {cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
    const result = {};
    for (const [key, entry] of Object.entries(entries)) {
        assert.equal(entry.version, pins[key === 'pcov' ? 'PCOV_VERSION' : 'TEMPLATE_COVERAGE_VERSION'], 'Preview must match dependencies.yaml');
        const source = path.join(root, '.runtime', 'dependency-preview-sources', key);
        fs.rmSync(source, {recursive: true, force: true});
        fs.mkdirSync(source, {recursive: true});
        run('git', ['init', '--quiet'], source);
        run('git', ['fetch', '--depth=1', `https://github.com/${entry.repository}.git`, entry.sha], source);
        run('git', ['checkout', '--detach', 'FETCH_HEAD'], source);
        assert.equal(run('git', ['rev-parse', 'HEAD'], source).trim(), entry.sha);
        const tree = run('git', ['rev-parse', 'HEAD^{tree}'], source).trim();
        let archive;
        if (key === 'templateCoverage') {
            const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
            assert.equal(manifest.name, '@vitaliiboiko/magento-template-coverage');
            assert.equal(manifest.version, entry.version);
            const [packed] = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json'], source));
            assert.equal(path.basename(packed.filename), packed.filename);
            archive = path.join(source, packed.filename);
            fs.copyFileSync(archive, path.join(root, '.runtime/template-coverage.tgz'));
            syncDependencies(root, {...process.env, ...pins, MAGELENS_RUNNER: process.env.MAGELENS_E2E_RUNNER || 'cypress', TEMPLATE_COVERAGE_PACKAGE: '.runtime/template-coverage.tgz'});
        } else {
            const header = fs.readFileSync(path.join(source, 'php_pcov.h'), 'utf8');
            assert.equal(header.match(/^#define PHP_PCOV_VERSION "([^"]+)"/m)?.[1], entry.version);
            archive = path.join(source, 'source.tar');
            run('git', ['archive', '--format=tar', '--output=source.tar', entry.sha], source);
            const target = path.join(root, 'docker/php/dependency-preview-pcov');
            fs.mkdirSync(target, {recursive: true});
            run('tar', ['-xf', archive, '-C', target]);
            const file = path.join(root, 'docker/php/Dockerfile');
            let recipe = fs.readFileSync(file, 'utf8');
            const start = recipe.indexOf('# Current supported installation mechanism');
            const end = recipe.indexOf('# Magento is installed', start);
            assert.ok(start >= 0 && end > start, 'PCOV preview recipe no longer matches');
            recipe = recipe.slice(0, start) +
                'COPY docker/php/dependency-preview-pcov /tmp/pcov-preview\n' +
                'RUN apt-get update && apt-get install -y --no-install-recommends $PHPIZE_DEPS \\\n' +
                '    && cd /tmp/pcov-preview && phpize && ./configure --enable-pcov \\\n' +
                '    && make -j2 && make install && docker-php-ext-enable pcov \\\n' +
                '    && php -r \'if (phpversion("pcov") !== getenv("PCOV_VERSION") || !function_exists("pcov\\\\export") || extension_loaded("xdebug")) exit(1);\'\n' +
                'RUN mkdir /opt/pcov-tools && cp -a /tmp/pcov-preview/tools/. /opt/pcov-tools/ && rm -rf /tmp/pcov-preview\n' + recipe.slice(end);
            fs.writeFileSync(file, recipe);
        }
        result[key] = {...entry, tree, archiveSha256: createHash('sha256').update(fs.readFileSync(archive)).digest('hex')};
    }
    verifyEvidence(entries, result);
    fs.writeFileSync(path.join(root, evidenceFile), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({dependencyPreviews: result}, null, 2));
}
module.exports = {configuration, verifyEvidence, evidence};
if (require.main === module) prepare();
