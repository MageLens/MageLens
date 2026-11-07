// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const messages = require('./configs/messages.cjs');

const {settings} = require('./configs/magento.cjs');

const fs = require('node:fs');
const path = require('node:path');
const {implementationDigest} = require('./identity.cjs');
const {command} = require('./command.cjs');
const {checkpointNginx, resumedHealth} = require('./magento-health.cjs');
const {prepareWorkspace} = require('./magento-workspace.cjs');

class MagentoBackend {
    constructor({workspace, helperImage, disposable, workflowLease}) {
        if (disposable !== true) throw new Error(messages.requiresDisposableInstallation);
        this.workspace = fs.realpathSync(workspace);
        this.helperImage = helperImage;
        this.workflowLease = workflowLease;
        this.identity = {
            kind: settings.implementation,
            implementation: implementationDigest(
                [
                    './magento.cjs',
                    './magento-workspace.cjs',
                    './magento-health.cjs',
                    './command.cjs',
                    './configs/magento.cjs',
                    './configs/validate-installation.php',
                    './configs/branching.ini'
                ].map((file) => require.resolve(file))
            )
        };
        this.changed = false;
        this.ownsLock = false;
        this.paths = {};
    }
    dc(args, original = false) {
        return command(
            'bash',
            [
                '-c',
                settings.composeCommand,
                'branching-compose',
                this.workspace,
                ...(!original && this.override ? ['-f', this.override] : []),
                ...args
            ],
            {cwd: this.workspace}
        );
    }
    inspect(service) {
        const id = this.dc(['ps', '-a', '-q', service]);
        if (!/^[a-f0-9]{12,64}$/.test(id)) throw new Error(messages.expectedExactlyOneContainer(service));
        return JSON.parse(command('docker', ['inspect', id]))[0];
    }
    sql(query) {
        return this.dc(['exec', '-T', 'db', 'sh', '-c', settings.sqlCommand, 'branching-sql', query]);
    }
    assertWriters() {
        const ids = this.dc(['ps', '-q']).split('\n').filter(Boolean);
        for (const id of ids) {
            const processes = command('docker', ['top', id, '-eo', 'pid,args']);
            if (
                /bin\/magento\s+(cron:run|queue:consumers:start)|(?:^|\s)(?:crond|cron)(?:\s|$)/m.test(
                    processes
                )
            ) {
                throw new Error(messages.backgroundWriters);
            }
        }
    }
    async prepare(context) {
        return prepareWorkspace(this, context);
    }
    async drain() {
        this.assertWriters();
        for (const service of settings.applicationServices) {
            const container = this.inspect(service);
            if (!container.State.Running) continue;
            command('docker', [
                'stop',
                '--signal',
                'SIGQUIT',
                '--timeout',
                settings.stopSeconds,
                container.Id
            ]);
            const stopped = this.inspect(service).State;
            if (stopped.Running || stopped.OOMKilled || stopped.ExitCode !== 0)
                throw new Error(messages.didNotDrainCleanly(service));
        }
        if (this.inspect('db').State.Running && this.sql(settings.queries.transactions) !== '0') {
            throw new Error(messages.openDatabaseTransactionAtCheckpoint);
        }
    }
    async pause() {
        const state = this.inspect('db').State;
        if (!state.Running || state.Paused || state.OOMKilled || state.Health?.Status !== 'healthy')
            throw new Error(messages.databaseMustBeHealthyBeforeCapture);
        this.sql(settings.queries.flush);
        this.dc(['pause', 'db']);
        if (!this.inspect('db').State.Paused) throw new Error(messages.databaseFreezerDidNotEngage);
        command('sync', ['-f', this.paths.database]);
    }
    async unpause() {
        const state = this.inspect('db').State;
        if (state.Paused) {
            this.previousProbe = state.Health?.Log?.at(-1)?.End;
            this.awaitingResumedProbe = true;
            this.dc(['unpause', 'db']);
        }
    }
    async stop() {
        await this.unpause();
        this.dc(['stop', '-t', settings.stopSeconds, 'db']);
        const state = this.inspect('db').State;
        if (state.Running || state.OOMKilled || state.ExitCode !== 0)
            throw new Error(messages.databaseDidNotStopCleanly);
        this.awaitingResumedProbe = false;
    }
    async resetCaches() {
        this.dc(['exec', '-T', 'redis', 'redis-cli', 'FLUSHALL']);
    }
    async start() {
        const database = this.inspect('db').State;
        if (!database.Running)
            this.dc(['up', '-d', '--no-deps', '--wait', '--wait-timeout', settings.waitSeconds, 'db']);
        else {
            if (
                database.Paused ||
                database.OOMKilled ||
                (database.Health?.Status === 'unhealthy' && !this.awaitingResumedProbe)
            ) {
                throw new Error(
                    messages.retainedDatabaseUnhealthy(
                        database.Paused,
                        database.OOMKilled,
                        database.Health?.Status
                    )
                );
            }
            this.sql(settings.queries.health);
        }
        // A snapshot-and-continue capture keeps MariaDB running. Do not ask
        // Compose to recreate or re-start that retained database generation.
        this.dc(['up', '-d', '--no-deps', '--wait', '--wait-timeout', settings.waitSeconds, 'phpfpm', 'app']);
        if (this.awaitingResumedProbe) {
            await resumedHealth(() => this.inspect('db'), this.previousProbe);
            this.awaitingResumedProbe = false;
        }
    }
    async cleanup() {
        if (!this.ownsLock) return;
        if (this.changed) {
            // Do not release the lock or delete snapshots if service recovery fails.
            await this.unpause();
            await this.drain();
            await this.stop();
            this.dc(
                [
                    'up',
                    '-d',
                    '--no-deps',
                    '--force-recreate',
                    '--wait',
                    '--wait-timeout',
                    settings.waitSeconds,
                    'db',
                    'phpfpm',
                    'app'
                ],
                true
            );
            for (const [service, target] of [
                ['db', settings.database],
                ['phpfpm', settings.application]
            ]) {
                const before = this.original[service].Mounts.find((item) => item.Destination === target);
                const after = this.inspect(service).Mounts.find((item) => item.Destination === target);
                if (!before || !after || before.Source !== after.Source)
                    throw new Error(messages.originalInstallationMountRecoveryFailed);
            }
            for (const service of settings.recoveryServices) {
                if (
                    this.inspect(service).Mounts.some((item) =>
                        item.Source.startsWith(this.directory + path.sep)
                    )
                ) {
                    throw new Error(messages.aPrivateRunMountRemainedAfterRecovery);
                }
            }
        }
        if (this.recovery) fs.rmSync(this.recovery);
        fs.rmSync(path.join(this.lock, settings.lockOwner));
        if (!this.workflowLease) fs.rmdirSync(this.lock);
        this.ownsLock = false;
    }
}
module.exports = {MagentoBackend, command, checkpointNginx, resumedHealth};
