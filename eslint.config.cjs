// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
    js.configs.recommended,
    {
        files: ['**/*.{js,cjs,mjs}'],
        languageOptions: {globals: globals.node},
        rules: {'no-unused-vars': ['error', {ignoreRestSiblings: true}]}
    },
    {
        files: ['branching/dashboard/*.{js,mjs}', '**/view/**/web/js/*.js', 'cypress/**/*.js', '**/*.cy.js', '**/Test/Cypress/*.js'],
        languageOptions: {globals: {...globals.browser, ...globals.amd}}
    },
    {
        files: ['cypress/**/*.js', '**/*.cy.js', '**/Test/Cypress/*.js'],
        languageOptions: {globals: {...globals.mocha, cy: 'readonly', Cypress: 'readonly', expect: 'readonly', assert: 'readonly'}}
    },
    {
        files: ['playwright/**/*.cjs', '**/Test/Playwright/*.js', 'tests/**/*.cjs', 'bin/browser-navigation.cjs', '**/Test/storefront-readiness.cjs'],
        languageOptions: {globals: globals.browser}
    },
    {
        files: ['**/view/**/web/js/*.js'],
        languageOptions: {globals: {Alpine: 'readonly'}}
    }
];
