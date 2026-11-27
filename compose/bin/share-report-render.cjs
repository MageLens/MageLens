// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const mustache = require('mustache');
const {escapeHtml} = require('./report-index.cjs');

const templates = Object.fromEntries(['header', 'section', 'xml-effects', 'source', 'footer'].map(name => [
    name, fs.readFileSync(path.join(__dirname, 'share-report-templates', name + '.html'), 'utf8')
]));

function coverageCells({covered, total}) {
    return {covered, total, percentage: total ? (covered * 100 / total).toFixed(2) + '%' : 'N/A'};
}

function sectionView(section, sourceLinks) {
    const files = section.files.map(file => {
        if (sourceLinks && !sourceLinks.has(file.path)) sourceLinks.set(file.path, 'source-' + sourceLinks.size);
        return {
            ...coverageCells(file),
            path: file.path,
            sourceId: sourceLinks?.get(file.path),
            fingerprint: file.fingerprint,
            declarations: file.declarations?.map(item => ({
                ...item, span: item.start === item.end ? `line ${item.start}` : `lines ${item.start}–${item.end}`
            }))
        };
    });
    return {label: section.label, warningCount: section.warningCount, fileCount: files.length,
        files, xmlFiles: files.filter(file => file.declarations?.length)};
}

function writeReport(write, sections, readSource) {
    const render = (name, view) => write(mustache.render(templates[name], view, templates, {escape: escapeHtml}));
    const sourceLinks = readSource ? new Map() : null;
    render('header', {includeSource: Boolean(readSource),
        metrics: sections.map(section => ({label: section.label, ...coverageCells(section)}))});
    for (const section of sections) render('section', sectionView(section, sourceLinks));
    if (sourceLinks) {
        render('source', {heading: true});
        for (const [file, id] of sourceLinks) render('source', {file: {id, path: file, text: readSource(file)}});
    }
    write(templates.footer);
}

module.exports = {writeReport};
