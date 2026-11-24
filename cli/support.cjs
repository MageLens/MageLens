// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');

// The suite installs this transport before loading specs.
let transport;
const tests = [];

function test(title, runTest) {
    assert.ok(transport, 'Run CLI specs with ./bin/run-coverage');
    assert.ok(typeof title === 'string' && title.trim() && typeof runTest === 'function', 'Pass a title and a test function');
    tests.push({title, runTest});
}

function setTransport(execute) {
    transport = execute;
}

async function execute(tool, args, {timeout = 60000, expectedExitCode = 0} = {}) {
    assert.ok(transport, 'Run CLI specs with ./bin/run-coverage');
    assert.ok(Array.isArray(args) && args.length && args.every(arg => typeof arg === 'string' && !arg.includes('\0')),
        'Pass CLI arguments as an array of strings');
    assert.ok(Number.isInteger(timeout) && timeout >= 1 && timeout <= 300000, 'Timeout must be 1–300000 ms');
    assert.ok(Number.isInteger(expectedExitCode) && expectedExitCode >= 0 && expectedExitCode <= 123, 'Invalid expected exit code');
    const result = await transport({tool, args, timeout});
    assert.equal(result.code, expectedExitCode,
        `${tool} exited with status ${result.code}; expected ${expectedExitCode}\n${result.stderr || result.stdout}`);
    return result;
}

const magento = (args, options) => execute('magento', args, options);
const magerun = (args, options) => execute('magerun', args, options);

module.exports = {test, magento, magerun, setTransport, tests};
