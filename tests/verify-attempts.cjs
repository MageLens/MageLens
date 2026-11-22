// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Checks the test attempt records of a passing E2E run and the attempt IDs in its PHP records.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => JSON.parse(fs.readFileSync(path.join('coverage', file), 'utf8'));
const {id: run, runner} = read('run.json');
const browser = read(`${runner}-results.json`);
const cli = read('cli-results.json');
const attempts = new Map(fs.readdirSync('coverage/raw/attempts').map(file => {
    const attempt = read(`raw/attempts/${file}`);
    assert.equal(file, `${attempt.id}.json`);
    return [attempt.id, attempt];
}));
for (const attempt of attempts.values()) {
    assert.equal(attempt.run, run, 'Attempt from another run');
    assert.equal(attempt.outcome, 'passed', `Unfinished or failed attempt in a passing run: ${attempt.test.join(' › ')}`);
    assert.ok(Date.parse(attempt.finishedAt) >= Date.parse(attempt.startedAt));
}
const byRunner = name => [...attempts.values()].filter(attempt => attempt.runner === name);
// The suites run without retries, so every test has exactly one attempt.
assert.equal(byRunner(runner).length, browser.totalTests);
assert.equal(byRunner('cli').length, cli.totalTests);
assert.equal(new Set(byRunner(runner).map(attempt => JSON.stringify([attempt.spec, attempt.test]))).size, browser.totalTests);

const requests = fs.readdirSync(`coverage/raw/php/${run}`).filter(file => file.endsWith('.json'))
    .map(file => read(`raw/php/${run}/${file}`));
const used = new Map([...attempts.keys()].map(id => [id, 0]));
let unattributed = 0;
for (const request of requests) {
    assert.ok(!Number.isNaN(Date.parse(request.startedAt)), 'PHP record without its start time');
    if (request.attempt === null) {
        assert.equal(request.commandId, undefined, 'A CLI command must belong to its CLI test');
        unattributed++;
        continue;
    }
    const attempt = attempts.get(request.attempt);
    assert.ok(attempt, 'PHP record refers to an unknown attempt');
    assert.equal(attempt.runner, request.commandId ? 'cli' : runner, 'PHP record attributed to the wrong suite');
    used.set(request.attempt, used.get(request.attempt) + 1);
}
for (const [id, count] of used) assert.ok(count > 0, `No PHP execution attributed to ${attempts.get(id).test.join(' › ')}`);

// Every test runs in an attributed browser context, so the attempts' JavaScript counters add up to the aggregate.
const {mergeCounters} = require('../bin/javascript-attempts.cjs');
const {isCoverageExcluded} = require('../bin/project.cjs');
const javascript = {};
for (const file of fs.readdirSync('coverage/raw/javascript-attempts')) {
    assert.ok(attempts.get(path.basename(file, '.json'))?.runner === runner, 'JavaScript counters of an unknown attempt');
    mergeCounters(javascript, read(`raw/javascript-attempts/${file}`));
}
const aggregate = JSON.parse(fs.readFileSync('.nyc_output/out.json', 'utf8'));
let statements = 0;
for (const [file, {s, f, b}] of Object.entries(aggregate)) {
    const attributed = javascript[file] || {};
    for (const [id, hits] of Object.entries(s)) assert.equal(attributed.s?.[id] || 0, hits, `Statement ${id} of ${file}`);
    for (const [id, hits] of Object.entries(f)) assert.equal(attributed.f?.[id] || 0, hits, `Function ${id} of ${file}`);
    for (const [id, hits] of Object.entries(b)) assert.deepEqual(attributed.b?.[id] || hits.map(() => 0), hits, `Branch ${id} of ${file}`);
    statements += Object.values(s).filter(hits => hits > 0).length;
}
// The reverse direction: attempts hold no counters that the aggregate lacks, except for excluded files.
for (const [file, hit] of Object.entries(javascript).filter(([file]) => !isCoverageExcluded(file))) {
    assert.ok(aggregate[file], `Attributed JavaScript outside the aggregate: ${file}`);
    for (const type of ['s', 'f', 'b']) {
        for (const id of Object.keys(hit[type] || {})) assert.ok(id in aggregate[file][type], `Attributed ${type} ${id} missing from ${file}`);
    }
}
assert.ok(statements > 0, 'No JavaScript statements were attributed');

// coverage/attribution/ is checked against the aggregate reports when it is written; here every attempt must own work.
const attribution = read('attribution/index.json');
assert.equal(attribution.run, run);
assert.deepEqual(attribution.attempts.map(attempt => attempt.id).sort(), [...attempts.keys()].sort());
for (const name of ['php', 'javascript', 'templates', 'xml']) assert.ok(attribution.collectors[name].attributedUnits > 0, `No attributed ${name} units`);
const owners = new Set(Object.values(read('attribution/php.json').files).flatMap(byLine => Object.values(byLine).flatMap(Object.keys)));
attribution.attempts.forEach((attempt, index) => assert.ok(owners.has(String(index)), `No attributed PHP line for ${attempt.test.join(' › ')}`));
assert.equal(attribution.collectors.templates.ambiguousRecords, 0);

// Exact associations: fixture code that only one test can reach belongs to that test's attempt alone.
const php = read('attribution/php.json').files;
const fixture = 'app/code/MageLens/Compatibility';
for (const [file, fragment, title] of [
    ['Controller/Index/Markup.php', "$second = $this->request->getParam('case')", 'starts the next test with fresh state'],
    ['Controller/Index/Late.php', 'usleep(5000000)', 'collects real PHP, JavaScript and template execution'],
    ['Cli/Jobs.php', "getValue('magelens_probe/cron/enabled')", 'executes a scheduled Magento cron job'],
    ['Cli/Jobs.php', "getValue('magelens_probe/cron/magerun_message')", 'preserves command arguments and runs a named cron job through MageRun'],
    ['Cli/Jobs.php', 'file_put_contents(self::marker($token), $token)', 'processes a message through a Magento database queue']
]) {
    const line = fs.readFileSync(`src/${fixture}/${file}`, 'utf8').split('\n').findIndex(text => text.includes(fragment)) + 1;
    assert.ok(line > 0, `Missing fixture line: ${fragment}`);
    const owners = Object.keys(php[`${fixture}/${file}`]?.[line] || {}).map(owner => attribution.attempts[owner]?.test.at(-1) ?? owner);
    assert.deepEqual(owners, [title], `${file}:${line} must belong to "${title}" only`);
}
// Cypress clears the attempt cookie when a test finishes, so an after() hook is unattributed.
if (runner === 'cypress') {
    const cleanup = requests.filter(request => request.uri?.includes('shared-cleanup=1'));
    assert.equal(cleanup.length, 1, 'Missing the shared cleanup request');
    assert.equal(cleanup[0].attempt, null, 'Shared cleanup inherited the attempt of the previous test');
}
// The late request ran across the test boundary: the next attempt started before it could have finished.
const late = requests.filter(request => request.uri?.startsWith('/coverageprobe/index/late'));
assert.equal(late.length, 1, 'Missing the request that outlives its test');
const owner = attempts.get(late[0].attempt);
const next = [...attempts.values()].filter(attempt => attempt.runner === runner && attempt.startedAt > owner.startedAt)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0];
assert.ok(next && Date.parse(next.startedAt) < Date.parse(late[0].startedAt) + 5000, 'The late request did not overlap the next test');
console.log(`Verified ${attempts.size} test attempts; ${requests.length - unattributed} of ${requests.length} PHP records attributed, ${unattributed} unattributed; per-attempt JavaScript counters match ${statements} covered statements; attribution: ${['php', 'javascript', 'templates', 'xml'].map(name => `${attribution.collectors[name].attributedUnits} ${name}`).join(', ')} units.`);
