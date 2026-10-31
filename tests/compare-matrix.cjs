// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const directories = process.argv.slice(2);
assert.equal(directories.length, 8, 'Supply the eight coverage directories from one installation matrix');
const normalize = file => file.slice(file.indexOf('app/code/'));
const blog = file => file.includes('/Application/Blog/');
function lines(files, select) {
    return Object.fromEntries(Object.entries(files).filter(([file]) => select(file)).sort().map(([file, hits]) =>
        [normalize(file), Object.fromEntries(Object.entries(hits).map(([line, hit]) => [line, hit > 0]))]));
}
function totals(files) {
    const hits = Object.values(files).flatMap(lines => Object.values(lines));
    return {files: Object.keys(files).length, lines: hits.length, covered: hits.filter(Boolean).length};
}
function javascriptLines(coverage) {
    return Object.fromEntries(Object.entries(coverage).map(([file, data]) => {
        const hits = {};
        for (const [id, count] of Object.entries(data.s)) {
            const line = data.statementMap[id].start.line;
            hits[line] = Math.max(hits[line] || 0, count);
        }
        return [file, hits];
    }));
}
const runs = directories.map(directory => {
    const read = file => JSON.parse(fs.readFileSync(path.join(directory, file)));
    execFileSync(process.execPath, [path.join(__dirname, 'verify-scenarios.cjs'), directory], {stdio: 'inherit'});
    const themePaths = read('project-fixtures.json').Application_Blog.themePaths;
    const theme = themePaths.includes('Hyva/default-csp') ? 'hyva' : 'luma';
    assert.equal(themePaths[0], {'hyva': 'Hyva/default-csp', luma: 'Magento/luma'}[theme], 'Matrix must exercise the installer-selected base theme');
    const runner = read('run.json').runner || 'cypress';
    const installation = read('installation.json');
    const platform = installation.platform;
    assert.equal(installation.theme, theme);
    assert.equal(installation.runner, runner);
    const php = read('php/line-coverage.json');
    const js = javascriptLines(read('js/coverage-final.json'));
    const templates = read('templates/coverage-summary.json');
    const templateHits = Object.fromEntries(templates.templates.filter(entry => blog(entry.path)).sort((a, b) => a.path.localeCompare(b.path)).map(entry =>
        [entry.path, entry.statements.map(statement => ({start: statement.start, syntax: statement.syntax, covered: statement.hits > 0}))]));
    const sharedPhp = lines(php, file => blog(file) && !/\/templates\/blog(?:-hyva)?\.phtml$/.test(file));
    const sharedJs = lines(js, file => blog(file) && file.includes('/view/adminhtml/'));
    assert.ok(Object.keys(sharedPhp).length > 10 && Object.keys(sharedJs).length >= 2, 'Missing shared application sources');
    return {platform, version: installation.version, theme, runner, directory, passedTests: read(`${runner}-results.json`).totalPassed, metrics: read('summary.json').metrics,
        sharedPhp, sharedJs, php: lines(php, blog), js: lines(js, blog), templateHits};
});
assert.deepEqual(runs.map(run => `${run.platform}/${run.theme}/${run.runner}`).sort(),
    ['magento', 'mageos'].flatMap(platform => ['luma', 'hyva'].flatMap(theme =>
        ['cypress', 'playwright'].map(runner => `${platform}/${theme}/${runner}`))).sort());
const differences = [];
function compare(label, left, right) {
    for (const file of new Set([...Object.keys(left), ...Object.keys(right)])) {
        if (JSON.stringify(left[file]) !== JSON.stringify(right[file])) differences.push({comparison: label, file, left: left[file], right: right[file]});
    }
}
for (const run of runs.slice(1)) {
    compare(`Shared PHP: ${runs[0].platform}/${runs[0].theme}/${runs[0].runner} vs ${run.platform}/${run.theme}/${run.runner}`, runs[0].sharedPhp, run.sharedPhp);
    compare(`Shared Admin JavaScript: ${runs[0].platform}/${runs[0].theme}/${runs[0].runner} vs ${run.platform}/${run.theme}/${run.runner}`, runs[0].sharedJs, run.sharedJs);
}
for (const platform of ['magento', 'mageos']) {
    for (const theme of ['luma', 'hyva']) {
        const [left, right] = runs.filter(run => run.platform === platform && run.theme === theme);
        compare(`${platform}/${theme} PHP: Cypress vs Playwright`, left.php, right.php);
        compare(`${platform}/${theme} JavaScript: Cypress vs Playwright`, left.js, right.js);
        compare(`${platform}/${theme} templates: Cypress vs Playwright`, left.templateHits, right.templateHits);
    }
}
const output = {passed: differences.length === 0, runs: runs.map(({platform, version, theme, runner, directory, passedTests, metrics, sharedPhp, sharedJs}) => ({
    platform, version, theme, runner, directory, passedTests, metrics,
    shared: {php: totals(sharedPhp), adminJavaScript: totals(sharedJs)}
})), differences};
const target = process.env.MAGELENS_MATRIX_REPORT || '.runtime/e2e/matrix-comparison.json';
fs.mkdirSync(path.dirname(target), {recursive: true});
fs.writeFileSync(target, JSON.stringify(output, null, 2) + '\n');
assert.equal(differences.length, 0, `Coverage outcomes differ; inspect ${target}`);
console.log(`Verified equivalent scenarios and covered source lines across all eight modes. Comparison: ${target}`);
