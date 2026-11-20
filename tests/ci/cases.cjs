// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const linux = ['magento', 'mageos'].flatMap(platform => ['luma', 'hyva'].flatMap(theme =>
    ['cypress', 'playwright'].map(runner => ({os: 'ubuntu-latest', platform, theme, runner}))));
const windows = {os: 'windows-latest', platform: 'mageos', theme: 'luma', runner: 'cypress'};
const cases = [...linux, windows].map(entry => ({
    ...entry, id: `${entry.os}-${entry.platform}-${entry.theme}-${entry.runner}`
}));
module.exports = {cases};
