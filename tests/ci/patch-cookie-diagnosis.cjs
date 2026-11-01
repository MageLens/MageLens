// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {execFileSync} = require('node:child_process');
const cache = execFileSync('cypress', ['cache', 'path'], {encoding:'utf8'}).trim();
const file = path.join(cache, '16.2.1/Cypress/resources/app/packages/proxy/lib/adapters/attach-cross-origin-cookies.js');
if (!fs.existsSync(file)) {
  const root = path.join(cache, '16.2.1/Cypress/resources/app');
  console.log('Packaged app entries:', fs.readdirSync(root));
  function inspect(dir) {
    for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules') inspect(file);
      else if (entry.isFile() && entry.name.endsWith('.js')) {
        const code = fs.readFileSync(file, 'utf8');
        const index = code.indexOf('should cookies be attached to request?');
        if (index >= 0) console.log('Cookie source:', file, 'SHA256:',createHash('sha256').update(code).digest('hex'), code.slice(Math.max(0,index - 1800), index + 1000));
      }
    }
  }
  inspect(root);
  process.exit(1);
}
const source = fs.readFileSync(file, 'utf8');
console.log('Original adapter SHA256:',createHash('sha256').update(source).digest('hex'));
const old = 'if (!doesTopNeedSimulation) {';
if (source.split(old).length !== 2) throw new Error('Unexpected cookie adapter');
fs.writeFileSync(file, source.replace(old, `if (!doesTopNeedSimulation || (mw.remoteStates.isPrimarySuperDomainOrigin(mw.getAUTUrl()) && new URL(mw.req.proxiedUrl).origin === new URL(mw.getAUTUrl()).origin)) {`));
