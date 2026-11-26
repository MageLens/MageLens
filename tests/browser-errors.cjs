// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');

function trackBrowserErrors(page) {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
        const text = message.text();
        if (message.type() === 'warning' && /^Alpine (?:Error|Warning|Expression Error):/.test(text)) errors.push(text);
    });
    return () => assert.equal(errors.length, 0, `Browser errors (${errors.length})\n${errors.slice(0, 3).join('\n')}`);
}

module.exports = {trackBrowserErrors};
