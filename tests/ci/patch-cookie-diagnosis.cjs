// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {execFileSync} = require('node:child_process');
const cache = execFileSync('cypress', ['cache', 'path'], {encoding:'utf8'}).trim();
const file = path.join(cache, '16.2.1/Cypress/resources/app/packages/proxy/lib/adapters/attach-cross-origin-cookies.js');
const source = fs.readFileSync(file, 'utf8');
console.log('Original adapter SHA256:',createHash('sha256').update(source).digest('hex'));
const old = 'if (!doesTopNeedSimulation) {';
if (source.split(old).length !== 2) throw new Error('Unexpected cookie adapter');
fs.writeFileSync(file, source.replace(old, `if (!doesTopNeedSimulation || (mw.remoteStates.isPrimarySuperDomainOrigin(mw.getAUTUrl()) && new URL(mw.req.proxiedUrl).origin === new URL(mw.getAUTUrl()).origin)) {`));
