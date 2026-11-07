// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const protocol = require('./configs/protocol.cjs');

const {allocatedBytes, cleanup} = require('./checkpoint-files.cjs');
const {accounting} = require('./configs/runtime.cjs');

async function cleanupRun({provider, report, measured, errorRecord, emit, directory, run, retain}) {
    emit(protocol.event.runPhase, {phase: 'cleaning'});
    try {
        await measured('cleanup', () => provider.cleanup());
    } catch (error) {
        errorRecord('cleanup', error);
    }
    try {
        await measured('storageAccounting', async () => {
            if (provider.measureStorage) {
                report.storageAccounting = await provider.measureStorage(directory);
                report.metrics.snapshotAllocatedBytes = report.storageAccounting.snapshotAllocatedBytes;
            } else {
                report.storageAccounting = {
                    sumFileAllocatedBytes: allocatedBytes(directory),
                    method: accounting.method
                };
                report.metrics.snapshotAllocatedBytes = null;
            }
        });
    } catch (error) {
        report.metrics.snapshotAllocatedBytes = null;
        errorRecord('accounting', error);
    }
    // Preserve evidence and recovery data if the runtime could not be cleaned up.
    if (!retain && !report.errors.some((error) => error.phase === 'cleanup')) {
        try {
            await measured('cleanup', async () => cleanup(directory, run));
        } catch (error) {
            errorRecord('cleanup', error);
        }
    }
}
module.exports = {cleanupRun};
