// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {writeReport} = require('./share-report-render.cjs');
const {shareReportData} = require('./share-report-data.cjs');
const {createSourceReader} = require('./share-report-source.cjs');

function exportReport(includeSource) {
    const name = includeSource ? 'share-with-source.html' : 'share.html';
    const directory = path.join(fs.realpathSync('.'), 'coverage');
    if (!fs.lstatSync(directory).isDirectory()) throw new Error('Expected a local coverage directory.');
    fs.mkdirSync('.runtime', {recursive: true});
    const lock = '.runtime/workflow.lock';
    try {
        fs.mkdirSync(lock);
    } catch (error) {
        if (error.code === 'EEXIST') throw new Error('Another MageLens workflow is active. Retry after it completes.');
        throw error;
    }
    try {
        if (fs.lstatSync(path.join(directory, '.active-run'), {throwIfNoEntry: false}) ||
            !fs.lstatSync(path.join(directory, 'index.html'), {throwIfNoEntry: false})?.isFile()) {
            throw new Error('Run ./bin/run-coverage successfully before exporting.');
        }
        const sections = shareReportData(directory);
        const readSource = includeSource ? createSourceReader('.', directory) : null;
        const temporary = path.join(directory, '.share-' + randomUUID() + '.tmp');
        const fd = fs.openSync(temporary, 'wx', 0o600);
        try {
            try {
                writeReport(value => fs.writeFileSync(fd, value), sections, readSource);
            } finally {
                fs.closeSync(fd);
            }
            fs.renameSync(temporary, path.join(directory, name));
        } finally {
            fs.rmSync(temporary, {force: true});
        }
    } finally {
        fs.rmdirSync(lock);
    }
    console.log('Share this file: coverage/' + name);
}

try {
    const args = process.argv.slice(2);
    if (args.length && !(args.length === 1 && args[0] === '--include-source')) {
        throw new Error('Usage: ./bin/export-coverage [--include-source]');
    }
    exportReport(args.length === 1);
} catch (error) {
    console.error('Cannot export coverage:', error.message);
    process.exitCode = 1;
}
