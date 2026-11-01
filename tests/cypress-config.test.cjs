// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

for (const warmup of [true, false]) {
    test(`Cypress ${warmup ? 'warm-up' : 'collection'} avoids native dictionary downloads without changing browser security`, () => {
        const sandbox = {module: {exports: {}}, process, require(name) {
            if (name === 'cypress') return {defineConfig: config => config};
            if (name === './bin/project.cjs') return {specPatterns: () => []};
            if (name === '@cypress/code-coverage/task') return () => {};
            return require(name);
        }};
        vm.runInNewContext(fs.readFileSync(require.resolve('../cypress.config.cjs'), 'utf8'), sandbox);
        const events = new Map();
        const config = {expose: {warmup}};
        assert.equal(sandbox.module.exports.e2e.setupNodeEvents((name, callback) => events.set(name, callback), config), config);
        const launch = events.get('before:browser:launch');
        const options = {args: ['--existing'], preferences: {width: 1100, webPreferences: {webSecurity: true, preload: '/existing.js'}}};
        assert.equal(launch({name: 'electron'}, options), options);
        assert.equal(options.preferences.webPreferences.spellcheck, false);
        assert.equal(options.preferences.webPreferences.webSecurity, true);
        assert.equal(options.preferences.webPreferences.preload, '/existing.js');
        assert.equal(options.preferences.width, 1100);
        assert.deepEqual(options.args, ['--existing']);
        const chromium = {preferences: {default: {existing: true}}};
        assert.equal(launch({name: 'chrome'}, chromium), chromium);
        assert.deepEqual(chromium, {preferences: {default: {existing: true}}});
        const defaults = {preferences: {}};
        launch({name: 'electron'}, defaults);
        assert.equal(defaults.preferences.webPreferences.spellcheck, false);
    });
}
