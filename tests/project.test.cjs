const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {discover, specPatterns, writeRuntime, withThemeRoots, isCoverageExcluded, warmupPaths} = require('../bin/project.cjs');
const {sourceHashes} = require('../bin/prepare.cjs');

test('warm-up visits the homepage and each fixture page once, without assuming an Admin path', () => {
    assert.deepEqual(warmupPaths({}), ['/']);
    assert.deepEqual(warmupPaths({Blog: {warmupPaths: ['/custom-admin/', '/']},
        Catalog: {warmupPaths: ['/custom-admin/', '/catalog/']}, Other: {id: 1}}),
    ['/', '/custom-admin/', '/catalog/']);
});

test('warm-up rejects malformed lists and paths outside the application origin', () => {
    for (const paths of ['/admin/', [null], [42], ['https://outside.test/'], ['//outside.test/'],
        ['/\\outside.test/'], ['/admin/\n'], ['admin/']]) {
        assert.throws(() => warmupPaths({Blog: {warmupPaths: paths}}), /warmupPaths/);
    }
});

test('coverage exclusions match whole directory names across file types and path separators', () => {
    for (const file of ['Test/fixture.php', 'Setup/Patch/Data/Example.php',
        'app/code/Acme/Blog/Test/Unit/example.js', 'app/code/Acme/Blog/Setup/example.html',
        'app/design/frontend/Acme/shop/Test/example.phtml', 'app/design/adminhtml/Acme/admin/Setup/example.js',
        'C:\\project\\src\\app\\code\\Acme\\Blog\\Test\\fixture.php']) {
        assert.equal(isCoverageExcluded(file), true, file);
    }
    for (const file of ['app/code/Acme/Blog/Test.php', 'app/code/Acme/Blog/Setup.php',
        'app/code/Acme/Blog/TestHelper/example.js', 'app/code/Acme/Blog/SetupTools/example.html']) {
        assert.equal(isCoverageExcluded(file), false, file);
    }
});

function workspace(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-project-'));
    const before = process.cwd();
    process.chdir(root);
    t.after(() => { process.chdir(before); fs.rmSync(root, {recursive: true, force: true}); });
    return root;
}

test('explicit vendor roots support selected Composer themes and modules without including unrelated packages', t => {
    workspace(t);
    for (const root of ['vendor/acme/theme', 'vendor/acme/module/src', 'vendor/other/unused']) fs.mkdirSync(`src/${root}`, {recursive: true});
    fs.writeFileSync('src/vendor/acme/theme/theme.xml', '<theme/>');
    fs.writeFileSync('coverage.config.json', JSON.stringify({vendorRoots: ['vendor/acme/theme', 'vendor/acme/module/src']}));
    assert.deepEqual(withThemeRoots(discover(), ['vendor/acme/theme']).roots, ['vendor/acme/module/src', 'vendor/acme/theme']);
    assert.deepEqual(withThemeRoots(discover(), []).roots, ['vendor/acme/module/src']);
    fs.writeFileSync('coverage.config.json', JSON.stringify({vendorRoots: ['vendor/acme/../../outside']}));
    assert.throws(() => discover(), /Invalid/);
});

test('copied namespaces and both theme areas are discovered without the demonstration module', t => {
    const root = workspace(t);
    fs.cpSync(path.join(__dirname, 'fixtures/todo/module'), `${root}/src/app/code/Vitalii/TodoList`, {recursive: true});
    for (const directory of ['app/code/Magento/Catalog', 'app/design/frontend/Magento/blank',
        'app/design/frontend/Acme/shop', 'app/design/adminhtml/Acme/admin']) fs.mkdirSync(`src/${directory}`, {recursive: true});
    fs.mkdirSync('src/app/code/Magento/Catalog/etc');
    fs.writeFileSync('src/app/code/Magento/Catalog/etc/module.xml', '<config><module name="Magento_Catalog"/></config>');
    const project = discover();
    assert.deepEqual(project.roots, ['app/code', 'app/design/frontend', 'app/design/adminhtml']);
    assert.deepEqual(project.modules, [{name: 'Magento_Catalog', root: 'app/code/Magento/Catalog'}, {name: 'Vitalii_TodoList', root: 'app/code/Vitalii/TodoList'}]);
    assert.deepEqual(specPatterns(), ['cypress/e2e/**/*.cy.js', 'src/app/code/Magento/Catalog/Test/Cypress/**/*.cy.js', 'src/app/code/Vitalii/TodoList/Test/Cypress/**/*.cy.js']);
    writeRuntime(project);
    const services = JSON.parse(fs.readFileSync('.runtime/compose.sources.json')).services;
    const mounts = services.phpfpm.volumes;
    for (const root of project.roots) assert.ok(mounts.some(mount => mount.target === `/var/www/html/${root}` && mount.read_only));
    assert.deepEqual(services.app.volumes, mounts.filter(mount => mount.target.startsWith('/var/www/html/')),
        'Nginx must resolve static symlinks to the same runtime copies as PHP');
    // Removing source must remove it from discovery and the next scope.
    fs.rmSync('src/app/code', {recursive: true});
    writeRuntime(discover());
    assert.ok(!fs.readFileSync('.runtime/compose.sources.json', 'utf8').includes('app/code'));
});

test('all app/code files participate in source fingerprints regardless of namespace or purpose', t => {
    workspace(t);
    const included = ['app/code/root.php', 'app/code/Magento/Local/registration.php',
        'app/code/Magento/Local/Setup/Upgrade.php', 'app/code/Magento/Local/Test/Example.php',
        'app/code/Magento/Local/view/frontend/requirejs-config.js',
        'app/design/frontend/Magento/local/templates/example.phtml'];
    for (const file of [...included, 'vendor/magento/module-example/Example.php']) {
        fs.mkdirSync(path.dirname(`src/${file}`), {recursive: true});
        fs.writeFileSync(`src/${file}`, 'original');
    }
    const original = sourceHashes();
    assert.deepEqual(Object.keys(original).sort(), included.map(file => `src/${file}`).sort());
    fs.writeFileSync('src/app/code/Magento/Local/registration.php', 'changed');
    assert.notEqual(sourceHashes()['src/app/code/Magento/Local/registration.php'], original['src/app/code/Magento/Local/registration.php']);
});

test('source namespace symlinks fail clearly instead of instrumenting external files', t => {
    const root = workspace(t);
    fs.mkdirSync('src/app/code', {recursive: true});
    fs.mkdirSync('external');
    fs.symlinkSync(`${root}/external`, 'src/app/code/External');
    assert.throws(() => discover(), /Symlinked source/);
});

test('coverage follows selected local themes and their parents while runtime mounts stay stable', t => {
    workspace(t);
    const themes = ['app/design/frontend/Client/shop', 'app/design/frontend/Client/base',
        'app/design/frontend/Client/inactive', 'app/design/adminhtml/Client/admin'];
    fs.mkdirSync('src/app/code/Client/Module', {recursive: true});
    fs.writeFileSync('src/app/code/Client/Module/example.php', '<?php echo "module";');
    for (const theme of themes) {
        fs.mkdirSync(`src/${theme}`, {recursive: true});
        fs.writeFileSync(`src/${theme}/theme.xml`, '<theme/>');
    }
    const discovered = discover();
    const project = withThemeRoots(discovered, [themes[0], themes[1], themes[3], themes[0]]);
    assert.deepEqual(project.roots, ['app/code', themes[3], themes[1], themes[0]]);
    const hashes = sourceHashes(project.roots);
    assert.ok(hashes['src/app/code/Client/Module/example.php']);
    assert.ok(hashes[`src/${themes[0]}/theme.xml`]);
    assert.ok(hashes[`src/${themes[1]}/theme.xml`]);
    assert.equal(hashes[`src/${themes[2]}/theme.xml`], undefined);
    writeRuntime(project, discovered.roots);
    const mounts = JSON.parse(fs.readFileSync('.runtime/compose.sources.json')).services.phpfpm.volumes;
    assert.ok(mounts.some(mount => mount.target === '/var/www/html/app/design/frontend'));
    assert.ok(!mounts.some(mount => mount.target.endsWith('/Client/shop')));
    assert.ok(!fs.readFileSync('.runtime/coverage.ini', 'utf8').includes('inactive'));
    assert.deepEqual(withThemeRoots(discovered, []).roots, ['app/code'], 'Composer themes do not add vendor roots');
    for (const invalid of ['vendor/magento/theme-frontend-blank', 'app/design/frontend/Client/../inactive', 'app/design/frontend/Client/missing']) {
        assert.throws(() => withThemeRoots(discovered, [invalid]), /Invalid selected theme/);
    }
});
