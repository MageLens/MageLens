// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {createHash} = require('node:crypto');

const report = JSON.parse(fs.readFileSync('coverage/xml/coverage.json'));
const original = 'app/code/MageLens/Compatibility/etc/crontab.xml';
const file = report.files.find(item => item.path === original);
assert.ok(file, 'Missing original cron XML inventory');
assert.equal(file.sourceHash, createHash('sha256').update(fs.readFileSync('src/' + original)).digest('hex'));

function item(identity, line) {
    const declaration = file.declarations.find(entry => entry.path === identity);
    assert.ok(declaration, 'Missing cron declaration ' + identity);
    assert.equal(declaration.startLine, line);
    assert.equal(declaration.family, 'cron');
    return declaration;
}

function evidence(declaration, effect, outcome, tool) {
    const matches = declaration.evidence.filter(event => event.type === 'cron-' + effect && event.outcome === outcome);
    assert.ok(matches.length, `Missing ${effect} (${outcome}) on ${declaration.path}`);
    for (const match of matches) {
        assert.equal(match.run, report.run);
        assert.equal(match.area, 'crontab');
        assert.ok(report.requests.some(record => record.id === match.request && record.tool === tool));
    }
    return new Set(matches.map(event => event.request));
}

const seeded = item('magelens_probe/magelens_probe', 9);
const seededSchedule = item('magelens_probe/magelens_probe#schedule', 10);
const failed = item('magelens_probe/magelens_failing_probe', 12);
const failedSchedule = item('magelens_probe/magelens_failing_probe#schedule', 13);
const untouched = item('magelens_probe/magelens_never_probe', 15);
const untouchedSchedule = item('magelens_probe/magelens_never_probe#schedule', 16);
const generated = item('magelens_generated_probe/magelens_generated_probe', 20);
const evaluated = item('magelens_generated_probe/magelens_generated_probe#schedule', 21);
const direct = item('magelens_magerun_probe/magelens_magerun_probe', 25);

const seededCommand = evidence(seeded, 'handler-entered', 'entered', 'magento');
assert.deepEqual(evidence(seeded, 'handler-completed', 'completed', 'magento'), seededCommand);
assert.deepEqual(evidence(failed, 'handler-entered', 'entered', 'magento'), seededCommand);
assert.deepEqual(evidence(failed, 'handler-completed', 'failed', 'magento'), seededCommand);
const warmCommand = evidence(seeded, 'handler-entered', 'cache-only', 'magento');
assert.deepEqual(evidence(seeded, 'handler-completed', 'cache-only', 'magento'), warmCommand);
assert.ok([...warmCommand].every(command => !seededCommand.has(command)));
assert.equal(failed.effectStates['cron-handler-completed'], 'uncovered');
const generationCommand = evidence(evaluated, 'schedule-evaluated', 'observed', 'magento');
assert.ok([...generationCommand].every(command => !seededCommand.has(command)));
const generatedHandler = evidence(generated, 'handler-entered', 'entered', 'magento');
assert.deepEqual(evidence(generated, 'handler-completed', 'completed', 'magento'), generatedHandler);
assert.ok([...generatedHandler].some(command => !generationCommand.has(command)));
const directCommand = evidence(direct, 'handler-entered', 'entered', 'magerun');
assert.deepEqual(evidence(direct, 'handler-completed', 'completed', 'magerun'), directCommand);
assert.ok([...directCommand].every(command => !generationCommand.has(command)));
for (const declaration of [seededSchedule, failedSchedule, untouched, untouchedSchedule]) {
    assert.equal(declaration.supported, true);
    assert.equal(declaration.state, 'uncovered');
    assert.equal(declaration.hits, 0);
    assert.deepEqual(declaration.evidence, []);
}
console.log('Verified cron schedule evaluation, independent callback entry and completion, and original XML lines.');
