// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
// Exercise the elgentos package without invoking its interactive installation
// wizard or copying its global setup into MageLens's isolated fixture.
const directory = '.runtime/elgentos';
fs.mkdirSync(directory, {recursive: true});
fs.cpSync('node_modules/@elgentos/magento2-playwright/tests', `${directory}/base-tests`, {recursive: true});
fs.writeFileSync(`${directory}/tsconfig.json`, JSON.stringify({compilerOptions: {baseUrl: '.',
    paths: {'@base/*': ['./base-tests/*'], '@config': ['./base-tests/config'], '@utils/*': ['./base-tests/utils/*'],
        '@poms/*': ['./base-tests/poms/*'], '@types/*': ['./base-tests/types/*'], '@fixtures/*': ['./base-tests/fixtures/*']}}}, null, 2));
const packageFile = path.join(path.dirname(require.resolve('@vitaliiboiko/magento-template-coverage')), '../package.json');
fs.writeFileSync('.runtime/template-package-version', JSON.parse(fs.readFileSync(packageFile)).version + '\n');

// Only this isolated compatibility installation opts into the external fixture.
fs.writeFileSync(`${directory}/support.cjs`, `const {withCoverage, expect} = require('../../playwright/support.cjs');
const {guestTest} = require('./base-tests/utils/fixtures.utils.ts');
const external = guestTest.extend({externalFixture: async ({}, use) => use('elgentos-guest')});
module.exports = {test: withCoverage(external), expect};
`);
fs.appendFileSync('playwright.config.cjs', `
module.exports.tsconfig = '.runtime/elgentos/tsconfig.json';
`);
