// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
async function run() {
    require('../../../docker/runner/cypress-source/provenance.cjs').verifyInstalled();
    if (require('cypress/package.json').version !== process.env.CYPRESS_VERSION) throw new Error('Native Cypress does not match dependencies.yaml');
    const {options, resultFile} = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    const result = await require('cypress').run(options);
    fs.writeFileSync(resultFile, JSON.stringify(result), {mode: 0o600});
    if (result.failures || result.totalFailed || result.status === 'failed') process.exitCode = 1;
}
run().catch(error => { console.error(error); process.exitCode = 1; });
