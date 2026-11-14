// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {setTimeout: delay} = require('node:timers/promises');
const {MagentoBackend} = require('./magento.cjs');
const {SchemaDatabase, foreignTransactions} = require('./retained-database.cjs');
const {prepareRetained} = require('./retained-workspace.cjs');
const {implementationDigest} = require('./identity.cjs');
const {settings} = require('./configs/magento.cjs');
const {command} = require('./command.cjs');

class RetainedMagentoBackend extends MagentoBackend {
    constructor(options) {
        super(options);
        this.retainsServices = true;
        this.identity = {kind: 'magento-retained-two-schema-v1', base: this.identity, implementation: implementationDigest([
            __filename, ...['retained-workspace.cjs', 'retained-database.cjs', 'configs/retained-env.php',
                'configs/retained-validate.php', 'configs/retained-probe.php', 'configs/retained-queues.php', 'configs/fastcgi.php'].map(file => require.resolve('./' + file))
        ])};
        this.database = new SchemaDatabase(this);
        this.ownedSchemas = []; this.activeSchema = 'magento';
        this.warmReady = false; this.ingressPaused = false;
        this.containers = new Map();
        this.diagnostics = {imports: 0, prefetchHits: 0, discardedPrefetches: 0, importWaitMs: 0, importWorkMs: 0,
            schemaSwitches: 0, queueDrains: [], continuityChecks: 0};
    }
    containerId(service) {
        if (!this.containers.has(service)) {
            const id = super.dc(['ps', '-a', '-q', service]);
            assert.match(id, /^[a-f0-9]{12,64}$/, 'Expected exactly one retained service container');
            this.containers.set(service, id);
        }
        return this.containers.get(service);
    }
    dc(args, original = false) {
        if (['up', 'down', 'rm', 'create', 'restart'].includes(args[0])) this.containers.clear();
        const service = args[0] === 'exec' && args[1] === '-T' ? args[2] : args[1];
        if (!original && this.warmReady && settings.services.includes(service) &&
            ((args[0] === 'exec' && args[1] === '-T') || (['pause', 'unpause'].includes(args[0]) && args.length === 2))) {
            const id = this.containerId(service);
            return command('docker', args[0] === 'exec' ? ['exec', id, ...args.slice(3)] : [args[0], id], {cwd: this.workspace});
        }
        const result = super.dc(args, original);
        if (this.warmReady && args.length === 2 && args[0] === 'ps' && args[1] === '-q') {
            const active = new Set(result.split('\n'));
            for (const id of this.containers.values()) assert.ok(active.has(id), 'Retained service container was replaced');
        }
        return result;
    }
    inspect(service) {
        if (!this.warmReady) return super.inspect(service);
        return JSON.parse(command('docker', ['inspect', this.containerId(service)]))[0];
    }
    controlSql(query) {
        return this.dc(['exec', '-T', 'db', 'sh', '-c',
            'exec mariadb -uroot --password="$MYSQL_ROOT_PASSWORD" --batch --skip-column-names --execute "$1"', 'branching-control', query]);
    }
    sql(query) {
        return this.dc(['exec', '-T', 'db', 'sh', '-c',
            'exec mariadb -uroot --password="$MYSQL_ROOT_PASSWORD" --batch --skip-column-names "$1" --execute "$2"',
            'branching-query', this.activeSchema, query]);
    }
    grantIdentity() { return this.controlSql("SELECT * FROM mysql.db WHERE User='magento' ORDER BY Host,Db,User"); }
    prepare(info) { return prepareRetained(this, info); }
    switchSchema(schema) {
        assert.ok(schema === 'magento' || this.ownedSchemas.includes(schema), 'Unowned schema switch');
        const file = path.join(this.control, 'active-schema');
        fs.writeFileSync(file + '.pending', schema + '\n'); fs.renameSync(file + '.pending', file);
        this.activeSchema = schema; this.diagnostics.schemaSwitches++;
    }
    fcgi(status = false) {
        return JSON.parse(this.dc(['exec', '-T', 'phpfpm', 'php', '/branching-control/fastcgi.php',
            status ? '/sock/branching-status.sock' : '/sock/phpfpm.sock',
            status ? '/branching-status' : '/branching-control/retained-probe.php',
            status ? '/branching-status' : '/branching-probe.php', status ? 'json&full' : '']));
    }
    async idle() {
        const deadline = Date.now() + settings.healthTimeoutMs;
        while (true) {
            const state = this.fcgi(true);
            if (state['active processes'] === 0 && state['listen queue'] === 0) return;
            if (Date.now() >= deadline) throw new Error('PHP workers did not drain');
            await delay(50);
        }
    }
    async drainQueues() {
        const drained = JSON.parse(this.dc(['exec', '-T', 'phpfpm', 'php', '/branching-control/retained-queues.php']));
        this.diagnostics.queueDrains.push(...drained);
    }
    async databaseIdle(timeoutMs = settings.healthTimeoutMs) {
        const started = Date.now(), deadline = started + timeoutMs;
        let wait;
        while (true) {
            const transactions = JSON.parse(this.sql("SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT('schema',p.DB,'user',p.USER,'host',p.HOST)),JSON_ARRAY()) FROM information_schema.INNODB_TRX t LEFT JOIN information_schema.PROCESSLIST p ON p.ID=t.trx_mysql_thread_id"));
            const connections = this.sql("SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE USER='magento'");
            const foreign = foreignTransactions(transactions, {activeSchema:this.activeSchema,
                target:this.database.job?.target,ownedSchemas:this.ownedSchemas});
            if (!foreign.length && connections === '0') {
                if (wait) wait.ms = Date.now()-started;
                return;
            }
            if (Date.now() >= deadline) {
                if (foreign.length) throw new Error('Unfinished database transactions at checkpoint');
                assert.equal(connections, '0', 'Application DB connection crossed a checkpoint boundary');
            }
            if (!wait) {
                wait = {connections,foreignTransactions:foreign.length,ms:0};
                (this.diagnostics.databaseDrainWaits ??= []).push(wait);
            }
            wait.ms = Date.now()-started;
            await delay(50);
        }
    }
    async drain() {
        if (!this.warmReady) return super.drain();
        this.assertWriters();
        if (!this.ingressPaused) { this.dc(['pause', 'app']); this.ingressPaused = true; }
        await this.idle(); await this.drainQueues();
        // An idle PHP worker and a completed queue process do not prove that
        // MariaDB has processed their connection teardown yet. Drain both
        // transactions and connections before allowing a snapshot or switch.
        await this.databaseIdle();
    }
    async pause() { this.database.dump(path.join(this.paths.database, 'snapshot.sql')); }
    async unpause() {} // MariaDB is never frozen in this backend.
    async stop() { this.needsImport = true; }
    prefetch(file) { return this.database.prepare(file); }
    async start() {
        assert.equal(this.inspect('db').State.StartedAt, this.databaseStartedAt, 'Database restarted during branching');
        if (this.needsImport) {
            await this.database.consume(path.join(this.paths.database, 'snapshot.sql')); this.needsImport = false;
        }
        if (!this.warmReady) {
            this.dc(['up', '-d', '--no-deps', '--wait', '--wait-timeout', settings.waitSeconds, 'phpfpm', 'app']);
            this.warmReady = true; this.phpStartedAt = this.inspect('phpfpm').State.StartedAt;
        }
        const proof = this.fcgi();
        assert.equal(proof.schema, this.activeSchema, 'PHP connected to the wrong schema');
        assert.equal(proof.persistent, false, 'Persistent DB connections cannot cross checkpoints');
        if (this.workerPid !== undefined) assert.equal(proof.pid, this.workerPid, 'PHP worker restarted during branching');
        else this.workerPid = proof.pid;
        assert.equal(this.inspect('phpfpm').State.StartedAt, this.phpStartedAt, 'PHP container restarted during branching');
        this.diagnostics.continuityChecks++;
        if (this.ingressPaused) { this.dc(['unpause', 'app']); this.ingressPaused = false; }
    }
    async cleanup() {
        if (!this.ownsLock) return;
        const importError = await this.database.settle();
        if (this.ingressPaused) { this.dc(['unpause', 'app']); this.ingressPaused = false; }
        this.warmReady = false;
        if (this.changed) {
            await super.drain();
            this.dc(['up', '-d', '--no-deps', '--force-recreate', '--wait', '--wait-timeout', settings.waitSeconds, 'phpfpm', 'app'], true);
            this.activeSchema = 'magento';
            for (const schema of this.ownedSchemas) {
                this.controlSql("REVOKE ALL PRIVILEGES ON `" + schema.replaceAll('_', '\\_') + "`.* FROM 'magento'@'%'; DROP DATABASE `" + schema + '`;');
            }
            assert.equal(this.grantIdentity(), this.originalGrants, 'Temporary database grants were not recovered');
            assert.equal(this.inspect('db').State.StartedAt, this.databaseStartedAt, 'Database restarted during cleanup');
            for (const service of settings.recoveryServices) {
                assert.ok(!this.inspect(service).Mounts.some(m => m.Source.startsWith(this.directory + path.sep)), 'Private mount remained after cleanup');
            }
            // Redis may contain entries generated against the discarded schema.
            await this.resetCaches();
            this.diagnostics.schemasRemoved = true; this.diagnostics.grantsRestored = true;
        }
        if (this.recovery) fs.rmSync(this.recovery);
        fs.rmSync(path.join(this.lock, settings.lockOwner));
        if (!this.workflowLease) fs.rmdirSync(this.lock);
        this.ownsLock = false;
        if (importError) throw importError;
    }
}
module.exports = {RetainedMagentoBackend};
