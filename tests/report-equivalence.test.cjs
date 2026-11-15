// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {snapshot, validateSnapshot, compareSnapshots, compareThemes} = require('./ci/report-equivalence.cjs');
const {writeCoverage} = require('./ci-coverage-fixture.cjs');
const {cases} = require('./ci/cases.cjs');
function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-equivalence-unit-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    fs.writeFileSync(path.join(directory, 'run.json'), JSON.stringify({id: 'fresh'}));
    return {directory, ...writeCoverage(directory)};
}
function reports(value) { return cases.map(entry => ({...entry, snapshot: structuredClone(value)})); }
test('paired snapshots ignore run IDs and identify changed file outcomes', t => {
    const {directory} = fixture(t);
    const baseline = snapshot(directory);
    const candidate = {...structuredClone(baseline), run: 'paired-run'};
    assert.deepEqual(compareSnapshots(baseline, candidate), []);
    const file = Object.keys(candidate.php.files)[0];
    const line = Object.keys(candidate.php.files[file])[0];
    candidate.php.files[file][line] = !candidate.php.files[file][line];
    assert.deepEqual(compareSnapshots(baseline, candidate).map(difference => [difference.section, difference.file]), [['php', file]]);
});
test('complete snapshots preserve all measured sources without exposing private contents', t => {
    const {directory} = fixture(t);
    const value = snapshot(directory);
    for (const section of ['php', 'js', 'templates']) {
        assert.equal(Object.keys(value[section].files).length, 2);
        assert.ok(Object.keys(value[section].files).some(key => key.startsWith('source-sha256:')));
    }
    assert.doesNotMatch(JSON.stringify(value), /SECRET|secret\(|vendor\/private|requests/);
    assert.equal(compareThemes(reports(value), cases).passed, true);
});
test('OS paths, line endings, ordering, counter IDs and repeated hits do not change coverage outcomes', t => {
    const {directory, read, write} = fixture(t);
    const before = snapshot(directory);
    const templates = read('templates/coverage-summary.json');
    templates.templates.reverse().forEach(entry => {entry.source = entry.source.replaceAll('\n', '\r\n'); entry.statements.reverse();});
    write('templates/coverage-summary.json', templates);
    for (const file of ['php/line-coverage.json', 'js/coverage-final.json']) {
        const data = read(file);
        if (file.startsWith('js')) for (const value of Object.values(data)) {
            value.s = {renamed: 17, other: 0};
            value.statementMap = {other: value.statementMap[1], renamed: value.statementMap[0]};
            value.f[0] = 6;
            value.b[0][0] = 9;
        }
        write(file, Object.fromEntries(Object.entries(data).reverse().map(([key, value]) => [key.replace('/shop/', 'D:/build/').replaceAll('/', '\\'), value])));
    }
    assert.deepEqual(snapshot(directory), before);
});
test('Istanbul empty library groups retain Unknown percentages, but nonempty unknown totals are invalid', t => {
    const {directory, read, write} = fixture(t);
    const value = snapshot(directory);
    assert.equal(value.js.groups.libraries.statements.pct, 'Unknown');
    assert.equal(value.js.groups.libraries.statements.total, 0);
    const summary = read('javascript-summary.json');
    summary.groups.libraries.statements.total = 1;
    write('javascript-summary.json', summary);
    assert.throws(() => snapshot(directory), /Invalid coverage total/);
});
test('same-theme comparisons include every required host report', t => {
    const {directory} = fixture(t);
    const all = reports(snapshot(directory));
    all.filter(entry => entry.theme === 'hyva').forEach(entry => {entry.snapshot.metrics.templates = 12;});
    assert.equal(compareThemes(all, cases).passed, true, 'Different themes are independent baselines');
    for (const entry of all.filter(entry => entry.os !== 'ubuntu-latest')) {
        const changed = structuredClone(all);
        changed.find(report => report.id === entry.id).snapshot.metrics.templates++;
        const result = compareThemes(changed, cases);
        assert.equal(result.passed, false);
        assert.equal(result.themes[entry.theme].differences[0].case, entry.id);
    }
});
test('JavaScript report groups, required execution and exclusions cannot differ behind identical counters', t => {
    const {directory} = fixture(t);
    const original = snapshot(directory);
    for (const mutate of [
        value => {value.js.inventory[Object.keys(value.js.inventory)[0]] = 'libraries';},
        value => {value.js.requiredExecuted.pop();},
        value => {value.js.excluded[0][1] = 'changed-exclusion';}
    ]) {
        const all = reports(original);
        mutate(all[1].snapshot);
        const result = compareThemes(all, cases);
        assert.equal(result.passed, false);
        assert.ok(result.themes.luma.differences.some(difference => difference.section === 'js'));
    }
});
test('equal percentages cannot conceal different executed files, statements, functions, branches or DOM observations', t => {
    const {directory} = fixture(t);
    const original = snapshot(directory);
    const privateKey = section => Object.keys(original[section].files).find(key => key.startsWith('source-sha256:'));
    const mutations = [
        value => {delete value.php.files[privateKey('php')];},
        value => {value.php.files[privateKey('php')]['1'] = true;},
        value => {value.js.files[privateKey('js')].statements[0][1] = false; value.js.files[privateKey('js')].statements[1][1] = true;},
        value => {value.js.files[privateKey('js')].functions[0][2] = false;},
        value => {value.js.files[privateKey('js')].functions[0][3] = 'changed-name';},
        value => {value.js.files[privateKey('js')].branches[0][2][1][1] = true;},
        value => {value.templates.files[privateKey('templates')].status = 'observed';},
        value => {value.templates.files[privateKey('templates')].source = 'changed';},
        value => {value.templates.files[privateKey('templates')].warnings.push('new-warning');},
        value => {value.templates.files[privateKey('templates')].statements[0][3] = true;},
        value => {value.templates.files[privateKey('templates')].functions[0][3] = true;},
        value => {value.templates.files[privateKey('templates')].branches[0][3] = true;}
    ];
    for (const mutate of mutations) {
        const all = reports(original);
        mutate(all[1].snapshot);
        const result = compareThemes(all, cases);
        assert.equal(result.passed, false);
        assert.ok(result.themes.luma.differences.some(difference => difference.file?.startsWith('source-sha256:')));
    }
});
test('missing or duplicate host cases and stale or incomplete reports cannot satisfy equivalence', t => {
    const {directory, read, write} = fixture(t);
    const value = snapshot(directory), all = reports(value);
    assert.equal(compareThemes(all.slice(0, -1), cases).passed, false);
    assert.equal(compareThemes([...all.slice(0, -1), all[0]], cases).passed, false);
    assert.throws(() => validateSnapshot({...value, run: 'old'}, 'fresh', read('summary.json')), /Stale/);
    const incomplete = structuredClone(value);
    delete Object.values(incomplete.js.files)[0].functions;
    assert.throws(() => validateSnapshot(incomplete, 'fresh', read('summary.json')), /Missing coverage inventory/);
    const scope = read('javascript-scope.json');
    write('javascript-scope.json', {...scope, included: scope.included.slice(0, 1)});
    assert.throws(() => snapshot(directory), /Incomplete JavaScript source inventory/);
    write('javascript-scope.json', scope);
    const js = read('js/coverage-final.json');
    delete Object.values(js)[0].f;
    write('js/coverage-final.json', js);
    assert.throws(() => snapshot(directory), /Missing coverage map/);
});
