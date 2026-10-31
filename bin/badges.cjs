// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const START = '<!-- coverage-badges:start -->';
const END = '<!-- coverage-badges:end -->';
const icons = {
    php: {file: 'php', color: '#a3a7d5', label: 'PHP lines'},
    js: {file: 'javascript', color: '#f7df1e', label: 'JavaScript statements'},
    templates: {file: 'html5', color: '#e34f26', label: 'Template executable lines'},
    cypress: {file: 'cypress', color: '#69d3a7', label: 'Cypress'},
    playwright: {file: null, color: '#69d3a7', label: 'Playwright'}
};
const escape = value => String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);
function replaceBadgeSection(readme, content) {
    if (readme.split(START).length !== 2 || readme.split(END).length !== 2 || readme.indexOf(START) > readme.indexOf(END)) {
        throw new Error('README must contain exactly one correctly ordered coverage badge marker pair');
    }
    return readme.slice(0, readme.indexOf(START) + START.length) + '\n' + content + '\n' + readme.slice(readme.indexOf(END));
}
function setBadgeSection(content) {
    const result = replaceBadgeSection(fs.readFileSync('README.md', 'utf8'), content);
    fs.writeFileSync('README.md.tmp', result);
    fs.renameSync('README.md.tmp', 'README.md');
}
function renderBadge(type, value, color) {
    const icon = icons[type];
    if (!icon) throw new Error('Unknown badge icon');
    const source = icon.file ? fs.readFileSync(path.join(__dirname, '../assets/badge-icons', `${icon.file}.svg`), 'utf8') : '';
    const drawing = icon.file ? source.match(/<path\s+d="[^"]+"\s*\/>/g)?.join('') : '<text x="0" y="19" font-family="sans-serif" font-size="14">PW</text>';
    if (!drawing) throw new Error(`Missing SVG icon: ${type}`);
    const left = 40;
    const right = Math.ceil(value.length * 8.5) + 20;
    const width = left + right;
    const label = escape(`${icon.label}: ${value}`);
    // PhpStorm's SVG preview does not reliably resolve CSS font fallback lists.
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="28" viewBox="0 0 ${width} 28" role="img" aria-label="${label}"><title>${label}</title><defs><clipPath id="bounds"><rect width="${width}" height="28" rx="4"/></clipPath></defs><g clip-path="url(#bounds)"><rect width="${left}" height="28" fill="#555"/><rect x="${left}" width="${right}" height="28" fill="${color}"/></g><g transform="translate(10 4) scale(0.8333333333)" fill="${icon.color}" aria-hidden="true">${drawing}</g><text x="${left + right / 2}" y="19" fill="white" text-anchor="middle" font-family="sans-serif" font-size="14">${escape(value)}</text></svg>\n`;
}
function badge(type, percent) {
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new Error('Invalid coverage percentage');
    const value = `${percent.toFixed(2)}%`;
    const color = percent >= 80 ? '#4c1' : percent >= 50 ? '#a4a61d' : '#e05d44';
    return renderBadge(type, value, color);
}
function cypressBadge(results, runner = 'cypress') {
    const counts = ['totalTests', 'totalPassed', 'totalFailed', 'totalPending', 'totalSkipped'].map(key => results[key]);
    if (counts.some(count => !Number.isSafeInteger(count) || count < 0) || !results.totalTests ||
        counts.slice(1).reduce((sum, count) => sum + count, 0) !== results.totalTests) {
        throw new Error('Invalid Cypress result counts');
    }
    const failed = results.totalFailed > 0 || results.failures > 0 || results.status === 'failed';
    const passed = !failed && results.totalPassed === results.totalTests;
    const percent = Number((100 * results.totalPassed / results.totalTests).toFixed(2));
    const status = passed ? 'Passed' : failed ? 'Failed' : 'Incomplete';
    return renderBadge(runner, `${percent}% (${results.totalPassed}/${results.totalTests}) - ${status}`,
        passed ? '#4c1' : failed ? '#e05d44' : '#a4a61d');
}
module.exports = {replaceBadgeSection, setBadgeSection, badge, cypressBadge};
