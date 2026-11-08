// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {command} = require('./command.cjs');
const {settings} = require('./configs/magento.cjs');
const {checkpointNginx} = require('./magento-health.cjs');
const {regularTree} = require('./storage.cjs');
const {join} = require('./workflow-lease.cjs');

async function prepareRetained(backend, {run, directory}) {
    const b = backend;
    assert.match(run, /^[a-f0-9-]{36}$/);
    b.run = run; b.directory = directory;
    const profile = fs.readFileSync(path.join(b.workspace, settings.installProfile), 'utf8').trim().split(/\s+/);
    assert.equal(profile[1], 'playwright', 'Install the Playwright runner first');
    const recovery = path.join(b.workspace, settings.recovery);
    assert.ok(!fs.existsSync(recovery), 'An interrupted branching run needs recovery');
    b.lock = path.join(b.workspace, settings.lock);
    join(b.lock, b.workflowLease); b.ownsLock = true;
    fs.writeFileSync(path.join(b.lock, settings.lockOwner), JSON.stringify({run, directory}), {mode: 0o600});
    assert.ok(b.dc(['config', '--services']).split('\n').every(s => settings.allowedServices.includes(s)), 'Additional services require a checkpoint adapter');
    b.original = Object.fromEntries(settings.services.map(s => [s, b.inspect(s)]));
    for (const [service, container] of Object.entries(b.original)) {
        assert.ok(container.State.Running && !container.State.Paused && !container.State.OOMKilled, 'Start ' + service + ' before branching');
    }
    b.databaseStartedAt = b.original.db.State.StartedAt;
    b.assertWriters();
    const validate = fs.readFileSync(path.join(__dirname, 'configs/retained-validate.php'), 'utf8').replace(/^<\?php\s*/, '');
    b.dc(['exec', '-T', 'phpfpm', 'php', '-r', validate]);
    const fpm = b.dc(['exec', '-T', 'phpfpm', 'cat', '/usr/local/etc/php-fpm.conf']);
    assert.match(fpm, /pm.max_children\s*=\s*1\s*(?:\n|$)/, 'Retained branching currently requires one PHP worker');
    b.originalGrants = b.grantIdentity();
    b.schemas = ['a', 'b'].map(s => 'ml_' + run.replaceAll('-', '') + '_' + s);
    const inventory = b.controlSql('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA').split('\n');
    assert.ok(b.schemas.every(s => !inventory.includes(s)), 'Run schema already exists');
    b.control = path.join(directory, 'control'); fs.mkdirSync(b.control);
    for (const name of ['fastcgi.php', 'retained-probe.php', 'retained-env.php', 'retained-queues.php']) {
        fs.copyFileSync(path.join(__dirname, 'configs', name), path.join(b.control, name));
    }
    fs.writeFileSync(path.join(b.control, 'schemas.json'), JSON.stringify(['magento', ...b.schemas]));
    fs.writeFileSync(path.join(b.control, 'original-grants.txt'), b.originalGrants, {mode: 0o600});
    const environment = path.join(b.workspace, 'src/app/etc/env.php'); regularTree(environment);
    const savedEnvironment = path.join(b.control, 'original-env.php');
    fs.copyFileSync(environment, savedEnvironment); fs.chmodSync(savedEnvironment, 0o600);
    const owner = fs.statSync(environment); fs.chownSync(savedEnvironment, owner.uid, owner.gid);
    b.switchSchema('magento');
    fs.writeFileSync(path.join(b.control, 'php-fpm.conf'), fpm + '\npm.status_path = /branching-status\npm.status_listen = /sock/branching-status.sock\npm.max_requests = 0\n');
    const nginx = checkpointNginx(b.dc(['exec', '-T', 'app', 'cat', settings.nginx]));
    const nginxFile = path.join(b.control, 'nginx.conf'); fs.writeFileSync(nginxFile, nginx);
    command('docker', ['run', '--rm', '--network', 'none', '--memory', settings.helperMemory,
        '--volumes-from', b.original.app.Id + ':ro', '--mount', 'type=bind,source=' + nginxFile + ',target=' + settings.nginx + ',readonly',
        '--entrypoint', 'nginx', b.original.app.Image, '-t']);
    const active = path.join(directory, 'active'); fs.mkdirSync(active);
    b.paths = {database: path.join(active, 'database'), media: path.join(active, 'media'), session: path.join(active, 'session')};
    fs.mkdirSync(b.paths.database);
    const mount = (source, target, readOnly = false) => ({type: 'bind', source, target, read_only: readOnly, bind: {create_host_path: false}});
    const code = settings.codeDirectories.map(relative => mount(path.join(b.workspace, 'src', relative), settings.application + '/' + relative, true));
    const networks = Object.entries(b.original.app.NetworkSettings.Networks); assert.equal(networks.length, 1);
    const [networkName, endpoint] = networks[0];
    const override = path.join(directory, 'compose.retained.json');
    fs.writeFileSync(override, JSON.stringify({services: {
        phpfpm: {stop_signal: 'SIGQUIT', stop_grace_period: '60s', volumes: [
            mount(b.paths.media, settings.application + '/pub/media'), mount(b.paths.session, settings.application + '/var/session'),
            mount(b.control, '/branching-control', true), mount(path.join(b.control, 'retained-env.php'), settings.application + '/app/etc/env.php', true),
            mount(path.join(b.control, 'php-fpm.conf'), '/usr/local/etc/php-fpm.conf', true), ...code]},
        app: {stop_signal: 'SIGQUIT', stop_grace_period: '60s', volumes: [mount(b.paths.media, settings.application + '/pub/media', true),
            mount(nginxFile, settings.nginx, true), ...code], networks: {default: {ipv4_address: endpoint.IPAddress}}}
    }, networks: {default: {external: true, name: networkName}}}, null, 2));
    fs.writeFileSync(recovery, JSON.stringify({run, directory, override, kind: 'retained-two-schema',
        project: b.original.db.Config.Labels['com.docker.compose.project'], schemas: b.schemas,
        grantsBefore: path.join(b.control, 'original-grants.txt')}), {flag: 'wx', mode: 0o600});
    b.recovery = recovery; b.changed = true;
    // Suite-boundary remount only. The original DB stays online and untouched.
    await b.drain();
    for (const [relative, name] of settings.mutableDirectories) {
        const source = path.join(b.workspace, settings.source, relative); regularTree(source);
        command('cp', ['-a', '--reflink=auto', '--', source, b.paths[name]]);
    }
    for (const schema of b.schemas) {
        b.controlSql('CREATE DATABASE `' + schema + '`;'); b.ownedSchemas.push(schema);
        b.controlSql("GRANT ALL ON `" + schema.replaceAll('_', '\\_') + "`.* TO 'magento'@'%';");
    }
    b.database.dump(path.join(b.paths.database, 'snapshot.sql'));
    b.override = override;
}
module.exports = {prepareRetained};
