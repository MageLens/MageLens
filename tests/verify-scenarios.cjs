const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const directory = process.argv[2] || 'coverage';
const runner = fs.existsSync(path.join(directory, 'playwright-results.json')) ? 'playwright' : 'cypress';
const results = JSON.parse(fs.readFileSync(path.join(directory, `${runner}-results.json`)));
const expected = [
    'creates a category and illustrated article, publishes, moderates comments, and deletes records',
    'validates Admin input, preserves form values, and rejects forged writes',
    'requires Admin authentication and the Blog ACL permission',
    'searches, filters, paginates, reads articles, and retains favorites',
    'rejects invalid filters and keeps draft, scheduled, and inactive-category posts private',
    'collects real PHP, JavaScript and template execution',
    'starts the next test with fresh state'
].sort();
assert.equal(results.totalTests, expected.length, 'Every installation must run all five Blog scenarios and both coverage probes');
assert.equal(results.totalPassed, expected.length);
assert.equal(results.totalFailed, 0);
assert.equal(results.totalSkipped, 0);
assert.equal(results.totalPending, 0);
assert.deepEqual(results.tests.map(test => test.title).sort(), expected, 'All eight modes must exercise the same scenarios');
assert.ok(results.tests.every(test => test.status === 'passed'));
console.log(`Verified all ${expected.length} shared acceptance scenarios (${runner}).`);
