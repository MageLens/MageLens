// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const assert = require('node:assert/strict');
const {spawn, execFileSync} = require('node:child_process');
const {fileDigest} = require('./identity.cjs');
const {settings} = require('./configs/magento.cjs');

function foreignTransactions(transactions, {activeSchema, target, ownedSchemas = []}) {
    const allowed = target && target !== activeSchema && ownedSchemas.includes(target) ? target : null;
    return transactions.filter(t => !(allowed && t.schema === allowed && t.user === 'root' && t.host === 'localhost'));
}

class SchemaDatabase {
    constructor(backend) { this.backend = backend; this.job = null; }
    command(args, options = {}) {
        const b = this.backend;
        return execFileSync('bash', ['-c', settings.composeCommand, 'branching-database', b.workspace,
            ...(b.override ? ['-f', b.override] : []), ...args], {
            cwd: b.workspace, encoding: 'utf8', timeout: settings.commandTimeoutMs,
            maxBuffer: settings.commandMaxBytes, ...options
        });
    }
    dump(file) {
        const fd = fs.openSync(file, 'w', 0o600);
        try {
            this.command(['exec', '-T', 'db', 'sh', '-c',
                'exec mariadb-dump -uroot --password="$MYSQL_ROOT_PASSWORD" --single-transaction --skip-lock-tables --routines --triggers "$1"',
                'snapshot', this.backend.activeSchema], {stdio: ['ignore', fd, 'pipe']});
        } finally { fs.closeSync(fd); }
    }
    prefetch(file) {
        const b = this.backend;
        assert.ok(!this.job, 'Only one inactive schema can be prepared');
        const target = b.schemas.find(schema => schema !== b.activeSchema);
        assert.ok(target && b.ownedSchemas.includes(target), 'Import requires an owned inactive schema');
        const job = {target, key: fileDigest(file), started: performance.now()};
        const fd = fs.openSync(file, 'r');
        let child;
        try {
            child = spawn('bash', ['-c', settings.composeCommand, 'branching-import', b.workspace,
                '-f', b.override, 'exec', '-T', 'db', 'sh', '-c',
                'set -e; mariadb -uroot --password="$MYSQL_ROOT_PASSWORD" --execute "$2"; exec mariadb -uroot --password="$MYSQL_ROOT_PASSWORD" "$1"',
                'restore', target, 'DROP DATABASE `' + target + '`; CREATE DATABASE `' + target + '`;'], {
                cwd: b.workspace, stdio: [fd, 'ignore', 'pipe'], timeout: settings.commandTimeoutMs
            });
        } finally { fs.closeSync(fd); }
        this.job = job;
        // Do not copy SQL or application data into public error messages.
        child.stderr.resume();
        job.promise = new Promise(resolve => {
            child.on('error', error => { job.error = new Error('Inactive-schema import could not start', {cause: error}); });
            child.on('close', code => {
                job.ms = performance.now() - job.started;
                if (code !== 0) job.error ??= new Error('Inactive-schema import failed (exit ' + code + ')');
                resolve();
            });
        });
        b.diagnostics.imports++;
    }
    async consume(file) {
        const b = this.backend, key = fileDigest(file), started = performance.now();
        let job = this.job;
        if (job) {
            await job.promise;
            if (job.error) throw job.error;
            assert.notEqual(job.target, b.activeSchema, 'Never import into the active schema');
            if (job.key !== key) {
                // A failed/expired checkpoint may have caused a replay from an
                // ancestor. Wait for the old import before replacing it.
                this.job = null;
                b.diagnostics.discardedPrefetches++;
                job = null;
            } else { b.diagnostics.prefetchHits++; }
        }
        if (!job) { this.prefetch(file); job = this.job; await job.promise; }
        if (job.error) throw job.error;
        b.switchSchema(job.target);
        this.job = null;
        b.diagnostics.importWaitMs += performance.now() - started;
        b.diagnostics.importWorkMs += job.ms;
    }
    async settle() {
        const job = this.job;
        if (job) await job.promise;
        this.job = null;
        return job?.error;
    }
}
module.exports = {SchemaDatabase, foreignTransactions};
