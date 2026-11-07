// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {setTimeout: delay} = require('node:timers/promises');
const {regularTree} = require('./storage.cjs');
const {fileDigest} = require('./engine.cjs');

function command(file, args, options = {}) {
    try { return execFileSync(file, args, {encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024, ...options}).trim(); }
    catch (error) { throw new Error(`${path.basename(file)} failed (status ${error.status ?? error.code}): ${String(error.stderr || '').slice(-2000)}`); }
}
function checkpointNginx(source) {
    if (!/\bhttp\s*\{/.test(source)) throw new Error('Expected an nginx HTTP configuration');
    if (/^\s*client_header_timeout\s/m.test(source)) {
        throw new Error('Custom nginx connection timeouts need an explicit checkpoint boundary');
    }
    // Chrome may leave speculative connections without an HTTP request. Bound
    // only their request-header wait, not active requests or graceful shutdown.
    return source.replace(/\bhttp\s*\{/, 'http {\n  client_header_timeout 5s;');
}
async function resumedHealth(inspect, previousProbe, timeout = 30000) {
    const deadline = Date.now() + timeout;
    while (true) {
        const state = inspect().State, probe = state.Health?.Log?.at(-1);
        if (!state.Running || state.Paused || state.OOMKilled) throw new Error('Resumed database is not running safely');
        // Docker intentionally marks health unhealthy when pausing its monitor.
        // Require a new successful probe; a new failed probe is a real failure.
        if (probe && probe.End !== previousProbe) {
            if (probe.ExitCode !== 0) throw new Error('Database health probe failed after unpause');
            if (state.Health.Status === 'healthy') return;
        }
        if (Date.now() >= deadline) throw new Error('Timed out waiting for database health after unpause');
        await delay(100);
    }
}
class MagentoBackend {
    constructor({workspace, helperImage, disposable}) {
        if (disposable !== true) throw new Error('Use a dedicated disposable test installation for branching');
        this.workspace = fs.realpathSync(workspace); this.helperImage = helperImage;
        this.identity = {kind: 'magento-local-file-sessions-v1', implementation: fileDigest(__filename)};
        this.changed = false; this.ownsLock = false; this.paths = {};
    }
    dc(args, original = false) {
        return command('bash', ['-c',
            'source "$1/bin/common"; shift; export LOCAL_UID="${MAGELENS_HOST_UID:-$LOCAL_UID}" LOCAL_GID="${MAGELENS_HOST_GID:-$LOCAL_GID}"; dc "$@"',
            'p0-compose', this.workspace,
            ...(!original && this.override ? ['-f', this.override] : []), ...args
        ], {cwd: this.workspace});
    }
    inspect(service) {
        const id = this.dc(['ps', '-a', '-q', service]);
        if (!/^[a-f0-9]{12,64}$/.test(id)) throw new Error(`Expected exactly one ${service} container`);
        return JSON.parse(command('docker', ['inspect', id]))[0];
    }
    sql(query) {
        return this.dc(['exec', '-T', 'db', 'sh', '-c',
            'exec mariadb -uroot --password="$MYSQL_ROOT_PASSWORD" --batch --skip-column-names magento --execute "$1"', 'p0-sql', query]);
    }
    assertWriters() {
        const ids = this.dc(['ps', '-q']).split('\n').filter(Boolean);
        for (const id of ids) {
            const processes = command('docker', ['top', id, '-eo', 'pid,args']);
            if (/bin\/magento\s+(cron:run|queue:consumers:start)|(?:^|\s)(?:crond|cron)(?:\s|$)/m.test(processes)) {
                throw new Error('Background cron/queue writers need a qualified checkpoint boundary');
            }
        }
    }
    async prepare({run, directory}) {
        this.directory = directory; this.run = run;
        const profile = fs.readFileSync(path.join(this.workspace, '.runtime/install-profile'), 'utf8').trim().split(/\s+/);
        if (profile[1] !== 'playwright') throw new Error('Install this test workspace with --playwright first');
        const recovery = path.join(this.workspace, '.runtime/branching-recovery.json');
        if (fs.existsSync(recovery)) throw new Error('An interrupted branching run needs recovery first');
        this.lock = path.join(this.workspace, '.runtime/workflow.lock');
        fs.mkdirSync(this.lock); this.ownsLock = true;
        fs.writeFileSync(path.join(this.lock, 'branching.json'), JSON.stringify({run, directory}), {mode: 0o600});
        const services = this.dc(['config', '--services']).split('\n');
        if (services.some(name => !['app', 'phpfpm', 'db', 'redis', 'opensearch', 'runner', 'workspace'].includes(name))) {
            throw new Error('Additional services require an explicit checkpoint boundary');
        }
        this.original = Object.fromEntries(['app', 'phpfpm', 'db', 'redis', 'opensearch', 'runner'].map(name => [name, this.inspect(name)]));
        for (const [name, container] of Object.entries(this.original)) {
            if (!container.State.Running || container.State.Paused) throw new Error(`Start ${name} before branching`);
        }
        // Check supported boundaries inside PHP without exposing env.php secrets.
        this.dc(['exec', '-T', 'phpfpm', 'php', '-r',
            '$e=require "app/etc/env.php"; if (($e["db"]["connection"]["default"]["host"]??null)!=="db" || ($e["session"]["save"]??"files")!=="files") {fwrite(STDERR,"P0 requires local db and file sessions\n");exit(1);} foreach (($e["cache"]["frontend"]??[]) as $v) { $s=$v["backend_options"]["server"]??null; if ($s!==null && $s!=="redis") exit(2); }']);
        this.assertWriters();
        const nginx = checkpointNginx(this.dc(['exec', '-T', 'app', 'cat', '/etc/nginx/nginx.conf']));
        const nginxFile = path.join(directory, 'nginx.conf'); fs.writeFileSync(nginxFile, nginx);
        command('docker', ['run', '--rm', '--network', 'none', '--memory', '256m',
            '--volumes-from', `${this.original.app.Id}:ro`, '--mount', `type=bind,source=${nginxFile},target=/etc/nginx/nginx.conf,readonly`,
            '--entrypoint', 'nginx', this.original.app.Image, '-t']);
        for (const relative of ['pub/media', 'var/session']) regularTree(path.join(this.workspace, 'src', relative));
        const active = path.join(directory, 'active'); fs.mkdirSync(active);
        this.paths = {database: path.join(active, 'database'), media: path.join(active, 'media'), session: path.join(active, 'session')};
        const overrideFile = path.join(directory, 'compose.p0.json');
        fs.writeFileSync(recovery, JSON.stringify({run, directory, override: overrideFile,
            project: this.original.db.Config.Labels['com.docker.compose.project']}), {mode: 0o600, flag: 'wx'});
        this.recovery = recovery; this.changed = true;
        await this.drain(); await this.stop();
        // Only initial preparation can cross filesystems. All checkpoints use
        // reflink=always on the private state below the selected storage root.
        command('docker', ['run', '--rm', '--network', 'none', '--memory', '256m', '--user', '0',
            '--volumes-from', `${this.original.db.Id}:ro`, '--mount', `type=bind,source=${active},target=/p0`,
            '--entrypoint', 'cp', this.helperImage, '-a', '--reflink=auto', '/var/lib/mysql', '/p0/database']);
        for (const [relative, name] of [['pub/media', 'media'], ['var/session', 'session']]) {
            command('cp', ['-a', '--reflink=auto', '--', path.join(this.workspace, 'src', relative), this.paths[name]]);
        }
        const cache = path.join(directory, 'php-code-cache'); fs.mkdirSync(cache, {mode: 0o777}); fs.chmodSync(cache, 0o777);
        const ini = path.join(directory, 'p0.ini');
        fs.writeFileSync(ini, 'pcov.enabled=0\nblackfire.apm_enabled=0\nblackfire.apm_enable_automatic_browser_probe=0\nspx.http_enabled=0\nopcache.enable=1\nopcache.file_cache=/p0-code-cache\nopcache.file_cache_consistency_checks=1\nopcache.validate_timestamps=1\nopcache.revalidate_freq=0\n');
        const mount = (source, target, readOnly = false) => ({type: 'bind', source, target, read_only: readOnly, bind: {create_host_path: false}});
        const originalCode = ['app/code', 'app/design/frontend', 'app/design/adminhtml'].map(relative =>
            mount(path.join(this.workspace, 'src', relative), '/var/www/html/' + relative, true));
        const network = Object.entries(this.original.app.NetworkSettings.Networks);
        if (network.length !== 1) throw new Error('P0 expects the single installation network');
        const [networkName, endpoint] = network[0];
        const override = {services: {
            db: {volumes: [mount(this.paths.database, '/var/lib/mysql')]},
            phpfpm: {stop_signal: 'SIGQUIT', stop_grace_period: '60s', volumes: [
                mount(this.paths.media, '/var/www/html/pub/media'), mount(this.paths.session, '/var/www/html/var/session'),
                mount(cache, '/p0-code-cache'), mount(ini, '/usr/local/etc/php/conf.d/zzzz-p0.ini', true), ...originalCode]},
            app: {stop_signal: 'SIGQUIT', stop_grace_period: '60s',
                volumes: [mount(this.paths.media, '/var/www/html/pub/media', true), mount(nginxFile, '/etc/nginx/nginx.conf', true), ...originalCode],
                networks: {default: {ipv4_address: endpoint.IPAddress}}}
        }, networks: {default: {external: true, name: networkName}}};
        this.override = overrideFile;
        fs.writeFileSync(this.override, JSON.stringify(override, null, 2));
        // The original volumes and host media/session directories stay untouched.
    }
    async drain() {
        this.assertWriters();
        for (const service of ['app', 'phpfpm']) {
            const container = this.inspect(service);
            if (!container.State.Running) continue;
            command('docker', ['stop', '--signal', 'SIGQUIT', '--timeout', '60', container.Id]);
            const stopped = this.inspect(service).State;
            if (stopped.Running || stopped.OOMKilled || stopped.ExitCode !== 0) throw new Error(`${service} did not drain cleanly`);
        }
        if (this.inspect('db').State.Running && this.sql('SELECT COUNT(*) FROM information_schema.INNODB_TRX') !== '0') {
            throw new Error('Open database transaction at checkpoint');
        }
    }
    async pause() {
        const state = this.inspect('db').State;
        if (!state.Running || state.Paused || state.OOMKilled || state.Health?.Status !== 'healthy') throw new Error('Database must be healthy before capture');
        this.sql('FLUSH ENGINE LOGS');
        this.dc(['pause', 'db']);
        if (!this.inspect('db').State.Paused) throw new Error('Database freezer did not engage');
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
        this.dc(['stop', '-t', '60', 'db']);
        const state = this.inspect('db').State;
        if (state.Running || state.OOMKilled || state.ExitCode !== 0) throw new Error('Database did not stop cleanly');
        this.awaitingResumedProbe = false;
    }
    async resetCaches() { this.dc(['exec', '-T', 'redis', 'redis-cli', 'FLUSHALL']); }
    async start() {
        const database = this.inspect('db').State;
        if (!database.Running) this.dc(['up', '-d', '--no-deps', '--wait', '--wait-timeout', '180', 'db']);
        else {
            if (database.Paused || database.OOMKilled || (database.Health?.Status === 'unhealthy' && !this.awaitingResumedProbe)) {
                throw new Error(`Retained database is not healthy: paused=${database.Paused}, oom=${database.OOMKilled}, health=${database.Health?.Status}`);
            }
            this.sql('SELECT 1');
        }
        // A snapshot-and-continue capture keeps MariaDB running. Do not ask
        // Compose to recreate or re-start that retained database generation.
        this.dc(['up', '-d', '--no-deps', '--wait', '--wait-timeout', '180', 'phpfpm', 'app']);
        if (this.awaitingResumedProbe) {
            await resumedHealth(() => this.inspect('db'), this.previousProbe);
            this.awaitingResumedProbe = false;
        }
    }
    async cleanup() {
        if (!this.ownsLock) return;
        if (this.changed) {
            // Do not release the lock or delete snapshots if service recovery fails.
            await this.unpause(); await this.drain(); await this.stop();
            this.dc(['up', '-d', '--no-deps', '--force-recreate', '--wait', '--wait-timeout', '180', 'db', 'phpfpm', 'app'], true);
            for (const [service, target] of [['db', '/var/lib/mysql'], ['phpfpm', '/var/www/html']]) {
                const before = this.original[service].Mounts.find(item => item.Destination === target);
                const after = this.inspect(service).Mounts.find(item => item.Destination === target);
                if (!before || !after || before.Source !== after.Source) throw new Error('Original installation mount recovery failed');
            }
            for (const service of ['db', 'phpfpm', 'app']) {
                if (this.inspect(service).Mounts.some(item => item.Source.startsWith(this.directory + path.sep))) {
                    throw new Error('A private run mount remained after recovery');
                }
            }
        }
        if (this.recovery) fs.rmSync(this.recovery);
        fs.rmSync(path.join(this.lock, 'branching.json')); fs.rmdirSync(this.lock); this.ownsLock = false;
    }
}
module.exports = {MagentoBackend, command, checkpointNginx, resumedHealth};
