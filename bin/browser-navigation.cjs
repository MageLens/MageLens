// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

function disablePageTransitions(win = window) {
    // An adopted sheet overrides late body rules and works under CSP.
    const sheet = new win.CSSStyleSheet();
    sheet.replaceSync('@view-transition { navigation: none; }');
    win.document.adoptedStyleSheets = [...win.document.adoptedStyleSheets, sheet];
}

async function waitForPageCompletion(context) {
    // Keep original-page requests inside collection before fixtures or provider
    // checks close the page. This barrier is shared by native and replay suites.
    for (const page of context.pages()) {
        if (!page.isClosed()) await page.waitForLoadState('networkidle', {timeout: 30000});
    }
}

module.exports = {disablePageTransitions, waitForPageCompletion};
