// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {createHash} = require('node:crypto');

const report = JSON.parse(fs.readFileSync('coverage/xml/coverage.json'));
assert.equal(report.run, JSON.parse(fs.readFileSync('coverage/run.json')).id);
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

function effectsWithHits(declaration) {
    return report.requests.flatMap(request => request.events)
        .filter(event => event.id === declaration.id).map(({type, outcome, hits}) => [type, outcome, hits]);
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
const directNumeric = item('magelens_magerun_probe/456', 26);
const preferred = item('123/123', 29);
const numericSchedule = item('123/123#schedule', 30);
const virtual = item('123/0123', 32);
const leadingZeroSchedule = item('123/0123#schedule', 33);
const scoped = item('123/magelens_scoped_probe', 35);
const scopedSchedule = item('123/magelens_scoped_probe#schedule', 36);

const seededCommand = evidence(seeded, 'handler-entered', 'entered', 'magento');
assert.deepEqual(evidence(seeded, 'handler-completed', 'completed', 'magento'), seededCommand);
assert.deepEqual(evidence(failed, 'handler-entered', 'entered', 'magento'), seededCommand);
assert.deepEqual(evidence(failed, 'handler-completed', 'failed', 'magento'), seededCommand);
assert.deepEqual(effectsWithHits(failed), [
    ['cron-handler-entered', 'entered', 1],
    ['cron-handler-completed', 'failed', 1],
]);
assert.equal(failed.effectStates['cron-handler-entered'], 'covered');
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
assert.equal(directNumeric.binding.method, 'Execute');
const numericDirectCommand = evidence(directNumeric, 'handler-entered', 'entered', 'magerun');
assert.deepEqual(evidence(directNumeric, 'handler-completed', 'completed', 'magerun'), numericDirectCommand);
assert.deepEqual(effectsWithHits(directNumeric), [
    ['cron-handler-entered', 'entered', 1],
    ['cron-handler-completed', 'completed', 1],
]);
assert.ok([...numericDirectCommand].every(command => !directCommand.has(command)));
assert.equal(preferred.binding.method, 'Execute');
const numericGeneration = evidence(numericSchedule, 'schedule-evaluated', 'observed', 'magento');
assert.deepEqual(evidence(leadingZeroSchedule, 'schedule-evaluated', 'observed', 'magento'), numericGeneration);
assert.deepEqual(evidence(scopedSchedule, 'schedule-evaluated', 'observed', 'magento'), numericGeneration);
const scopedDispatch = evidence(scoped, 'handler-entered', 'entered', 'magento');
assert.deepEqual(evidence(scoped, 'handler-completed', 'completed', 'magento'), scopedDispatch);
assert.equal([...scopedDispatch].filter(command => !numericGeneration.has(command)).length, 1,
    'The seeded scoped job must run in a separate command from schedule generation');
for (const declaration of [preferred, virtual]) {
    const entered = evidence(declaration, 'handler-entered', 'entered', 'magento');
    assert.deepEqual(evidence(declaration, 'handler-completed', 'completed', 'magento'), entered);
    assert.ok([...scopedDispatch].every(command => entered.has(command)));
}
for (const declaration of [seededSchedule, failedSchedule, untouched, untouchedSchedule]) {
    assert.equal(declaration.supported, true);
    assert.equal(declaration.state, 'uncovered');
    assert.equal(declaration.hits, 0);
    assert.deepEqual(declaration.evidence, []);
}
const skipped = item('magelens_interceptor_probe/magelens_cron_skipped', 40);
const proceeded = item('magelens_interceptor_probe/magelens_cron_proceeded', 43);
assert.deepEqual(skipped.evidence, []);
assert.equal(skipped.hits, 0);
assert.deepEqual(skipped.effectStates, {'cron-handler-entered': 'uncovered', 'cron-handler-completed': 'uncovered'});
assert.deepEqual(proceeded.effectStates, {'cron-handler-entered': 'covered', 'cron-handler-completed': 'covered'});
for (const tool of ['magento', 'magerun']) {
    const hits = report.requests.filter(request => request.tool === tool).flatMap(request => request.events)
        .filter(event => event.id === proceeded.id).map(({type, outcome, hits}) => [type, outcome, hits]);
    assert.deepEqual(hits, [
        ['cron-handler-entered', 'entered', 1],
        ['cron-handler-completed', 'completed', 1],
    ], tool);
}
console.log('Verified cron schedule evaluation, independent callback entry and completion, and original XML lines.');
