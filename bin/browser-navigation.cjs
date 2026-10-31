// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

function disablePageTransitions(win = window) {
    // An adopted sheet overrides late body rules and works under CSP.
    const sheet = new win.CSSStyleSheet();
    sheet.replaceSync('@view-transition { navigation: none; }');
    win.document.adoptedStyleSheets = [...win.document.adoptedStyleSheets, sheet];
}

module.exports = {disablePageTransitions};
