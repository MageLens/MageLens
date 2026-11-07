// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const protocol = require('./configs/protocol.cjs');

const messages = require('./configs/messages.cjs');

const config = require('./configs/runtime.cjs');

const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {canonical, digest} = require('./identity.cjs');
const {sync, write, inventory} = require('./checkpoint-files.cjs');
class CheckpointStore {
    constructor(root, owner, profile) {
        this.root = root;
        this.owner = owner;
        this.profile = profile;
        this.available = new Map();
    }
    verify(ref, key, now = Date.now()) {
        const manifest = JSON.parse(fs.readFileSync(path.join(ref.directory, config.files.manifest), 'utf8'));
        if (
            manifest.schemaVersion !== 1 ||
            digest(manifest) !== ref.digest ||
            manifest.status !== protocol.status.available ||
            manifest.owner !== this.owner ||
            manifest.key !== key ||
            manifest.profile !== this.profile ||
            manifest.expiresAt <= now
        )
            throw new Error(messages.incompleteExpiredOrIncompatibleCheckpoint);
        const actual = inventory(path.join(ref.directory, config.files.payload));
        // Allocated blocks can change independently of content on CoW filesystems.
        const content = (entries) => entries.map(({allocatedBytes, ...entry}) => entry);
        if (canonical(content(actual)) !== canonical(content(manifest.artifacts)))
            throw new Error(messages.corruptedCheckpoint);
        return manifest;
    }
    release(stage) {
        const ref = this.available.get(stage);
        if (!ref) return null;
        if (path.dirname(ref.directory) !== this.root || fs.lstatSync(ref.directory).isSymbolicLink())
            throw new Error(messages.unownedCheckpointDirectory);
        const manifest = JSON.parse(fs.readFileSync(path.join(ref.directory, config.files.manifest), 'utf8'));
        if (manifest.owner !== this.owner || manifest.id !== ref.id || digest(manifest) !== ref.digest)
            throw new Error(messages.unownedCheckpoint);
        fs.rmSync(ref.directory, {recursive: true});
        this.available.delete(stage);
        return ref.id;
    }
    async capture({key, stage, parent, lineage, ttlMs, provider, measured, assert, fault}) {
        const id = randomUUID(),
            pending = path.join(this.root, id + config.files.pendingSuffix),
            directory = path.join(this.root, id);
        fs.mkdirSync(pending, {mode: 0o700});
        fs.mkdirSync(path.join(pending, config.files.payload), {mode: 0o700});
        write(path.join(pending, config.files.operation), {
            owner: this.owner,
            id,
            stage,
            status: protocol.status.capturing
        });
        await measured('barrier', () =>
            provider.captureBarrier ? provider.captureBarrier() : provider.barrier()
        );
        const expected = await provider.normalizedState();
        await measured('capture', () => provider.capture(path.join(pending, config.files.payload)));
        await fault?.('captured', {directory: pending});
        const artifacts = await measured('hashingDurability', async () => {
            const entries = inventory(path.join(pending, config.files.payload));
            if (!entries.length) throw new Error(messages.emptyCheckpoint);
            for (const entry of entries) sync(path.join(pending, config.files.payload, entry.path));
            sync(path.join(pending, config.files.payload));
            return entries;
        });
        const deferred = typeof provider.resumeCapture === 'function';
        await measured(deferred ? 'resumeOriginal' : 'validation', async () => {
            if (deferred) await provider.resumeCapture();
            else await provider.restore(path.join(pending, config.files.payload));
            await assert(provider);
            if (canonical(await provider.normalizedState()) !== canonical(expected))
                throw new Error(messages.restoredStateMismatch);
        });
        await fault?.('validated', {directory: pending});
        const manifest = {
            schemaVersion: 1,
            id,
            owner: this.owner,
            profile: this.profile,
            key,
            stage,
            parent,
            lineage,
            status: protocol.status.available,
            artifacts,
            ...(deferred
                ? {
                      restoreValidation: config.checkpoint.restoreValidation,
                      expectedStateDigest: digest(expected)
                  }
                : {}),
            createdAt: Date.now(),
            expiresAt: Date.now() + ttlMs
        };
        const ref = {id, directory, digest: digest(manifest)};
        await measured('publication', async () => {
            write(path.join(pending, config.files.manifest), manifest);
            sync(pending);
            fs.renameSync(pending, directory);
            sync(this.root);
        });
        this.available.set(stage, ref);
        return ref;
    }
}

module.exports = {CheckpointStore};
