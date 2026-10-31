// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
for (const [name, version] of Object.entries(read('package.json').devDependencies)) {
    const expected = version.startsWith('file:') ? read('package-lock.json').packages[`node_modules/${name}`].version : version;
    assert.equal(read(`node_modules/${name}/package.json`).version, expected, `Installed version differs: ${name}`);
}
const run = read('coverage/run.json');
const tests = read(`coverage/${run.runner || 'cypress'}-results.json`);
const summary = read('coverage/summary.json');
assert.equal(tests.run, run.id);
assert.equal(summary.run, run.id);
assert.ok(tests.totalTests > 0);
assert.equal(tests.totalPassed, tests.totalTests);
for (const key of ['totalFailed', 'totalPending', 'totalSkipped']) assert.equal(tests[key], 0);
for (const file of ['coverage/index.html', ...['php', 'js', 'templates'].map(type => `coverage/${type}/index.html`)]) {
    assert.match(fs.readFileSync(file, 'utf8'), /<html/i, `Missing HTML report: ${file}`);
}
for (const file of ['coverage/.active-run', '.runtime/hooks-active', '.runtime/workflow.lock', 'src/var/blog-coverage-fixtures.json']) {
    assert.equal(fs.existsSync(file), false, `Run cleanup left ${file}`);
}
// Composer's source inventory predates test patches. Check that the run restored
// both the active session workaround and the retired Admin form target exactly.
const inventory = read('src/.magelens-source.json');
const vendor = inventory.platform === 'mageos' ? 'mage-os' : 'magento';
for (const file of [`vendor/${vendor}/framework/Session/SessionManager.php`, 'lib/web/mage/adminhtml/form.js']) {
    const fingerprint = 'file:' + createHash('sha256').update(fs.readFileSync(`src/${file}`)).digest('hex');
    assert.equal(fingerprint, inventory.files[file], `Patch cleanup changed ${file}`);
}
console.log(`Verified fresh reports for run ${run.id}, ${tests.totalPassed}/${tests.totalTests} tests, and complete cleanup.`);
