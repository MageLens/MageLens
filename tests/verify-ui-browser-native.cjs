// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {spawnSync} = require('node:child_process');
const pinnedChrome = /^CHROME_VERSION: "([^"]+)"$/m.exec(fs.readFileSync('dependencies.yaml', 'utf8'))[1];

function nativePlaywright() {
    const result = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test',
        '--config=tests/fixtures/ui-module/playwright-native.config.cjs'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']});
    if (result.error) throw result.error;
    if (result.status !== 0) {
        process.stderr.write(result.stdout);
        throw new Error(`Native Playwright UI proof exited with ${result.status ?? result.signal}`);
    }
    const {expected, unexpected, flaky, skipped} = JSON.parse(result.stdout).stats;
    assert.deepEqual({expected, unexpected, flaky, skipped}, {expected: 1, unexpected: 0, flaky: 0, skipped: 0});
}

async function nativeCypress() {
    require(projectFile('docker/runner/cypress-source/provenance.cjs')).verifyInstalled();
    const result = await require('cypress').run({
        browser: 'chrome-for-testing', headed: true,
        configFile: 'tests/fixtures/ui-module/cypress-native.config.cjs'
    });
    assert.equal(result.browserName, 'chrome-for-testing');
    assert.equal(result.browserVersion, pinnedChrome);
    assert.equal(result.totalTests, 1);
    assert.equal(result.totalPassed, 1);
    assert.equal(result.totalFailed, 0);
    assert.equal(result.totalSkipped, 0);
    assert.equal(result.totalPending, 0);
}

async function main() {
    assert.equal(fs.existsSync('coverage/.active-run'), false, 'Collection must be off for the native UI proof');
    const runner = process.argv[2];
    assert.ok(['playwright', 'cypress'].includes(runner));
    await (runner === 'playwright' ? nativePlaywright : nativeCypress)();
    console.log(`Native standalone UI listing, AJAX sort and form reset verified in ${runner} with Chrome for Testing ${pinnedChrome}.`);
}
main().catch(error => {console.error(error); process.exitCode = 1;});
