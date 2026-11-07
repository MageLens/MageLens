// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
// A small project-owned external suite exercises fixture composition and
// TypeScript path aliases without installing third-party test source.
const directory = '.runtime/external-suite';
fs.mkdirSync(`${directory}/fixtures`, {recursive: true});
fs.writeFileSync(`${directory}/fixtures/identity.ts`, `export const identity = 'external-guest';\n`);
fs.writeFileSync(`${directory}/fixtures/guest.ts`, `import {test} from '@playwright/test';
import {identity} from '@external/identity';
export const guestTest = test.extend<{externalFixture: string}>({
    externalFixture: async ({}, use) => use(identity)
});
`);
fs.writeFileSync(`${directory}/tsconfig.json`, JSON.stringify({compilerOptions: {baseUrl: '.',
    paths: {'@external/*': ['./fixtures/*']}}}, null, 2));
const packageFile = path.join(path.dirname(require.resolve('@vitaliiboiko/magento-template-coverage')), '../package.json');
fs.writeFileSync('.runtime/template-package-version', JSON.parse(fs.readFileSync(packageFile)).version + '\n');

// Only this isolated compatibility installation opts into the external fixture.
fs.writeFileSync(`${directory}/support.cjs`, `const {withCoverage, expect} = require('../../playwright/support.cjs');
const {guestTest} = require('./fixtures/guest.ts');
module.exports = {test: withCoverage(guestTest), expect};
`);
fs.appendFileSync('playwright.config.cjs', `
module.exports.tsconfig = '.runtime/external-suite/tsconfig.json';
`);
