// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {applyEvent, manifestView} = require('./model.cjs');
const {assertAssessed, readFailure, EstimationError} = require('../estimation.cjs');
const limits = require('../planner/src/limits.json');
const {dashboard, warnings: messages} = require('../configs/dashboard.cjs');
const MAX_JOURNAL_BYTES = dashboard.maxJournalBytes;
function createJournalReader({directory, manifest, revisionFiles, onUpdate}) {
    const journals = new Map();
    const warnings = new Map();
    let manifestText = null,
        assessmentError = null,
        manifestStamp = null,
        version = 0,
        uiRevision,
        assetStamp;
    let scanning,
        rescan = false,
        closing = false;
    // Kept for explicit diagnostic requests. The live stream never reconstructs
    // graphs on the server: it relays appended metadata for browser-side reduction.
    function snapshot() {
        const runs = [],
            problems = [...warnings.values()];
        let plan = null;
        for (const journal of journals.values()) {
            try {
                runs.push(
                    journal.contents
                        .trim()
                        .split('\n')
                        .filter(Boolean)
                        .map(JSON.parse)
                        .reduce(applyEvent, null)
                );
            } catch {
                problems.push(messages.journalInvalid);
            }
        }
        try {
            if (manifestText && !assessmentError) plan = manifestView(JSON.parse(manifestText));
        } catch {
            problems.push(messages.manifestInvalid);
        }
        return {
            version,
            uiRevision,
            runs: runs.filter(Boolean).sort((a, b) => b.startedAt - a.startedAt),
            plan,
            error: assessmentError,
            warnings: problems
        };
    }
    function packet(updates, removed = [], reset = false, manifestChanged = false) {
        return {
            version,
            uiRevision,
            limits,
            reset,
            journals: updates,
            removed,
            ...(reset || manifestChanged ? {manifest: assessmentError ? null : manifestText} : {}),
            error: assessmentError,
            warnings: [...warnings.values()]
        };
    }
    function complete() {
        return packet(
            [...journals.values()].map((j) => ({id: j.id, from: 0, content: j.contents})),
            [],
            true
        );
    }
    async function scanOnce() {
        const previousWarnings = JSON.stringify([...warnings.values()]),
            updates = [],
            removed = [];
        let changed = false,
            manifestChanged = false;
        try {
            const stats = await Promise.all(revisionFiles.map((file) => fs.promises.stat(file)));
            const stamp = stats.map((s) => `${s.ino}:${s.size}:${s.mtimeMs}`).join('|');
            if (stamp !== assetStamp) {
                const hash = createHash('sha256');
                for (const content of await Promise.all(
                    revisionFiles.map((file) => fs.promises.readFile(file))
                ))
                    hash.update(content);
                const revision = hash.digest('hex');
                changed = uiRevision !== revision;
                uiRevision = revision;
                assetStamp = stamp;
            }
            warnings.delete('assets');
        } catch {
            warnings.set('assets', messages.assetsUpdating);
        }
        let names = [];
        try {
            names = (await fs.promises.readdir(directory)).filter((name) =>
                /^[a-f0-9-]{36}\.ndjson$/.test(name)
            );
            warnings.delete('directory');
        } catch (error) {
            if (error.code !== 'ENOENT') warnings.set('directory', messages.directoryUnreadable);
        }
        const files = await Promise.all(
            names.map(async (name) => {
                try {
                    return {name, stat: await fs.promises.lstat(path.join(directory, name))};
                } catch {
                    return null;
                }
            })
        );
        const recent = files
            .filter((row) => row?.stat.isFile())
            .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
            .slice(0, dashboard.maxRuns);
        for (const [name, journal] of journals)
            if (!recent.some((row) => row.name === name)) {
                journals.delete(name);
                warnings.delete(name);
                removed.push(journal.id);
                changed = true;
            }
        for (const {name, stat} of recent) {
            const previous = journals.get(name),
                stamp = `${stat.ino}:${stat.size}:${stat.mtimeMs}`;
            if (previous?.stamp === stamp) continue;
            if (stat.size > MAX_JOURNAL_BYTES) {
                warnings.set(name, messages.journalTooLarge);
                continue;
            }
            try {
                const text = await fs.promises.readFile(path.join(directory, name), 'utf8');
                const contents = text.slice(0, text.lastIndexOf('\n') + 1),
                    id = name.slice(0, -7);
                journals.set(name, {id, stamp, contents});
                warnings.delete(name);
                if (contents === previous?.contents) continue;
                const from =
                    previous && contents.startsWith(previous.contents) ? previous.contents.length : 0;
                updates.push({id, from, content: contents.slice(from)});
                changed = true;
            } catch {
                warnings.set(name, messages.journalUnreadable);
            }
        }
        if (manifest) {
            const previousError = JSON.stringify(assessmentError);
            assessmentError = null;
            try {
                const stat = await fs.promises.lstat(manifest);
                if (!stat.isFile() || stat.size > MAX_JOURNAL_BYTES) throw new Error('Invalid manifest file');
                const stamp = `${stat.mtimeMs}:${stat.size}`;
                if (stamp !== manifestStamp) {
                    manifestText = await fs.promises.readFile(manifest, 'utf8');
                    manifestStamp = stamp;
                    changed = true;
                    manifestChanged = true;
                }
                warnings.delete('manifest');
            } catch (error) {
                if (manifestText) {
                    manifestText = null;
                    changed = true;
                    manifestChanged = true;
                }
                manifestStamp = null;
                if (error.code !== 'ENOENT') assessmentError = new EstimationError([{phase: 'manifest', message: error.message}]).toJSON();
            }
            try {
                const failure = readFailure(manifest);
                if (failure) assessmentError = failure;
                else if (manifestText) assertAssessed(JSON.parse(manifestText));
            } catch (error) {
                assessmentError = (error instanceof EstimationError ? error : new EstimationError([{phase: 'manifest', message: error.message}])).toJSON();
            }
            if (assessmentError) warnings.set('manifest', `500 ESTIMATION_FAILED: ${assessmentError.message} (${assessmentError.issues.length} issues). ${assessmentError.remediation}`);
            else warnings.delete('manifest');
            if (JSON.stringify(assessmentError) !== previousError) { changed = true; manifestChanged = true; }
        }
        if (changed || previousWarnings !== JSON.stringify([...warnings.values()])) {
            version++;
            const update = packet(updates, removed, false, manifestChanged);
            onUpdate(update);
        }
    }
    function scan() {
        if (closing) return Promise.resolve();
        if (scanning) {
            rescan = true;
            return scanning;
        }
        scanning = (async () => {
            do {
                rescan = false;
                await scanOnce();
            } while (rescan && !closing);
        })()
            .catch(() => {
                warnings.set('scan', messages.scanFailed);
            })
            .finally(() => {
                scanning = null;
            });
        return scanning;
    }
    return {
        scan,
        snapshot,
        complete,
        async close() {
            closing = true;
            await scanning;
        }
    };
}
module.exports = {createJournalReader};
