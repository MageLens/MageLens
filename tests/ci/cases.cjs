// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const cases = ['magento', 'mageos'].flatMap(platform => ['luma', 'hyva'].flatMap(theme =>
    ['cypress', 'playwright'].map(runner => ({
        os: platform === 'mageos' && theme === 'luma' && runner === 'cypress' ? 'windows-latest' : 'ubuntu-latest',
        platform, theme, runner
    })))).map(entry => ({...entry, id: `${entry.os}-${entry.platform}-${entry.theme}-${entry.runner}`}));
module.exports = {cases};
