const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync, spawnSync} = require('node:child_process');
const {syncDependencies} = require('../bin/sync-dependencies.cjs');
const root = path.resolve(__dirname, '..');
const yaml = fs.readFileSync(path.join(root, 'dependencies.yaml'), 'utf8');
const configured = key => yaml.match(new RegExp(`^${key}: \"([^\"]+)\"`, 'm'))[1];
const phpVersion = configured('PHP_IMAGE').match(/^php:([0-9]+\.[0-9]+\.[0-9]+)-/)[1];
const phpBase = (version = phpVersion, upstream = configured('MARKSHUST_DOCKER_MAGENTO_VERSION')) => `magelens-php-base:${version}-markshust${upstream}`;
const browserVersions = {
    ISTANBUL_LIB_REPORT_VERSION: '3.0.1',
    ISTANBUL_REPORTS_VERSION: '3.2.0',
    PLAYWRIGHT_VERSION: '1.64.1',
    CYPRESS_VERSION: '16.2.0', TEMPLATE_COVERAGE_VERSION: '1.5.2',
    CYPRESS_CODE_COVERAGE_VERSION: '4.1.0', ISTANBUL_LIB_COVERAGE_VERSION: '3.2.3',
    ISTANBUL_LIB_INSTRUMENT_VERSION: '6.0.4', NYC_VERSION: '18.0.1'
};
const browserPackages = {
    ISTANBUL_LIB_REPORT_VERSION: 'istanbul-lib-report',
    ISTANBUL_REPORTS_VERSION: 'istanbul-reports',
    PLAYWRIGHT_VERSION: '@playwright/test',
    CYPRESS_VERSION: 'cypress', TEMPLATE_COVERAGE_VERSION: '@vitaliiboiko/magento-template-coverage',
    CYPRESS_CODE_COVERAGE_VERSION: '@cypress/code-coverage', ISTANBUL_LIB_COVERAGE_VERSION: 'istanbul-lib-coverage',
    ISTANBUL_LIB_INSTRUMENT_VERSION: 'istanbul-lib-instrument', NYC_VERSION: 'nyc'
};
const select = (content, values) => Object.entries(values).reduce((text, [key, value]) =>
    text.replace(new RegExp(`^${key}:.*$`, 'm'), `${key}: \"${value}\"`), content);

test('committed browser dependencies and locks match the central version settings', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
    const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json')));
    assert.equal(lock.version, manifest.version, 'Release versions must match');
    assert.equal(lock.packages[''].version, manifest.version, 'Root package versions must match');
    const runner = process.env.MAGELENS_RUNNER || 'cypress';
    const selected = Object.entries(browserPackages).filter(([key]) => runner === 'cypress' ? key !== 'PLAYWRIGHT_VERSION' : !['CYPRESS_VERSION', 'CYPRESS_CODE_COVERAGE_VERSION'].includes(key));
    assert.deepEqual(Object.keys(manifest.devDependencies).sort(), selected.map(([, name]) => name).sort());
    for (const [key, name] of selected) {
        const local = key === 'TEMPLATE_COVERAGE_VERSION' && manifest.devDependencies[name] === 'file:.runtime/template-coverage.tgz';
        const expected = local ? manifest.devDependencies[name] : configured(key);
        assert.equal(manifest.devDependencies[name], expected, name);
        assert.equal(lock.packages[''].devDependencies[name], expected, name);
        if (!local) assert.equal(lock.packages[`node_modules/${name}`].version, expected, name);
        else assert.ok(fs.existsSync(path.join(root, '.runtime/template-coverage.tgz')));
    }
});

function workspace(t) {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-test-'));
    t.after(() => fs.rmSync(temporary, {recursive: true, force: true}));
    return temporary;
}

function parse(file, env = {}) {
    return spawnSync('bash', ['-eu', '-c',
        'source "$1"; load_dependencies "$2"; printf "%s\\n" "$MAGENTO_VERSION" "$MAGEOS_VERSION" "$MARKSHUST_DOCKER_MAGENTO_VERSION" "$RUNNER_IMAGE" "$PHP_IMAGE" "$PHP_VERSION"',
        'test', path.join(root, 'bin/dependencies'), file], {encoding: 'utf8', env: {...process.env, ...env}});
}

test('dependency YAML overrides stale environment variables and accepts comments, quotes and CRLF', t => {
    const file = path.join(workspace(t), 'dependencies.yaml');
    fs.writeFileSync(file, yaml.replaceAll('"', "'").replaceAll('\n', '\r\n'));
    const result = parse(file, {MAGENTO_VERSION: '0.0.0', MAGEOS_VERSION: '0.0.0', PHP_IMAGE: 'php:0.0.0-fpm-bookworm', PHP_VERSION: '0.0.0'});
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, [...['MAGENTO_VERSION', 'MAGEOS_VERSION', 'MARKSHUST_DOCKER_MAGENTO_VERSION', 'RUNNER_IMAGE', 'PHP_IMAGE'].map(configured), phpVersion].join('\n') + '\n');
});

test('PHP images require an official exact patch version and accept a pinned digest', t => {
    const file = path.join(workspace(t), 'dependencies.yaml');
    for (const image of ['php:8.4.27-fpm-bookworm', `php:8.4.27-fpm-bookworm@sha256:${'a'.repeat(64)}`]) {
        fs.writeFileSync(file, select(yaml, {PHP_IMAGE: image}));
        const result = parse(file);
        assert.equal(result.status, 0, result.stderr);
        assert.ok(result.stdout.endsWith(`${image}\n8.4.27\n`));
    }
    for (const image of ['php:latest', 'php:8.4-fpm-bookworm', 'php:8.4.27-fpm-alpine', 'php:8.4.27-cli-bookworm',
        'example/php:8.4.27-fpm-bookworm', 'php:8.4.27-fpm-bookworm@sha256:1234']) {
        fs.writeFileSync(file, select(yaml, {PHP_IMAGE: image}));
        const result = parse(file);
        assert.notEqual(result.status, 0, image);
        assert.match(result.stderr, /PHP_IMAGE/);
    }
});

test('dependency YAML rejects missing, duplicate, unknown and unsafe values', t => {
    const file = path.join(workspace(t), 'dependencies.yaml');
    for (const content of [
        yaml.replace(/^PCOV_VERSION:.*\n/m, ''),
        yaml + 'PCOV_VERSION: "2.1.3"\n',
        yaml + 'TYPO_VERSION: "1.2.3"\n',
        select(yaml, {MAGENTO_VERSION: '$(touch /tmp/magelens-must-not-execute)'}),
        select(yaml, {CYPRESS_VERSION: 'latest'}),
        yaml.replace(/^MAGEOS_VERSION:.*\n/m, ''),
        yaml.replace(/^PHP_IMAGE:.*\n/m, ''),
        select(yaml, {MAGEOS_VERSION: '^2.3.0'}),
        ...Object.keys(browserVersions).flatMap(key => [
            yaml.replace(new RegExp(`^${key}:.*\\n`, 'm'), ''),
            select(yaml, {[key]: '^1.0.0'})
        ]),
        yaml.replace(/^CYPRESS_VERSION:.*$/m, 'CYPRESS_VERSION: 16.1.0')
    ]) {
        fs.writeFileSync(file, content);
        const result = parse(file);
        assert.notEqual(result.status, 0, content);
        assert.ok(result.stderr.includes('dependencies.yaml'));
    }
});

test('PHP base rebuild changes only the official base and rejects incompatible upstream recipes', t => {
    const directory = workspace(t);
    for (const file of ['bin/common', 'bin/dependencies', 'bin/build-php-image']) {
        fs.mkdirSync(path.dirname(path.join(directory, file)), {recursive: true});
        fs.copyFileSync(path.join(root, file), path.join(directory, file));
    }
    const image = `php:8.4.27-fpm-bookworm@sha256:${'b'.repeat(64)}`;
    fs.writeFileSync(path.join(directory, 'dependencies.yaml'), select(yaml, {PHP_IMAGE: image}));
    const context = path.join(directory, '.runtime/docker-magento/images/php/8.4');
    fs.mkdirSync(context, {recursive: true});
    const recipe = path.join(context, 'Dockerfile');
    const original = Buffer.from('FROM php:8.4-fpm-bookworm AS base\n# Magento extensions and configuration\nRUN docker-php-ext-install bcmath intl pdo_mysql\nCOPY conf/php.ini /usr/local/etc/php/conf.d/zz-magento.ini\nFROM base AS test\nRUN php --version\n');
    fs.writeFileSync(recipe, original);
    const commands = path.join(directory, 'commands');
    fs.mkdirSync(commands);
    const log = path.join(directory, 'docker.jsonl');
    fs.writeFileSync(path.join(commands, 'docker'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({args, recipe: fs.readFileSync(args[args.indexOf('--file') + 1], 'utf8')}) + '\\n');
`, {mode: 0o755});
    const run = () => spawnSync('bash', ['bin/build-php-image'], {
        cwd: directory, encoding: 'utf8', env: {...process.env, PATH: `${commands}:${process.env.PATH}`}
    });
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(fs.readFileSync(recipe), original, 'Never change the pinned upstream recipe');
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].recipe, original.toString().replace('FROM php:8.4-fpm-bookworm AS base', `FROM ${image} AS base`),
        'Preserve upstream extensions, configuration and later build stages');
    assert.equal(calls[0].args.at(-1), context, 'Build with the upstream context for its configuration files');
    for (const content of [
        null,
        original.toString().replace('php:8.4-fpm-bookworm', 'php:8.5-fpm-bookworm'),
        original.toString().replace('php:8.4-fpm-bookworm', 'php:8.4-fpm-alpine'),
        `${original}FROM php:8.4-fpm-bookworm AS base\n`
    ]) {
        if (content === null) fs.rmSync(recipe);
        else fs.writeFileSync(recipe, content);
        const rejected = run();
        assert.notEqual(rejected.status, 0, 'Reject a missing or incompatible recipe');
        assert.match(rejected.stderr, /no compatible PHP 8\.4 Bookworm base recipe/);
        assert.equal(fs.readFileSync(log, 'utf8').trim().split('\n').length, 1, 'Reject before Docker runs');
        if (content !== null) assert.equal(fs.readFileSync(recipe, 'utf8'), content);
    }
});

function manifests(directory, version = '1.0.0') {
    const dependencies = {...Object.fromEntries(Object.values(browserPackages).map(name => [name, version])), unrelated: '3.0.0'};
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({name: 'fixture', devDependencies: dependencies, nyc: {include: ['keep']}}));
    fs.writeFileSync(path.join(directory, 'package-lock.json'), JSON.stringify({lockfileVersion: 3, packages: {
        '': {devDependencies: dependencies},
        ...Object.fromEntries(Object.entries(dependencies).map(([name, version]) => [`node_modules/${name}`, {version}]))
    }}));
}

test('changing browser versions updates both manifests before npm ci, without changing other settings', t => {
    const directory = workspace(t);
    manifests(directory);
    let resolutions = 0;
    const resolve = (command, args, options) => {
        resolutions++;
        assert.equal(command, 'npm');
        assert.deepEqual(args, ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund']);
        assert.notEqual(options.cwd, directory);
        const manifest = JSON.parse(fs.readFileSync(path.join(options.cwd, 'package.json')));
        const lock = {lockfileVersion: 3, packages: {'': {devDependencies: manifest.devDependencies}}};
        for (const [name, version] of Object.entries(manifest.devDependencies)) lock.packages[`node_modules/${name}`] = {version};
        fs.writeFileSync(path.join(options.cwd, 'package-lock.json'), JSON.stringify(lock));
    };
    const selected = browserVersions;
    assert.equal(syncDependencies(directory, selected, resolve), true);
    const result = JSON.parse(fs.readFileSync(path.join(directory, 'package.json')));
    for (const [key, name] of Object.entries(browserPackages)) assert.equal(result.devDependencies[name], key === 'PLAYWRIGHT_VERSION' ? undefined : selected[key]);
    assert.equal(result.devDependencies.unrelated, '3.0.0');
    assert.deepEqual(result.nyc, {include: ['keep']});
    assert.equal(syncDependencies(directory, selected, resolve), false);
    assert.equal(resolutions, 1, 'An unchanged rerun must not resolve dependencies again');
});

test('failed dependency resolution preserves the working manifest and lock', t => {
    const directory = workspace(t);
    manifests(directory);
    const files = ['package.json', 'package-lock.json'];
    const original = files.map(file => fs.readFileSync(path.join(directory, file), 'utf8'));
    assert.throws(() => syncDependencies(directory,
        browserVersions,
        () => { throw new Error('Registry unavailable'); }), /Registry unavailable/);
    assert.deepEqual(files.map(file => fs.readFileSync(path.join(directory, file), 'utf8')), original);
});

for (const platform of ['magento', 'mageos']) {
for (const [theme, runner] of [['luma', 'cypress'], ['hyva', 'cypress'], ['luma', 'playwright'], ['hyva', 'playwright']]) {
for (const containerOnly of [false, true]) {
test(`installer selects ${platform}/${theme}/${runner} with ${containerOnly ? 'container-only' : 'host'} HTTPS`, t => {
    const directory = workspace(t);
    for (const file of ['install.sh', 'bin/install', 'bin/common', 'bin/compose-project', 'bin/dependencies', 'bin/build-php-image', 'bin/expose-tools', 'bin/application-domain']) {
        fs.mkdirSync(path.dirname(path.join(directory, file)), {recursive: true});
        fs.copyFileSync(path.join(root, file), path.join(directory, file));
    }
    fs.writeFileSync(path.join(directory, 'dependencies.yaml'), select(yaml, {MARKSHUST_DOCKER_MAGENTO_VERSION: '54.0.0', MAGENTO_VERSION: '2.4.9',
        PCOV_VERSION: '2.2.0', PHP_IMAGE: 'php:8.4.27-fpm-bookworm', ...browserVersions,
        RUNNER_IMAGE: 'cypress/base:24.16.0'}));
    const recipe = path.join(directory, '.runtime/docker-magento/images/php/8.4');
    fs.mkdirSync(recipe, {recursive: true});
    fs.writeFileSync(path.join(recipe, 'Dockerfile'), 'FROM php:8.4-fpm-bookworm AS base\nRUN true\nFROM base AS test\nRUN true\n');
    for (const child of ['bin', 'lib', 'env']) fs.mkdirSync(path.join(directory, '.runtime/docker-magento/compose', child), {recursive: true});
    fs.writeFileSync(path.join(directory, '.runtime/docker-magento/compose/bin/status'), '#!/bin/sh\n');
    // Keep the upstream entry points in the installer contract; Docker is mocked below.
    fs.writeFileSync(path.join(directory, '.runtime/docker-magento/compose/bin/setup-composer-auth'), '#!/bin/sh\nexec docker upstream-composer-auth\n');
    fs.writeFileSync(path.join(directory, '.runtime/docker-magento/compose/bin/setup-ssl'), '#!/bin/sh\nexec docker upstream-domain "$@"\n');
    fs.writeFileSync(path.join(directory, '.runtime/docker-magento/compose/bin/clinotty'), '#!/bin/sh\nexec docker compose exec -T phpfpm "$@"\n');
    fs.writeFileSync(path.join(directory, '.runtime/docker-magento/compose/env/local.env'), 'TEST=1\n');
    fs.writeFileSync(path.join(directory, '.runtime/compose.runner.yaml'), 'services:\n  app:\n    ports: !override []\n');
    const commands = path.join(directory, 'commands');
    fs.mkdirSync(commands);
    const log = path.join(directory, 'commands.jsonl');
    const script = `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({command: require('node:path').basename(process.argv[1]), args,
    magento: process.env.MAGENTO_VERSION, pcov: process.env.PCOV_VERSION, phpVersion: process.env.PHP_VERSION,
    platform: process.env.MAGELENS_PLATFORM, platformVersion: process.env.MAGELENS_PLATFORM_VERSION,
    cypress: process.env.CYPRESS_VERSION, templates: process.env.TEMPLATE_COVERAGE_VERSION,
    browserVersions: Object.fromEntries(${JSON.stringify(Object.keys(browserVersions))}.map(key => [key, process.env[key]])),
    project: process.env.COMPOSE_PROJECT_NAME,
    theme: process.env.MAGELENS_THEME, runner: process.env.MAGELENS_RUNNER, php: process.env.MAGELENS_PHP_IMAGE}) + '\\n');
if (args.includes('version')) console.log('2.24.4');
if (args.includes('--print')) console.log('https://shop.magelens.test/');
if (args.includes('--print-viewer')) console.log('https://shop.magelens.test:6080/');
`;
    for (const command of ['docker', 'git', 'sudo']) fs.writeFileSync(path.join(commands, command), script, {mode: 0o755});
    const project = containerOnly ? `client-${platform}-${theme}-${runner}` : 'magelens';
    execFileSync('bash', ['install.sh', ...(platform === 'mageos' ? ['--mageos'] : []), ...(theme === 'hyva' ? ['--hyva'] : []), ...(runner === 'playwright' ? ['--playwright'] : []), ...(containerOnly ? ['--container-only', '--project-name', project] : []), 'shop.magelens.test'],
        {cwd: directory, env: {...process.env, COMPOSE_PROJECT_NAME: '', PATH: `${commands}:${process.env.PATH}`}, stdio: 'pipe'});
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(calls.filter(call => call.command === 'docker' && call.args[0] === 'compose' && !call.args.includes('version')).every(call => call.project === project));
    assert.equal(fs.readFileSync(path.join(directory, '.runtime/compose-project-name'), 'utf8'), project + '\n');
    assert.match(fs.readFileSync(path.join(directory, '.env'), 'utf8'), new RegExp(`^COMPOSE_PROJECT_NAME=${project}$`, 'm'));
    assert.ok(calls.some(call => call.command === 'git' && call.args.includes('refs/tags/54.0.0')));
    const sync = calls.find(call => call.args.includes('bin/sync-dependencies.cjs'));
    const bootstrapImage = runner === 'cypress' ? 'cypress/base:24.16.0' : configured('PLAYWRIGHT_RUNNER_IMAGE');
    const bootstrapPull = calls.find(call => call.command === 'docker' && call.args[0] === 'pull' && call.args[1] === bootstrapImage);
    assert.ok(bootstrapPull && calls.indexOf(bootstrapPull) < calls.indexOf(sync), 'Refresh the selected bootstrap image before synchronizing dependencies');
    assert.ok(sync.args.includes(bootstrapImage), 'Bootstrap must use the selected runner base');
    assert.equal(sync.args[sync.args.indexOf('--pull') + 1], 'never', 'Dependency synchronization must use the successfully pulled image');
    assert.equal(sync.cypress, '16.2.0');
    assert.equal(sync.templates, '1.5.2');
    assert.deepEqual(sync.browserVersions, browserVersions);
    for (const key of Object.keys(browserVersions)) assert.ok(sync.args.includes(key), `Container must receive ${key}`);
    const baseBuild = calls.find(call => call.command === 'docker' && call.args[0] === 'build');
    assert.ok(baseBuild, 'Build the patched official PHP base with the upstream recipe');
    assert.ok(baseBuild.args.includes('--pull'));
    assert.equal(baseBuild.args[baseBuild.args.indexOf('--target') + 1], 'base');
    assert.ok(baseBuild.args.includes(phpBase('8.4.27', '54.0.0')));
    const build = calls.find(call => call.args.includes('compose') && call.args.includes('build') && call.args.includes('phpfpm'));
    const runnerBuild = calls.find(call => call.args.includes('compose') && call.args.includes('build') && call.args.includes('runner'));
    assert.ok(build && runnerBuild);
    assert.ok(calls.indexOf(baseBuild) < calls.indexOf(build), 'Build the local PHP base before its coverage image');
    assert.equal(build.args.includes('--pull'), false, 'The coverage image must reuse the local PHP base');
    assert.ok(runnerBuild.args.includes('--pull'), 'Refresh the published runner base separately');
    assert.equal(build.theme, theme);
    assert.equal(build.runner, runner);
    assert.equal(fs.readFileSync(path.join(directory, '.runtime/install-profile'), 'utf8'), `${theme} ${runner} ${platform}\n`);
    assert.equal(build.platform, platform);
    assert.equal(build.platformVersion, platform === 'mageos' ? configured('MAGEOS_VERSION') : '2.4.9');
    assert.equal(fs.existsSync(path.join(directory, '.runtime/compose.runner.yaml')), false, 'Retire the overlay that hid the Playwright viewer');
    assert.equal(build.magento, '2.4.9');
    assert.equal(build.pcov, '2.2.0');
    assert.equal(build.php, phpBase('8.4.27', '54.0.0'));
    assert.equal(build.phpVersion, '8.4.27');
    assert.ok(calls.indexOf(sync) < calls.indexOf(build));
    const auth = calls.find(call => call.args.includes('upstream-composer-auth'));
    const volumeSetup = calls.find(call => call.args.includes('chown') && call.args.includes('/sock'));
    const phpStart = calls.find(call => call.args.includes('up') && call.args.at(-1) === 'phpfpm');
    assert.ok(volumeSetup && phpStart);
    assert.ok(volumeSetup.args.includes('run') && volumeSetup.args.includes('--no-deps'));
    assert.ok(calls.indexOf(volumeSetup) < calls.indexOf(phpStart), 'Socket ownership must be set before starting non-root PHP');
    assert.ok(phpStart.args.includes('--wait'), 'Wait for the PHP socket before Composer authentication');
    assert.ok(phpStart.args.includes('--force-recreate'), 'Reinstall setup must reset unhealthy containers and stale mounts');
    assert.ok(phpStart.args.includes('--no-deps'), 'Setup must start only PHP-FPM');
    const stoppedWeb = calls.find(call => call.args.includes('stop') && call.args.includes('app') && call.args.includes('phpfpm'));
    assert.ok(stoppedWeb && calls.indexOf(stoppedWeb) < calls.indexOf(volumeSetup), 'Stop web traffic and old FPM before volume initialization');
    assert.equal(Boolean(auth), platform === 'magento', 'Only Magento requires Marketplace authentication');
    const download = calls.find(call => call.args.includes('/application/docker/php/download-magento.sh'));
    const expose = calls.find(call => call.args.includes('run') && call.args.includes('workspace'));
    assert.ok(download && expose);
    if (auth) {
        assert.ok(calls.indexOf(phpStart) < calls.indexOf(auth));
        assert.ok(calls.indexOf(auth) < calls.indexOf(download));
    }
    assert.ok(calls.indexOf(download) < calls.indexOf(expose), 'Source must be downloaded before changing the installation');
    const domain = calls.find(call => call.args.includes('upstream-domain'));
    const certificate = calls.find(call => call.args.some(arg => arg.includes('openssl req')));
    if (containerOnly) {
        assert.equal(domain, undefined);
        assert.ok(!calls.some(call => call.command === 'sudo'));
        assert.ok(certificate?.args.includes('shop.magelens.test'));
        const webStart = calls.find(call => call.args.includes('up') && call.args.at(-1) === 'app');
        assert.ok(calls.indexOf(certificate) > calls.indexOf(expose));
        assert.ok(calls.indexOf(certificate) < calls.indexOf(webStart), 'HTTPS must exist before nginx starts');
    } else {
        assert.deepEqual(domain.args, ['upstream-domain', 'shop.magelens.test']);
        assert.ok(calls.indexOf(domain) > calls.indexOf(expose));
        assert.equal(certificate, undefined);
    }
    assert.match(fs.readFileSync(path.join(directory, '.env'), 'utf8'), /^APPLICATION_DOMAIN=shop\.magelens\.test$/m);
    assert.equal(calls.some(call => call.args.includes('exec') && call.args.includes('runner') && call.args.includes('cypress') && call.args.includes('verify')), runner === 'cypress');
    assert.ok(calls.some(call => call.args.includes('--print-viewer')), 'Every runner advertises the viewer');
    if (runner === 'playwright') assert.ok(calls.some(call => call.args.some(arg => arg.includes('chromium.launch({headless:false})'))));
    assert.equal(fs.readFileSync(path.join(directory, '.runtime/installed'), 'utf8'), '3\n');
});
}
}
}
