// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {execFileSync} = require('node:child_process');
const {projectFile} = require('./project-path.cjs');
const {buildCoverage} = require(projectFile('bin/combined-report/data.cjs'));
const {writeCombinedReport} = require(projectFile('bin/combined-report/index.cjs'));

const modulePath = 'app/code/Acme/Shop';
const script = modulePath + '/a/item.js';
const duplicate = modulePath + '/b/item.js';
const template = modulePath + "/a/cart #2.phtml";
const blank = modulePath + '/b/static.html';
const missing = modulePath + '/Missing.php';
const vendor = 'vendor/acme/ui/zero.php';
const theme = 'app/design/frontend/Acme/active/view.html';
const excluded = modulePath + '/excluded.js';

function inputs() {
    const source = Array.from({length: 90}, (_, i) => i === 0 ? '<script>unsafeExample()</script>' : '// fixture').join('\n');
    const digest = createHash('sha256').update(source).digest('hex');
    const files = [script, duplicate, template, blank, missing, vendor, theme, excluded, modulePath + '/Test/fixture.php'];
    const run = {roots: ['app/code', 'app/design/frontend/Acme/active', 'vendor/acme/ui'],
        sources: Object.fromEntries(files.map(file => ['src/' + file, digest]))};
    const scripts = [script, duplicate].map(file => ({path: file, coveragePath: '/workspace/src/' + file}));
    const javascript = Object.fromEntries(scripts.map(({coveragePath}, index) => [coveragePath, {
        statementMap: index ? {0: {}} : {
            0: {start: {line: 9}, end: {line: 12}}, 1: {start: {line: 9}}, 2: {start: {line: 10}}
        }, s: index ? {0: 1} : {0: 0, 1: 4, 2: 0}, f: {0: 0}, b: {0: [0, 1]}
    }]));
    const php = {
        [template]: Object.fromEntries(Array.from({length: 8}, (_, i) => [i + 1, Number(i < 7)])),
        [vendor]: Object.fromEntries(Array.from({length: 90}, (_, i) => [i + 1, 0]))
    };
    const observedTemplate = {instrumented: true, status: 'observed', observations: 1, statements: [], functions: [], branches: [], lineHits: {}};
    return {source, run, php, javascript, scope: {included: scripts, excluded: [{path: excluded}]}, templates: {
        records: 1, templates: [
            {...observedTemplate, path: template, lineHits: {2: {hits: 0}, 8: {hits: 3}, 9: {hits: 1}}},
            {...observedTemplate, path: blank},
            {path: theme, instrumented: false, unsupportedDirectives: ['Browser mapping unsupported']}
        ]
    }};
}

test('merged lines and descendant totals preserve mixed source, zero hits and missing measurements', () => {
    const input = inputs();
    const report = buildCoverage(input);
    assert.deepEqual(report.totals, {php: {covered: 7, total: 98}, js: {covered: 1, total: 2}, template: {covered: 2, total: 3}});
    assert.deepEqual(report.overall, {path: '', covered: 10, total: 101, files: 7, partial: 3});
    assert.deepEqual(report.directories.get(modulePath), {path: modulePath, covered: 10, total: 11, files: 5, partial: 2});
    assert.deepEqual(report.directories.get(modulePath + '/a'), {path: modulePath + '/a', covered: 10, total: 11, files: 2, partial: 0});

    const files = new Map(report.files.map(file => [file.path, file]));
    assert.deepEqual([...files.keys()], [missing, template, script, duplicate, blank, theme, vendor]);
    assert.equal(files.get(template).total, 9);
    assert.equal(files.get(template).covered, 9);
    assert.equal(files.get(template).dimensions.php.lines.get(8), 0);
    assert.equal(files.get(template).dimensions.template.lines.get(2), false);
    assert.equal(files.get(template).dimensions.template.lines.get(8), true);
    assert.deepEqual(files.get(script).dimensions.js.native['JavaScript statements'], {covered: 1, total: 3});
    assert.equal(files.get(duplicate).total, 0);
    assert.match(files.get(duplicate).warnings[0], /no original starting line/);
    assert.deepEqual(files.get(blank).warnings, []);
    assert.equal(files.get(blank).total, 0);
    assert.match(files.get(missing).warnings[0], /missing/);
    assert.match(files.get(theme).warnings[0], /unsupported/);
    assert.equal(files.get(vendor).covered, 0);
    assert.equal(files.get(vendor).total, 90);

    input.templates.records = 0;
    const inventory = buildCoverage(input);
    assert.deepEqual(inventory.totals.template, {covered: 0, total: 0});
    assert.match(inventory.files.find(file => file.path === template).warnings[0], /inventory only/);
});

test('the overall percentage weights a small covered file and a large zero-hit file by line count', () => {
    const {run, php} = inputs();
    const small = modulePath + '/Small.php';
    run.sources = {['src/' + small]: '', ['src/' + vendor]: ''};
    php[small] = Object.fromEntries(Array.from({length: 10}, (_, i) => [i + 1, 1]));
    const report = buildCoverage({run, php, javascript: {}, scope: {included: []}, templates: {templates: []}});
    assert.equal(report.overall.covered / report.overall.total, 0.1);
});

if (process.env.MAGELENS_REPORT_CHROME) {
    test('a copied bundle supports offline directory navigation, path search, sorting and source drill-down', t => {
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-combined-'));
        t.after(() => fs.rmSync(temp, {recursive: true, force: true}));
        const input = inputs();
        for (const file of Object.keys(input.run.sources)) {
            const destination = path.join(temp, file);
            fs.mkdirSync(path.dirname(destination), {recursive: true});
            fs.writeFileSync(destination, input.source);
        }
        fs.mkdirSync(path.join(temp, 'coverage'));
        fs.writeFileSync(path.join(temp, 'coverage/run.json'), JSON.stringify(input.run));
        const oldDirectory = process.cwd();
        try {
            process.chdir(temp);
            writeCombinedReport(buildCoverage(input));
        } finally {
            process.chdir(oldDirectory);
        }
        const bundle = path.join(temp, 'copied');
        fs.cpSync(path.join(temp, 'coverage/combined'), bundle, {recursive: true});
        fs.rmSync(path.join(temp, 'coverage'), {recursive: true});
        fs.rmSync(path.join(temp, 'src'), {recursive: true});
        const page = path.join(bundle, 'index.html');
        const html = fs.readFileSync(page, 'utf8');
        const check = function () {
            const check = (condition, message) => { if (!condition) throw new Error(message); };
            const find = label => [...document.querySelectorAll('#entries a')].find(link => link.textContent === label);
            const click = async link => {
                check(link, 'Missing navigation link');
                const changed = new Promise(resolve => window.addEventListener('hashchange', resolve, {once: true}));
                link.click();
                await changed;
            };
            const names = () => [...document.querySelectorAll('#entries a')].map(link => link.textContent);
            const search = value => {
                const query = document.getElementById('query');
                query.value = value;
                query.dispatchEvent(new Event('input'));
            };
            return (async () => {
                const trackFor = label => find(label).closest('tr').querySelector('.coverage-track');
                const emptyFill = trackFor('vendor')?.firstElementChild;
                check(emptyFill?.style.width === '0%' && getComputedStyle(emptyFill).backgroundColor === 'rgb(224, 93, 68)',
                    'Zero coverage has an empty red track');
                const back = document.getElementById('report-back');
                const overview = document.getElementById('report-overview');
                check(back.textContent.includes('Back to overview') && back.getAttribute('href') === '../index.html', 'Root returns to overview');
                check(overview.hidden && overview.getClientRects().length === 0, 'Root hides the duplicate overview link');
                const backHome = back.querySelector('#back-home .home-icon[aria-hidden="true"]');
                const backIcon = back.querySelector('#back-icon');
                check(backHome.getClientRects().length === 1 && backIcon.getClientRects().length === 0, 'Root overview uses a home icon');
                for (const label of ['app', 'code', 'Acme', 'Shop']) await click(find(label));
                check(document.querySelector('[aria-current="page"]').textContent === 'Shop', 'Module breadcrumb');
                check(!overview.hidden && overview.getAttribute('href') === '../index.html', 'Overview shortcut from nested directory');
                check(backIcon.getClientRects().length === 1 && backHome.getClientRects().length === 0, 'Nested back link uses an arrow');
                check(overview.querySelector('svg.home-icon[aria-hidden="true"]')?.getClientRects().length === 1, 'Overview shows a decorative home icon');
                const backBounds = back.getBoundingClientRect();
                const overviewBounds = overview.getBoundingClientRect();
                check(getComputedStyle(overview).borderTopStyle === 'solid' && overviewBounds.height === backBounds.height
                    && overviewBounds.top === backBounds.top && overviewBounds.left > backBounds.right, 'Overview button sits beside Up one level');
                check(document.getElementById('summary').textContent.includes('10 / 11 (90.91%)'), 'Module coverage');
                check(names().join() === 'a,b,Missing.php', 'Name order');
                const directoryTrack = trackFor('a');
                check(directoryTrack?.firstElementChild.style.width === '90.91%'
                    && getComputedStyle(directoryTrack.firstElementChild).backgroundColor === 'rgb(68, 204, 17)', 'Directory track shows high coverage in green');
                check(!trackFor('Missing.php'), 'N/A has no coverage track');
                check(find('b').closest('tr').textContent.includes('1 limited file'), 'Singular limited file label');
                const sort = document.getElementById('sort');
                sort.value = 'ascending';
                sort.dispatchEvent(new Event('change'));
                check(names().join() === 'a,b,Missing.php', 'Low coverage order with N/A last');
                sort.value = 'descending';
                sort.dispatchEvent(new Event('change'));
                check(names().join() === 'a,b,Missing.php', 'High coverage order with N/A last');
                search('item.js');
                check(names().length === 2 && names()[0].endsWith('/a/item.js') && names()[1].endsWith('/b/item.js'), 'Duplicate basenames');
                search('unmatched');
                check(document.getElementById('entries').textContent.includes('No matching paths'), 'Empty search');
                search('');
                await click(find('a'));
                sort.value = 'ascending';
                sort.dispatchEvent(new Event('change'));
                check(names().join() === 'item.js,cart #2.phtml', 'Ascending file coverage');
                sort.value = 'descending';
                sort.dispatchEvent(new Event('change'));
                check(names().join() === 'cart #2.phtml,item.js', 'Descending file coverage');
                const itemFill = trackFor('item.js')?.firstElementChild;
                check(trackFor('cart #2.phtml')?.firstElementChild.style.width === '100%'
                    && itemFill?.style.width === '50%' && getComputedStyle(itemFill).backgroundColor === 'rgb(164, 166, 29)',
                    'File tracks reflect coverage and its color after sorting');
                const source = find('cart #2.phtml');
                check(source.closest('th').querySelector('.phtml'), 'PHTML icon');
                document.body.dataset.source = source.getAttribute('href');
                check(back.textContent.includes('Up one level'), 'Nested back label');
                await click(back);
                check(document.querySelector('[aria-current="page"]').textContent === 'Shop', 'Back link up to module');
                await click(find('a'));
                await click(document.querySelector('#breadcrumb a[aria-current="page"]').previousElementSibling);
                check(document.querySelector('[aria-current="page"]').textContent === 'Shop', 'Breadcrumb back to module');
                document.body.dataset.result = 'passed';
            })().catch(error => { document.body.dataset.result = error.message; });
        };
        fs.writeFileSync(path.join(bundle, 'check.js'), `(${check.toString()})();`);
        fs.writeFileSync(page, html.replace('</body>', '<script src="check.js" defer></script></body>'));
        const open = url => execFileSync(process.env.MAGELENS_REPORT_CHROME, [
            '--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking',
            '--no-first-run', `--user-data-dir=${path.join(temp, 'chrome')}`, '--virtual-time-budget=3000',
            '--dump-dom', url.href
        ], {encoding: 'utf8', timeout: 20000});
        const treeUrl = pathToFileURL(page);
        const dom = open(treeUrl);
        assert.match(dom, /<body[^>]+data-result="passed"/);
        const sourceFile = dom.match(/data-source="(source-\d+\.html)"/)[1];
        const sourceUrl = new URL(sourceFile, treeUrl);
        const sourcePath = path.join(bundle, sourceFile);
        const sourceHtml = fs.readFileSync(sourcePath, 'utf8');
        fs.writeFileSync(sourcePath, sourceHtml.replace('</body>', `<script>
const overviewStyle = getComputedStyle(document.getElementById('report-overview'));
const backStyle = getComputedStyle(document.getElementById('report-back'));
document.body.dataset.overviewStyled = overviewStyle.backgroundColor === backStyle.backgroundColor
    && overviewStyle.borderTopStyle === 'solid';
</script></body>`));
        const source = open(sourceUrl);
        assert.match(source, /<body data-overview-styled="true">/);
        assert.match(source, /PHP executable lines/);
        assert.match(source, /Template executable lines/);
        assert.match(source, /id="L8"[^]*?state uncovered[^]*?state covered/);
        assert.match(source, /&lt;script&gt;unsafeExample\(\)&lt;\/script&gt;/);
        assert.match(source, /href="index\.html#app%2Fcode%2FAcme%2FShop%2Fa">a<\/a>/);
        assert.match(source, /id="back-label">Back to directory<\/span>/);
        assert.match(source, /id="back-icon" aria-hidden="true">←<\/span>/);
        const backHref = source.match(/id="report-back"[^>]+href="([^"]+)"/)[1];
        fs.writeFileSync(page, html);
        const returned = open(new URL(backHref, sourceUrl));
        assert.match(returned, /aria-current="page">a<\/a>/);
        assert.match(returned, /id="entries">.*cart #2\.phtml/s);
    });
}
