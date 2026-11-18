// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = file => JSON.parse(fs.readFileSync(`coverage/${file}`, 'utf8'));
const moduleRoot = 'app/code/MageLens/Compatibility';
const results = read('cli-results.json');
const php = read('php/coverage-summary.json');
assert.equal(php.commands.length, results.commands);
assert.deepEqual([...new Set(php.commands.map(command => command.tool))].sort(), ['magento', 'magerun']);
const probe = `${moduleRoot}/Cli/Probe.php`;
const workerLine = fs.readFileSync(`src/${probe}`, 'utf8').split('\n').findIndex(line => line.includes('writeln(trim($value))')) + 1;
assert.equal(read('php/line-coverage.json')[probe][workerLine], 1, 'Missing forked worker coverage');
const jobs = `${moduleRoot}/Cli/Jobs.php`;
const source = fs.readFileSync(`src/${jobs}`, 'utf8').split('\n');
const hits = read('php/line-coverage.json')[jobs];
for (const fragment of ["getValue('magelens_probe/cron/enabled')", 'file_put_contents(self::marker']) {
    const line = source.findIndex(line => line.includes(fragment)) + 1;
    assert.ok(line && hits[line] === 1, `Missing CLI PHP coverage for ${fragment}`);
}

const xml = read('xml/coverage.json');
const config = xml.files.find(file => file.path === `${moduleRoot}/etc/config.xml`);
const enabled = config.declarations.find(item => item.path === 'magelens_probe/cron/enabled');
assert.equal(enabled.state, 'covered');
assert.equal(config.declarations.find(item => item.path === 'magelens_probe/cron/unused').state, 'uncovered');
assert.ok(xml.requests.some(record => record.tool === 'magento' && record.events.some(event => event.id === enabled.id)),
    'The cron config declaration must be hit by the CLI, during the current run');
const di = xml.files.find(file => file.path === `${moduleRoot}/etc/crontab/di.xml`);
const argument = di.declarations.find(item => item.family === 'arguments' && item.binding.argument === 'expected');
assert.equal(argument.areas.crontab.state, 'covered');
assert.ok(xml.requests.some(record => record.tool === 'magento' && record.events.some(event =>
    event.id === argument.id && event.type === 'argument-applied' && event.area === 'crontab')),
'The cron constructor argument must be attributed to its native CLI DI configuration');
console.log('Verified current-run Magento and n98-magerun2 records, cron and queue PHP hits, and CLI XML evidence.');
