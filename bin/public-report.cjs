// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');

// Only these generated views, assets and report downloads belong on the local web server.
// The collectors share the parent directory with request records and fixture credentials.
const reportDirectories = ['php', 'js', 'js-application', 'js-libraries', 'templates', 'xml', 'html-validation'];
const downloads = new Set([
    'index.html', 'report.sqlite', 'schema.sql', 'summary.json', 'javascript-summary.json', 'javascript-scope.json',
    'php/clover.xml', 'php/line-coverage.json', 'templates/coverage-summary.json', 'xml/coverage.json',
    'html-validation/results.json',
    ...['cypress', 'playwright', 'php', 'js', 'templates'].map(name => `badges/${name}.svg`),
    ...['_js/source-view.js', '_js/coverage-table.js', '_css/custom.css', '_css/style.css'].map(name => `php/${name}`),
    ...['js', 'js-application', 'js-libraries'].flatMap(directory =>
        ['base.css', 'block-navigation.js', 'coverage-final.json', 'coverage-summary.json', 'favicon.png',
            'prettify.css', 'prettify.js', 'sort-arrow-sprite.png', 'sorter.js'].map(name => `${directory}/${name}`))
]);

function stageLocalReport(directory) {
    const target = path.join(directory, '.site');
    if (!fs.lstatSync(directory).isDirectory()) throw new Error('Expected a local coverage directory');
    // The run prepares a fresh coverage directory and publishes the link only after staging succeeds.
    fs.mkdirSync(target);
    function visit(relativeDirectory) {
        const source = path.join(directory, relativeDirectory);
        for (const entry of fs.readdirSync(source, {withFileTypes: true})) {
            const relative = path.posix.join(relativeDirectory, entry.name);
            if (entry.isDirectory() && relativeDirectory !== 'badges') {
                if (relativeDirectory || reportDirectories.includes(relative) || relative === 'badges') visit(relative);
                continue;
            }
            const isReportPage = relativeDirectory && relativeDirectory !== 'badges' && entry.name.endsWith('.html');
            if (!entry.isFile() || !(downloads.has(relative) || isReportPage)) continue;
            const destination = path.join(target, relative);
            fs.mkdirSync(path.dirname(destination), {recursive: true});
            fs.copyFileSync(path.join(directory, relative), destination, fs.constants.COPYFILE_FICLONE);
        }
    }
    visit('');
}

if (require.main === module) stageLocalReport('coverage');
