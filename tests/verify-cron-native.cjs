// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {spawnSync} = require('node:child_process');
const {tests, setTransport} = require('../cli/support.cjs');

async function main() {
    assert.ok(!fs.existsSync('coverage/.active-run'), 'Stop coverage collection before the native cron proof');
    setTransport(({tool, args, timeout}) => {
        const result = spawnSync('./bin/application-compose', [
            'exec', '-T', 'phpfpm', 'timeout', '--kill-after=5s', (timeout / 1000) + 's',
            'php', tool === 'magerun' ? 'bin/n98-magerun2.phar' : 'bin/magento',
            '--no-ansi', '--no-interaction', ...args,
        ], {encoding: 'utf8', timeout: timeout + 10000});
        if (result.error) throw result.error;
        return {code: result.status, stdout: result.stdout, stderr: result.stderr};
    });
    require('../src/app/code/MageLens/Compatibility/Test/Cli/compatibility.test.cjs');
    const scenarios = tests.filter(entry => entry.title.includes('cron job'));
    assert.equal(scenarios.length, 2);
    for (const scenario of scenarios) {
        await scenario.runTest();
        console.log('PASS native ' + scenario.title);
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
