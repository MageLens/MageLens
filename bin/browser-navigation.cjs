function disablePageTransitions(win = window) {
    // An adopted sheet overrides late body rules and works under CSP.
    const sheet = new win.CSSStyleSheet();
    sheet.replaceSync('@view-transition { navigation: none; }');
    win.document.adoptedStyleSheets = [...win.document.adoptedStyleSheets, sheet];
}

module.exports = {disablePageTransitions};
