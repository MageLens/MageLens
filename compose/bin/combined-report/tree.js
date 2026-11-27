// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

'use strict';

const data = JSON.parse(document.getElementById('coverage-data').textContent);
const directories = new Map(data.directories.map(entry => [entry.path, entry]));
const children = new Map(data.directories.map(entry => [entry.path, []]));
const allEntries = [...data.directories.filter(entry => entry.path), ...data.files];
const query = document.getElementById('query');
const sort = document.getElementById('sort');
const entries = document.getElementById('entries');
const back = document.getElementById('report-back');
const backIcon = document.getElementById('back-icon');
const backHome = document.getElementById('back-home');
const backLabel = document.getElementById('back-label');
const overview = document.getElementById('report-overview');
const icons = {php: 'PHP', js: 'JS', html: 'HTML', phtml: 'PHTML'};

for (const entry of allEntries) {
    const directory = entry.path.slice(0, Math.max(0, entry.path.lastIndexOf('/')));
    children.get(directory).push(entry);
}

function coverage(entry) {
    return entry.total ? entry.covered / entry.total : null;
}

function compare(left, right) {
    const nameOrder = Number(Boolean(left.href)) - Number(Boolean(right.href))
        || (left.path < right.path ? -1 : Number(left.path > right.path));
    if (sort.value === 'path') return nameOrder;
    const a = coverage(left);
    const b = coverage(right);
    if (a === null || b === null) return Number(a === null) - Number(b === null) || nameOrder;
    return (sort.value === 'ascending' ? a - b : b - a) || nameOrder;
}

function element(tag, value) {
    const node = document.createElement(tag);
    if (value !== undefined) node.textContent = value;
    return node;
}

function link(label, href) {
    const node = element('a', label);
    node.href = href;
    return node;
}

function directoryLink(label, path) {
    return link(label, '#' + encodeURIComponent(path));
}

function percent(entry) {
    const value = coverage(entry);
    return value === null ? 'N/A' : (100 * value).toFixed(2) + '%';
}

function coverageCell(entry) {
    const label = percent(entry);
    const cell = element('td');
    if (entry.total) {
        cell.append(element('strong', label));
        const track = element('span');
        track.className = 'coverage-track';
        track.setAttribute('aria-hidden', 'true');
        const fill = element('span');
        fill.style.width = label;
        fill.style.backgroundColor = entry.color;
        track.append(fill);
        cell.append(track);
    } else {
        cell.textContent = label;
    }
    return cell;
}

function countLabel(count, singular, plural = singular + 's') {
    return `${count} ${count === 1 ? singular : plural}`;
}

function render() {
    let requested;
    try { requested = decodeURIComponent(location.hash.slice(1)); }
    catch { requested = ''; }
    const current = directories.get(requested) ?? directories.get('');
    const breadcrumb = document.getElementById('breadcrumb');
    breadcrumb.replaceChildren(directoryLink('Project root', ''));
    const segments = current.path ? current.path.split('/') : [];
    back.href = segments.length ? '#' + encodeURIComponent(segments.slice(0, -1).join('/')) : '../index.html';
    backLabel.textContent = segments.length ? 'Up one level' : 'Back to overview';
    backIcon.hidden = segments.length === 0;
    backHome.hidden = segments.length > 0;
    overview.hidden = !segments.length;
    for (const [index, part] of segments.entries()) {
        breadcrumb.append(' / ', directoryLink(part, segments.slice(0, index + 1).join('/')));
    }
    breadcrumb.lastElementChild.setAttribute('aria-current', 'page');

    const partial = current.partial ? ` · ${countLabel(current.partial, 'file')} with measurement limitations` : '';
    document.getElementById('summary').textContent =
        `Overall line coverage: ${current.covered} / ${current.total} (${percent(current)}) · ${countLabel(current.files, 'file')}${partial}`;
    const search = query.value.trim().toLowerCase();
    const prefix = current.path ? current.path + '/' : '';
    const visible = search
        ? allEntries.filter(entry => entry.path.startsWith(prefix) && entry.path !== current.path && entry.path.toLowerCase().includes(search))
        : children.get(current.path);
    const rows = [...visible].sort(compare).map(entry => {
        const row = element('tr');
        const name = search ? entry.path : entry.path.split('/').at(-1);
        const cell = element('th');
        cell.scope = 'row';
        const icon = element('span', icons[entry.extension] ?? 'DIR');
        icon.className = 'icon ' + (entry.extension ?? 'directory');
        if (!entry.href) icon.setAttribute('aria-label', 'Directory');
        cell.append(icon, entry.href ? link(name, entry.href) : directoryLink(name, entry.path));
        const measurement = entry.partial ? (entry.href ? 'Limited' : `${entry.partial} limited ${entry.partial === 1 ? 'file' : 'files'}`) : '—';
        row.append(cell, element('td', `${entry.covered} / ${entry.total}`), coverageCell(entry), element('td', measurement));
        return row;
    });
    if (!rows.length) {
        const row = element('tr');
        const cell = element('td', search ? 'No matching paths.' : 'No files in this directory.');
        cell.colSpan = 4;
        row.append(cell);
        rows.push(row);
    }
    entries.replaceChildren(...rows);
}

query.addEventListener('input', render);
sort.addEventListener('change', render);
window.addEventListener('hashchange', () => {
    query.value = '';
    render();
});
render();
