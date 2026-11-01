// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const cache = execFileSync('cypress', ['cache', 'path'], {encoding:'utf8'}).trim();
const root = path.join(cache, '16.2.1/Cypress/resources/app');
console.log('Cypress bootstrap:', fs.readFileSync(path.join(root, 'index.js'), 'utf8'));
console.log('Server entries:', fs.readdirSync(path.join(root, 'packages/server')));
throw new Error('Inspection only: no runner change applied');
