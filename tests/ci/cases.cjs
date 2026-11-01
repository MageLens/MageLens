// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const linux = ['magento', 'mageos'].flatMap(platform => ['luma', 'hyva'].flatMap(theme =>
    ['cypress', 'playwright'].map(runner => ({os: 'ubuntu-latest', platform, theme, runner}))));
const cases = [...linux,
    {os: 'macos-26-intel', platform: 'mageos', theme: 'hyva', runner: 'playwright'},
    {os: 'windows-latest', platform: 'mageos', theme: 'luma', runner: 'cypress'}
].map(entry => ({...entry, id: `${entry.os}-${entry.platform}-${entry.theme}-${entry.runner}`}));
module.exports = {cases};
