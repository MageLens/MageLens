// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
async function run() {
    require('../../../docker/runner/cypress-source/provenance.cjs').verifyInstalled();
    const options = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    const result = await require('cypress').run(options);
    const good = result.totalTests === 1 && result.totalPassed === 1 && !result.totalFailed && !result.totalPending && !result.totalSkipped && !result.failures;
    if (!good) throw new Error(`Cypress checkpoint queue failed: ${result.message ?? result.status}`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
