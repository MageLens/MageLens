// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const messages = require('./configs/messages.cjs');

const fs = require('node:fs');
const path = require('node:path');
const {command} = require('./command.cjs');
const {checkpointNginx} = require('./magento-health.cjs');
const {
    settings,
    installationValidation,
    phpConfiguration,
    composeOverride
} = require('./configs/magento.cjs');
const {regularTree} = require('./storage.cjs');
async function prepareWorkspace(backend, {run, directory}) {
    backend.directory = directory;
    backend.run = run;
    const profile = fs
        .readFileSync(path.join(backend.workspace, settings.installProfile), 'utf8')
        .trim()
        .split(/\s+/);
    if (profile[1] !== 'playwright') throw new Error(messages.installThisTestWorkspaceWithPlaywrightFirst);
    const recovery = path.join(backend.workspace, settings.recovery);
    if (fs.existsSync(recovery)) throw new Error(messages.anInterruptedBranchingRunNeedsRecoveryFirst);
    backend.lock = path.join(backend.workspace, settings.lock);
    fs.mkdirSync(backend.lock);
    backend.ownsLock = true;
    fs.writeFileSync(path.join(backend.lock, settings.lockOwner), JSON.stringify({run, directory}), {
        mode: 0o600
    });
    const services = backend.dc(['config', '--services']).split('\n');
    if (services.some((name) => !settings.allowedServices.includes(name))) {
        throw new Error(messages.additionalServicesRequireAnExplicitCheckpointBoundary);
    }
    backend.original = Object.fromEntries(settings.services.map((name) => [name, backend.inspect(name)]));
    for (const [name, container] of Object.entries(backend.original)) {
        if (!container.State.Running || container.State.Paused)
            throw new Error(messages.startBeforeBranching(name));
    }
    // Check supported boundaries inside PHP without exposing env.php secrets.
    backend.dc(['exec', '-T', 'phpfpm', 'php', '-r', installationValidation]);
    backend.assertWriters();
    const nginx = checkpointNginx(backend.dc(['exec', '-T', 'app', 'cat', settings.nginx]));
    const nginxFile = path.join(directory, 'nginx.conf');
    fs.writeFileSync(nginxFile, nginx);
    command('docker', [
        'run',
        '--rm',
        '--network',
        'none',
        '--memory',
        settings.helperMemory,
        '--volumes-from',
        `${backend.original.app.Id}:ro`,
        '--mount',
        `type=bind,source=${nginxFile},target=/etc/nginx/nginx.conf,readonly`,
        '--entrypoint',
        'nginx',
        backend.original.app.Image,
        '-t'
    ]);
    for (const relative of settings.mutableDirectories.map(([relative]) => relative))
        regularTree(path.join(backend.workspace, settings.source, relative));
    const active = path.join(directory, settings.active);
    fs.mkdirSync(active);
    backend.paths = {
        database: path.join(active, 'database'),
        media: path.join(active, 'media'),
        session: path.join(active, 'session')
    };
    const overrideFile = path.join(directory, settings.override);
    fs.writeFileSync(
        recovery,
        JSON.stringify({
            run,
            directory,
            override: overrideFile,
            project: backend.original.db.Config.Labels['com.docker.compose.project']
        }),
        {mode: 0o600, flag: 'wx'}
    );
    backend.recovery = recovery;
    backend.changed = true;
    await backend.drain();
    await backend.stop();
    // Only initial preparation can cross filesystems. All checkpoints use
    // reflink=always on the private state below the selected storage root.
    command('docker', [
        'run',
        '--rm',
        '--network',
        'none',
        '--memory',
        settings.helperMemory,
        '--user',
        '0',
        '--volumes-from',
        `${backend.original.db.Id}:ro`,
        '--mount',
        `type=bind,source=${active},target=/branching`,
        '--entrypoint',
        'cp',
        backend.helperImage,
        '-a',
        '--reflink=auto',
        settings.database,
        '/branching/database'
    ]);
    for (const [relative, name] of settings.mutableDirectories) {
        command('cp', [
            '-a',
            '--reflink=auto',
            '--',
            path.join(backend.workspace, settings.source, relative),
            backend.paths[name]
        ]);
    }
    const cache = path.join(directory, settings.codeCache);
    fs.mkdirSync(cache, {mode: 0o777});
    fs.chmodSync(cache, 0o777);
    const ini = path.join(directory, settings.phpIni);
    fs.writeFileSync(ini, phpConfiguration);
    const network = Object.entries(backend.original.app.NetworkSettings.Networks);
    if (network.length !== 1) throw new Error(messages.singleNetworkRequired);
    const [networkName, endpoint] = network[0];
    const override = composeOverride({
        paths: backend.paths,
        workspace: backend.workspace,
        cache,
        ini,
        nginxFile,
        networkName,
        endpoint
    });
    backend.override = overrideFile;
    fs.writeFileSync(backend.override, JSON.stringify(override, null, 2));
    // The original volumes and host media/session directories stay untouched.
}
module.exports = {prepareWorkspace};
