// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs/promises');
const path = require('node:path');
const {parentPort, workerData: options} = require('node:worker_threads');
let file, pending = [], flushing, scheduled, failed = false;
async function closeFile() { const handle = file; file = null; if (handle) await handle.close(); }
async function fail() {
    if (failed) return; failed = true; pending = [];
    parentPort.postMessage({type: 'error'});
    try { await closeFile(); } catch { /* The journal failure has already been reported to the parent. */ }
    parentPort.close();
}
const ready = (async () => {
    if (!options.directory) return;
    await fs.mkdir(options.directory, {recursive: true, mode: 0o700});
    if ((await fs.lstat(options.directory)).isSymbolicLink()) throw new Error('Journal directory is a symlink');
    file = await fs.open(path.join(options.directory, options.run + '.ndjson'), 'wx', 0o600);
    const uid = Number(options.uid), gid = Number(options.gid);
    if (Number.isSafeInteger(uid) && Number.isSafeInteger(gid)) {
        await fs.chown(options.directory, uid, gid); await file.chown(uid, gid);
    }
})().catch(fail);
function flush() {
    if (flushing) return flushing;
    flushing = (async () => {
        await ready;
        while (pending.length && !failed) {
            const batch = pending; pending = [];
            if (file) await file.writeFile(batch.map(e => e.encoded).join('\n') + '\n');
            parentPort.postMessage({type: 'written', count: batch.length, bytes: batch.reduce((sum, e) => sum + e.bytes, 0),
                ...(options.callback ? {entries: batch.map(e => e.encoded)} : {})});
        }
    })().catch(fail).finally(() => { flushing = null; });
    return flushing;
}
parentPort.on('message', message => {
    if (failed) return;
    if (message.type === 'close') {
        clearImmediate(scheduled);
        void flush().then(closeFile).then(() => parentPort.close()).catch(fail);
    } else {
        pending.push(message);
        if (!scheduled) scheduled = setImmediate(() => { scheduled = null; void flush(); });
    }
});
