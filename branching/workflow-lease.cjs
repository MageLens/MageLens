// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
function verify(lock, lease) {
    if (lease.lock !== lock || JSON.parse(fs.readFileSync(path.join(lock, 'native-suite.json'))).token !== lease.token) {
        throw new Error('Checkpoint backend does not own the suite workflow lease');
    }
}
function acquire(workspace) {
    const lock = path.join(fs.realpathSync(workspace), '.runtime/workflow.lock');
    const lease = {lock, token: randomUUID()};
    fs.mkdirSync(lock);
    try { fs.writeFileSync(path.join(lock, 'native-suite.json'), JSON.stringify({...lease, pid: process.pid}), {flag:'wx',mode:0o600}); }
    catch (error) { fs.rmdirSync(lock); throw error; }
    return lease;
}
function join(lock, lease) {
    if (lease) verify(lock, lease);
    else fs.mkdirSync(lock);
}
function needsRecovery(lease) {
    verify(lease.lock, lease);
    return fs.existsSync(path.join(lease.lock, 'branching.json')) ||
        fs.existsSync(path.join(path.dirname(lease.lock), 'branching-recovery.json'));
}
function release(lease) {
    // Recovery owns the lock until the application's original state is verified.
    if (needsRecovery(lease)) return false;
    fs.unlinkSync(path.join(lease.lock, 'native-suite.json')); fs.rmdirSync(lease.lock); return true;
}
module.exports = {acquire, join, release, needsRecovery};
