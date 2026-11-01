// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {createManifest, merge} = require('@vitaliiboiko/magento-template-coverage');
const {createCoverageMap} = require('istanbul-lib-coverage');
const {snapshot} = require('./ci/report-equivalence.cjs');
const loc = {start: {line: 1, column: 0}, end: {line: 1, column: 8}};
function writeCoverage(directory) {
    const write = (file, value) => {
        fs.mkdirSync(path.dirname(path.join(directory, file)), {recursive: true});
        fs.writeFileSync(path.join(directory, file), JSON.stringify(value));
    };
    const source = path.join(directory, 'source');
    for (const file of ['app/code/Application/Blog/view/frontend/templates/blog.phtml', 'vendor/private/SECRET.phtml']) {
        fs.mkdirSync(path.dirname(path.join(source, file)), {recursive: true});
        fs.writeFileSync(path.join(source, file), '<div data-bind="text: name">SECRET</div>\n<script>function secret() { if (true) return 1; } secret();</script>\n');
    }
    const templates = merge(createManifest({source, roots: ['app/code', 'vendor']}), []);
    write('templates/coverage-summary.json', templates);
    write('summary.json', {run: 'fresh', metrics: {php: {percent: 50}, js: {percent: 50}, templates: {percent: 0}}});
    write('php/coverage-summary.json', {run: 'fresh', total: 2, covered: 1, percent: 50, requests: ['SECRET']});
    write('php/line-coverage.json', {'/shop/app/code/Application/Blog/Model/Article.php': {'1': 1}, '/shop/vendor/private/SECRET.php': {'1': 0}});
    const js = {s: {0: 1, 1: 0}, statementMap: {0: loc, 1: {start: {line: 2, column: 0}, end: {line: 2, column: 8}}},
        f: {0: 1}, fnMap: {0: {name: 'SECRET', loc, decl: loc}},
        b: {0: [1, 0]}, branchMap: {0: {type: 'if', loc, locations: [loc, {start: {}, end: {}}]}}, code: 'SECRET'};
    const javascript = Object.fromEntries(['/shop/app/code/Application/Blog/view/adminhtml/web/js/admin.js', '/shop/vendor/private/SECRET.js'].map(file => [file, {...js, path: file}]));
    write('js/coverage-final.json', javascript);
    write('javascript-scope.json', {run: 'fresh', included: [
        {path: 'app/code/Application/Blog/view/adminhtml/web/js/admin.js', group: 'application'},
        {path: 'vendor/private/SECRET.js', group: 'application'}], requiredExecuted: ['app/code/Application/Blog/view/adminhtml/web/js/admin.js']});
    const totals = createCoverageMap(javascript).getCoverageSummary().toJSON();
    write('javascript-summary.json', {run: 'fresh', groups: {all: totals, application: totals, libraries: createCoverageMap({}).getCoverageSummary().toJSON()},
        excluded: [{path: 'vendor/private/SECRET-excluded.js', reason: 'SECRET'}]});
    write('equivalence.json', snapshot(directory));
    return {write, read: file => JSON.parse(fs.readFileSync(path.join(directory, file)))};
}
module.exports = {writeCoverage};
