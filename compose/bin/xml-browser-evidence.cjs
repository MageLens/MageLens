// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {createHash, randomBytes} = require('node:crypto');

const token = /^[a-f0-9]{32}$/;
const identity = /^[A-Za-z0-9_:#.\/-]{1,240}$/;
const menuSelector = /^[a-z0-9-]{1,240}$/;
const anchors = new Map([
    ['ui-constructed', 'ui-delivered'],
    ['ui-rendered', 'ui-delivered'],
    ['ui-action-invoked', 'ui-delivered'],
    ['ui-reloaded', 'ui-provider-executed'],
    ['menu-followed', 'menu-emitted'],
]);

function validate(entry, withRun) {
    const menu = entry?.type === 'menu-followed';
    const expected = menu ? ['selector', 'response', 'type', 'destination'] : ['identity', 'response', 'type'];
    if (entry?.candidate === true && entry.type?.startsWith('ui-')) expected.push('candidate');
    if (withRun) expected.push('run');
    assert.ok(entry && Object.keys(entry).sort().join() === expected.sort().join(), 'Invalid browser XML observation shape');
    assert.ok(anchors.has(entry.type) && token.test(entry.response)
        && (menu ? menuSelector.test(entry.selector) : identity.test(entry.identity)), 'Invalid browser XML observation');
    if (menu) {
        assert.ok(token.test(entry.destination) && entry.destination !== entry.response, 'Invalid menu destination response');
    }
}

function browserDirectory(run) {
    assert.match(run, token);
    return `coverage/raw/xml-browser/${run}`;
}

function recordXmlBrowserEvidence(entry) {
    validate(entry, false);
    const run = fs.readFileSync('coverage/.active-run', 'utf8').trim();
    const directory = browserDirectory(run);
    fs.mkdirSync(directory, {recursive: true});
    fs.writeFileSync(`${directory}/${randomBytes(16).toString('hex')}.json`, JSON.stringify({...entry, run}), {flag: 'wx'});
    return null;
}

function readXmlBrowserEvidence(run) {
    const directory = browserDirectory(run);
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory).sort().map(file => {
        assert.match(file, /^[a-f0-9]{32}\.json$/);
        return JSON.parse(fs.readFileSync(`${directory}/${file}`));
    });
}

function matchMenuDestination(record, targetHash) {
    if (record?.method !== 'GET' || record.status !== 200 || !record.uri?.startsWith('/')) return false;
    return createHash('sha256').update(record.uri).digest('hex') === targetHash;
}

function correlateBrowserEvidence(run, records, declarations, observations) {
    if (!observations.length) return new Map();
    const http = new Map(records.filter(record => record.run === run && !record.tool && token.test(record.request))
        .map(record => [record.request, record]));
    const result = new Map();
    for (const observation of observations) {
        validate(observation, true);
        assert.equal(observation.run, run, 'Stale browser XML observation');
        const source = http.get(observation.response);
        assert.ok(source, 'Browser XML observation has no active HTTP response');
        const menu = observation.type === 'menu-followed';
        const matches = new Set();
        if (source.status === 200) for (const event of source.events) {
            const item = declarations.get(event.id);
            if (event.type !== anchors.get(observation.type) || event.area !== 'adminhtml' || event.outcome !== 'observed'
                || !item?.supported || !item.effects?.includes(observation.type)) continue;
            if (menu ? source.menuLinks?.[event.id]?.selector !== observation.selector : item.path !== observation.identity) continue;
            matches.add(event.id);
        }
        // Menu candidates include unmeasured, cached and programmatic entries.
        // Once anchored to a unique native render, both responses must agree.
        if ((menu || observation.candidate) && matches.size === 0) continue;
        assert.equal(matches.size, 1, 'Browser XML observation has no unique native delivery');
        const [id] = matches;
        if (menu) {
            assert.ok(matchMenuDestination(http.get(observation.destination), source.menuLinks[id].targetHash),
                'Browser menu observation has no matching native destination');
        }
        const event = {id, type: observation.type, area: 'adminhtml', outcome: 'observed', reason: null, hits: 1};
        if (!result.has(source)) result.set(source, new Map());
        const evidence = {origin: 'browser', ...(observation.destination ? {destination: observation.destination} : {})};
        result.get(source).set(JSON.stringify([id, event.type, evidence]), {event, evidence});
    }
    return new Map([...result].map(([record, effects]) => [record, [...effects.values()]]));
}

module.exports = {recordXmlBrowserEvidence, readXmlBrowserEvidence, correlateBrowserEvidence, browserEffects: new Set(anchors.keys())};
