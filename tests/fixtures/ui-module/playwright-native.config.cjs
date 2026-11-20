// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const config = require('../../../playwright.config.cjs');
module.exports = {
    ...config,
    testDir: '.',
    testMatch: 'native.spec.js',
    reporter: 'json',
    outputDir: '../../../coverage/playwright-ui-native-artifacts'
};
