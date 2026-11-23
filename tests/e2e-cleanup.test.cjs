// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.join(__dirname, '..');

// The fixture holds too little to populate the isolated workspace, so the harness
// fails right after creating it and runs its cleanup against a fake Docker. The fake
// lists this run's images next to those of other runs and shared images; it reads
// the run's project name from the resource file the harness writes.
function run(t, env = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-e2e-cleanup-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    for (const file of ['tests/e2e-isolated.sh', 'tests/e2e-xml-proofs.sh', 'bin/common', 'bin/dependencies', 'dependencies.yaml']) {
        fs.mkdirSync(path.join(directory, path.dirname(file)), {recursive: true});
        fs.copyFileSync(path.join(root, file), path.join(directory, file));
    }
    const fakeBin = path.join(directory, 'fake-bin');
    const scratch = path.join(directory, 'scratch');
    fs.mkdirSync(fakeBin);
    fs.mkdirSync(scratch);
    fs.writeFileSync(path.join(fakeBin, 'docker'), `#!/usr/bin/env bash
case "$1 $2" in
    'info '*) ;;
    'compose version') echo 2.30.0 ;;
    'volume inspect') exit 1 ;;
    'image ls')
        read -r project _ < "$MAGELENS_E2E_RESOURCE_FILE"
        pattern=\${4#reference=}
        for image in "$project-php:e2e" "$project-runner:latest" "\${project}x-runner:latest" \\
            magelens-e2e-other-php:e2e magelens-php-base:8.4-markshust48 mysql:8.4; do
            [[ "\${image%%:*}" != $pattern ]] || printf '%s\\n' "$image"
        done ;;
    'image rm') [[ -z "$FAKE_DOCKER_RM_FAILS" ]] || exit 1; shift 2; printf '%s\\n' "$@" >> "$FAKE_DOCKER_REMOVED" ;;
    *) exit 1 ;;
esac
`, {mode: 0o755});
    const resources = path.join(directory, 'resources');
    const removed = path.join(directory, 'removed');
    const result = spawnSync('bash', ['tests/e2e-isolated.sh'], {cwd: directory, encoding: 'utf8', env: {
        ...process.env, ...env, PATH: `${fakeBin}:${process.env.PATH}`, MAGELENS_E2E_PLATFORM: 'mageos',
        MAGELENS_TEST_TMPDIR: scratch, MAGELENS_E2E_RESOURCE_FILE: resources, FAKE_DOCKER_REMOVED: removed
    }});
    assert.notEqual(result.status, 0, 'the incomplete fixture must fail before installation');
    assert.match(result.stderr, /cp: .*docker.*No such file or directory/, 'the fixture must fail while populating the workspace');
    const [project, workspace] = fs.readFileSync(resources, 'utf8').trim().split(' ');
    assert.match(project, /^magelens-e2e-[a-z0-9]+$/);
    return {result, project, workspace, removed: fs.existsSync(removed) ? fs.readFileSync(removed, 'utf8').trim().split('\n') : []};
}

test('isolated E2E cleanup removes the images of its own run only', t => {
    const {project, workspace, removed} = run(t);
    assert.deepEqual(removed.sort(), [`${project}-php:e2e`, `${project}-runner:latest`]);
    assert.equal(fs.existsSync(workspace), false);
});

test('a failed image removal does not stop the rest of the cleanup', t => {
    const {result, workspace, removed} = run(t, {FAKE_DOCKER_RM_FAILS: '1'});
    assert.deepEqual(removed, []);
    assert.equal(fs.existsSync(workspace), false);
    assert.match(result.stdout, /E2E artifacts:/);
});

test('a retained failed E2E workspace keeps its images and names their cleanup', t => {
    const {result, project, workspace, removed} = run(t, {MAGELENS_E2E_KEEP_ON_FAILURE: '1'});
    assert.deepEqual(removed, []);
    assert.ok(fs.existsSync(workspace));
    assert.ok(result.stderr.includes(`docker image ls --filter reference=${project}-\\*`), result.stderr);
});
