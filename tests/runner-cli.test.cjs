// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

for (const runner of ['cypress', 'playwright']) {
    test(`${runner}: runner helper uses Docker, preserves arguments and returns command failures`, t => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-runner-cli-'));
        t.after(() => fs.rmSync(root, {recursive: true, force: true}));
        fs.mkdirSync(path.join(root, 'bin'));
        fs.mkdirSync(path.join(root, '.runtime'));
        for (const file of ['bin/runner', 'bin/expose-tools', 'bin/application-compose', 'bin/common', 'bin/compose-project', 'bin/dependencies', 'dependencies.yaml']) {
            fs.copyFileSync(path.resolve(__dirname, '..', file), path.join(root, file));
        }
        for (const directory of ['bin', 'lib', 'env']) fs.mkdirSync(path.join(root, '.runtime/docker-magento/compose', directory), {recursive: true});
        fs.writeFileSync(path.join(root, '.runtime/docker-magento/compose/bin/status'), '#!/bin/sh\n');
        fs.writeFileSync(path.join(root, '.runtime/docker-magento/compose/env/local.env'), 'TEST=1\n');
        const exposed = spawnSync('bash', ['bin/expose-tools'], {cwd: root, encoding: 'utf8'});
        assert.equal(exposed.status, 0, exposed.stderr);
        fs.writeFileSync(path.join(root, '.runtime/install-profile'), `luma ${runner}\n`);
        fs.writeFileSync(path.join(root, 'bin/docker'), `#!${process.execPath}
const args = process.argv.slice(2);
if (args.includes('--images')) console.log('fixture/php');
else {
    console.log(JSON.stringify({args, cwd: process.cwd(), runner: process.env.MAGELENS_RUNNER}));
    process.exitCode = Number(process.env.TEST_EXIT || 0);
}
`, {mode: 0o755});
        const invoke = (args, exit = 0) => spawnSync('bash', [path.join(root, 'bin/runner'), ...args], {
            cwd: os.tmpdir(), encoding: 'utf8',
            env: {...process.env, PATH: `${root}/bin:${process.env.PATH}`, TEST_EXIT: String(exit)}
        });
        for (const args of [['node', '-e', 'console.log("argument with spaces")'], ['npm', '--version'], ['bash']]) {
            const result = invoke(args);
            assert.equal(result.status, 0, result.stderr);
            const call = JSON.parse(result.stdout);
            assert.equal(call.cwd, root);
            assert.equal(call.runner, runner);
            assert.deepEqual(call.args.slice(-args.length - 3), ['exec', '-T', 'runner', ...args]);
        }
        assert.equal(invoke(['node', '-e', 'process.exit(23)'], 23).status, 23);
        for (const args of [[], ['--help']]) {
            const result = invoke(args);
            assert.equal(result.status, 0);
            assert.match(result.stdout, /Usage: .\/bin\/runner/);
            assert.doesNotMatch(result.stdout, /"args":/);
        }
    });
}
