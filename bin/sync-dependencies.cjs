// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');

// Run in the selected base image before building the browser runner image.
// Resolve in a temporary directory: a registry failure must not corrupt the
// project's current manifests or replace its installed node_modules.
function syncDependencies(root, env = process.env, execute = execFileSync) {
    const runner = env.MAGELENS_RUNNER || 'cypress';
    if (!['cypress', 'playwright'].includes(runner)) throw new Error(`Unknown browser runner: ${runner}`);
    const excluded = runner === 'cypress' ? ['@playwright/test', 'playwright', 'playwright-core'] : ['cypress', '@cypress/code-coverage'];
    const requested = {
        ...(runner === 'cypress' ? {cypress: env.CYPRESS_VERSION, '@cypress/code-coverage': env.CYPRESS_CODE_COVERAGE_VERSION}
            : {'@playwright/test': env.PLAYWRIGHT_VERSION}),
        '@vitaliiboiko/magento-template-coverage': env.TEMPLATE_COVERAGE_VERSION,
        'istanbul-lib-coverage': env.ISTANBUL_LIB_COVERAGE_VERSION,
        'istanbul-lib-instrument': env.ISTANBUL_LIB_INSTRUMENT_VERSION,
        'istanbul-lib-report': env.ISTANBUL_LIB_REPORT_VERSION,
        'istanbul-reports': env.ISTANBUL_REPORTS_VERSION,
        nyc: env.NYC_VERSION
    };
    for (const [name, version] of Object.entries(requested)) {
        if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?$/.test(version || '')) {
            throw new Error(`Missing or invalid configured version for ${name}`);
        }
    }
    const localPackage = env.TEMPLATE_COVERAGE_PACKAGE;
    if (localPackage && localPackage !== '.runtime/template-coverage.tgz') throw new Error('Unexpected local template package path');
    const library = '@vitaliiboiko/magento-template-coverage';
    const integrity = localPackage ? 'sha512-' + createHash('sha512').update(fs.readFileSync(path.join(root, localPackage))).digest('base64') : null;
    if (localPackage) requested[library] = `file:${localPackage}`;
    const manifestPath = path.join(root, 'package.json');
    const lockPath = path.join(root, 'package-lock.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const lock = fs.existsSync(lockPath) ? JSON.parse(fs.readFileSync(lockPath, 'utf8')) : null;
    const matches = excluded.every(name => !manifest.devDependencies?.[name] && !manifest.dependencies?.[name] && !lock?.packages?.[`node_modules/${name}`]) && Object.entries(requested).every(([name, version]) =>
        manifest.devDependencies?.[name] === version &&
        lock?.packages?.['']?.devDependencies?.[name] === version &&
        (localPackage && name === library ? lock?.packages?.[`node_modules/${name}`]?.integrity === integrity
            : lock?.packages?.[`node_modules/${name}`]?.version === version));
    if (matches) return false;

    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-dependencies-'));
    try {
        manifest.devDependencies = {...manifest.devDependencies, ...requested};
        for (const name of excluded) {
            delete manifest.devDependencies[name];
            if (manifest.dependencies?.[name]) throw new Error(`Remove conflicting runtime dependency ${name} before selecting ${runner}`);
        }
        if (localPackage) {
            fs.mkdirSync(path.join(temporary, '.runtime'));
            fs.copyFileSync(path.join(root, localPackage), path.join(temporary, localPackage));
        }
        fs.writeFileSync(path.join(temporary, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
        if (lock) fs.copyFileSync(lockPath, path.join(temporary, 'package-lock.json'));
        execute('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
            {cwd: temporary, stdio: 'inherit'});
        const resolved = JSON.parse(fs.readFileSync(path.join(temporary, 'package-lock.json'), 'utf8'));
        for (const [name, version] of Object.entries(requested)) {
            const matchesVersion = localPackage && name === library
                ? resolved.packages?.[`node_modules/${name}`]?.integrity === integrity
                : resolved.packages?.[`node_modules/${name}`]?.version === version;
            if (!matchesVersion ||
                resolved.packages?.['']?.devDependencies?.[name] !== version) {
                throw new Error(`npm did not resolve the configured ${name} ${version}`);
            }
        }
        for (const name of excluded) if (resolved.packages?.[`node_modules/${name}`]) {
            throw new Error(`Another dependency still installs ${name}; ${runner} must be installed separately.`);
        }
        for (const file of ['package.json', 'package-lock.json']) {
            const target = path.join(root, file);
            fs.copyFileSync(path.join(temporary, file), `${target}.magelens-tmp`);
            fs.renameSync(`${target}.magelens-tmp`, target);
        }
        return true;
    } finally {
        fs.rmSync(temporary, {recursive: true, force: true});
    }
}

if (require.main === module) {
    console.log(syncDependencies(process.cwd())
        ? 'Updated package.json and package-lock.json from dependencies.yaml.'
        : 'Browser dependency locks already match dependencies.yaml.');
}
module.exports = {syncDependencies};
