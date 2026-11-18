// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createInterface} = require('node:readline');
const {discover, files} = require('./project.cjs');
const {setTransport, tests} = require('../cli/support.cjs');

function cliSpecs() {
    const {modules, roots} = discover();
    const specRoots = [...modules.map(module => module.root), ...roots.filter(root => root.startsWith('vendor/'))];
    return ['cli/e2e', ...specRoots.map(root => `src/${root}/Test/Cli`)]
        .filter(directory => fs.existsSync(directory))
        .flatMap(directory => files(directory).filter(file => file.endsWith('.test.cjs')));
}

async function runCli(send) {
    const {id: run} = JSON.parse(fs.readFileSync('coverage/run.json', 'utf8'));
    const specs = cliSpecs();
    const results = {run, totalTests: 0, totalPassed: 0, totalFailed: 0, totalSkipped: 0, totalPending: 0, tests: [], commands: 0};
    if (specs.length) {
        const input = createInterface({input: process.stdin, terminal: false});
        const responses = input[Symbol.asyncIterator]();
        // Serialize commands so each response goes to the test that requested it.
        let pending = Promise.resolve();
        let transportError;
        setTransport(request => {
            const response = pending.then(async () => {
                if (transportError) throw transportError;
                send(JSON.stringify({run, ...request}) + '\n');
                const {value, done} = await responses.next();
                assert.ok(!done, 'The PHP command relay disconnected');
                const result = JSON.parse(value);
                assert.ok(Number.isInteger(result.code), 'Invalid PHP command response');
                results.commands++;
                return result;
            });
            pending = response.catch(error => { transportError = error; });
            return response;
        });
        try {
            for (const file of specs) {
                const before = tests.length;
                require(path.resolve(file));
                assert.ok(tests.length > before, `CLI spec registered no tests: ${file}`);
            }
            results.totalTests = tests.length;
            for (const {title, runTest} of tests) {
                try {
                    await runTest();
                    results.totalPassed++;
                    results.tests.push({title, status: 'passed'});
                    console.error(`  PASS ${title}`);
                } catch (error) {
                    results.totalFailed++;
                    results.tests.push({title, status: 'failed'});
                    console.error(`  FAIL ${title}\n${error?.stack || error}`);
                }
            }
            await pending;
            if (transportError) throw transportError;
        } finally {
            input.close();
            // An empty line closes the relay input, including on a failed suite.
            send('\n');
            setTransport(undefined);
            fs.writeFileSync('coverage/cli-results.json', JSON.stringify(results, null, 2) + '\n');
        }
        assert.equal(results.totalPassed, results.totalTests, 'CLI suite did not complete successfully');
        assert.ok(results.commands > 0, 'CLI suite did not execute a CLI command');
    } else {
        fs.writeFileSync('coverage/cli-results.json', JSON.stringify(results, null, 2) + '\n');
    }
}

if (require.main === module) {
    // Keep stdout for the relay; spec and test diagnostics go to the terminal.
    const send = process.stdout.write.bind(process.stdout);
    process.stdout.write = process.stderr.write.bind(process.stderr);
    runCli(send).catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}
