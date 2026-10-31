// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {syncDependencies} = require('../bin/sync-dependencies.cjs');
const versions = {CYPRESS_VERSION: '16.2.0', PLAYWRIGHT_VERSION: '1.64.1',
    ISTANBUL_LIB_REPORT_VERSION: '3.0.1', ISTANBUL_REPORTS_VERSION: '3.2.0',
    TEMPLATE_COVERAGE_VERSION: '1.1.2', CYPRESS_CODE_COVERAGE_VERSION: '4.0.3',
    ISTANBUL_LIB_COVERAGE_VERSION: '3.2.2', ISTANBUL_LIB_INSTRUMENT_VERSION: '6.0.3', NYC_VERSION: '18.0.0'};

test('switching installers selects one runner and prunes the old runner from manifests and lock', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-profile-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({name: 'profile-fixture', devDependencies: {unrelated: '1.0.0'}}));
    let resolutions = 0;
    const resolve = (_command, _args, {cwd}) => {
        resolutions++;
        const manifest = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json')));
        fs.writeFileSync(path.join(cwd, 'package-lock.json'), JSON.stringify({lockfileVersion: 3, packages: {
            '': {devDependencies: manifest.devDependencies},
            ...Object.fromEntries(Object.entries(manifest.devDependencies).map(([name, version]) => [`node_modules/${name}`, {version}]))
        }}));
    };
    for (const runner of ['cypress', 'playwright', 'cypress']) {
        syncDependencies(root, {...versions, MAGELENS_RUNNER: runner}, resolve);
        const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
        const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json')));
        for (const name of ['cypress', '@cypress/code-coverage', '@playwright/test']) {
            const expected = runner === 'playwright' ? name === '@playwright/test' : name !== '@playwright/test';
            assert.equal(name in manifest.devDependencies, expected, `${runner}: ${name}`);
            assert.equal(`node_modules/${name}` in lock.packages, expected, `${runner} lock: ${name}`);
        }
        assert.equal(manifest.devDependencies.unrelated, '1.0.0');
        assert.equal(syncDependencies(root, {...versions, MAGELENS_RUNNER: runner}, resolve), false);
    }
    assert.equal(resolutions, 3);
});

test('unknown runners are rejected before modifying the installation', () => {
    assert.throws(() => syncDependencies('/does-not-exist', {...versions, MAGELENS_RUNNER: 'both'}), /runner/i);
});

function profileWorkspace(t, profile) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-platform-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    for (const file of ['bin/common', 'bin/dependencies', 'bin/install', 'bin/run-coverage', 'bin/application-compose', 'install.sh', 'dependencies.yaml']) {
        fs.mkdirSync(path.dirname(path.join(directory, file)), {recursive: true});
        fs.copyFileSync(path.resolve(__dirname, '..', file), path.join(directory, file));
    }
    fs.mkdirSync(path.join(directory, '.runtime'));
    fs.writeFileSync(path.join(directory, '.runtime/install-profile'), profile + '\n');
    return directory;
}

function rejectWithoutChanges(t, profile, command) {
    const directory = profileWorkspace(t, profile);
    const preserved = {
        '.runtime/install-profile': profile + '\n',
        '.runtime/installed': '3\n',
        '.runtime/compose-project-name': 'existing-shop\n',
        '.env': 'COMPOSE_PROJECT_NAME=existing-shop\nAPPLICATION_DOMAIN=existing.test\n',
        'src/.application-source-ready': '',
        'src/app/etc/env.php': '<?php return [];\n',
        'src/composer.json': '{"require":{}}\n'
    };
    for (const [file, contents] of Object.entries(preserved)) {
        fs.mkdirSync(path.dirname(path.join(directory, file)), {recursive: true});
        fs.writeFileSync(path.join(directory, file), contents);
    }
    fs.mkdirSync(path.join(directory, 'commands'));
    fs.writeFileSync(path.join(directory, 'commands/docker'), '#!/bin/sh\ntouch docker-invoked\nexit 99\n', {mode: 0o755});
    const result = spawnSync('bash', command, {cwd: directory, encoding: 'utf8',
        env: {...process.env, PATH: `${directory}/commands:${process.env.PATH}`}});
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Legacy non-CSP Hyva.*no longer supported/);
    assert.match(result.stderr, /separate checkout using --hyva, the same platform flag/);
    assert.match(result.stderr, /Keep the existing profile, Docker project and data unchanged/);
    for (const [file, contents] of Object.entries(preserved)) {
        assert.equal(fs.readFileSync(path.join(directory, file), 'utf8'), contents, file);
    }
    assert.equal(fs.existsSync(path.join(directory, 'docker-invoked')), false);
    assert.equal(fs.existsSync(path.join(directory, '.runtime/workflow.lock')), false);
}

for (const flag of ['--nocsp', '-nocsp']) {
    for (const args of [[flag], ['--hyva', flag], [flag, '--hyva', '--playwright']]) {
        test(`removed flags ${args.join(' ')} fail without changing an existing installation`, t => {
            rejectWithoutChanges(t, 'luma cypress magento', ['install.sh', ...args]);
        });
    }
}

for (const platform of ['', ' magento', ' mageos']) {
    for (const runner of ['cypress', 'playwright']) {
        test(`legacy ${runner}${platform} profile rejects installer and runtime commands without changes`, t => {
            for (const command of [
                ['install.sh'], ['install.sh', '--hyva', '--mageos'],
                ['bin/run-coverage'], ['bin/application-compose', 'up', '-d']
            ]) rejectWithoutChanges(t, `hyva-legacy ${runner}${platform}`, command);
        });
    }
}

for (const [profile, platform, versionKey] of [
    ['hyva playwright', 'magento', 'MAGENTO_VERSION'],
    ['luma cypress magento', 'magento', 'MAGENTO_VERSION'],
    ['hyva playwright mageos', 'mageos', 'MAGEOS_VERSION']
]) {
    test(`saved profile ${profile} selects the platform for subsequent commands`, t => {
        const directory = profileWorkspace(t, profile);
        const result = spawnSync('bash', ['-c', 'source "$1/bin/common"; printf "%s %s %s\\n" "$MAGELENS_THEME" "$MAGELENS_RUNNER" "$MAGELENS_PLATFORM:$MAGELENS_PLATFORM_VERSION"', 'test', directory],
            {encoding: 'utf8', env: {...process.env, MAGELENS_PLATFORM: 'invalid', MAGELENS_PLATFORM_VERSION: 'stale'}});
        assert.equal(result.status, 0, result.stderr);
        const version = fs.readFileSync(path.join(directory, 'dependencies.yaml'), 'utf8').match(new RegExp(`^${versionKey}: "([^"]+)"`, 'm'))[1];
        assert.equal(result.stdout.trim(), `${profile.split(' ').slice(0, 2).join(' ')} ${platform}:${version}`);
    });
}

for (const profile of ['luma cypress unknown', 'luma cypress mageos extra']) {
    test(`invalid profile ${profile} fails before invoking Docker`, t => {
        const directory = profileWorkspace(t, profile);
        const result = spawnSync('bash', [path.join(directory, 'bin/common')], {encoding: 'utf8'});
        assert.equal(result.status, 1);
        assert.match(result.stderr, /Invalid .runtime\/install-profile/);
    });
}

for (const platform of ['magento', 'mageos']) {
    test(`reinstall cannot switch an existing ${platform} application to the other platform`, t => {
        const directory = profileWorkspace(t, `luma cypress ${platform}`);
        fs.mkdirSync(path.join(directory, 'src'));
        fs.writeFileSync(path.join(directory, 'src/.application-source-ready'), '');
        fs.writeFileSync(path.join(directory, '.runtime/installed'), '3\n');
        fs.mkdirSync(path.join(directory, 'commands'));
        fs.writeFileSync(path.join(directory, 'commands/docker'), '#!/bin/sh\nif [ "$*" = "compose version --short" ]; then echo 2.24.4; fi\n', {mode: 0o755});
        const result = spawnSync('bash', ['bin/install', ...(platform === 'magento' ? ['--mageos'] : [])],
            {cwd: directory, encoding: 'utf8', env: {...process.env, PATH: `${directory}/commands:${process.env.PATH}`}});
        assert.equal(result.status, 1);
        assert.match(result.stderr, /changing platforms in place is not supported/);
        assert.equal(fs.readFileSync(path.join(directory, '.runtime/install-profile'), 'utf8'), `luma cypress ${platform}\n`);
        assert.equal(fs.readFileSync(path.join(directory, '.runtime/installed'), 'utf8'), '3\n');
        assert.equal(fs.existsSync(path.join(directory, '.runtime/workflow.lock')), false);
    });
}
