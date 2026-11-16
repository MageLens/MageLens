// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

function disablePageTransitions(win = window) {
    // An adopted sheet overrides late body rules and works under CSP.
    const sheet = new win.CSSStyleSheet();
    sheet.replaceSync('@view-transition { navigation: none; }');
    win.document.adoptedStyleSheets = [...win.document.adoptedStyleSheets, sheet];
}

const braintreeScript = /\/PayPal_Braintree\/js\/system\.js(?:\?.*)?$/;

function adminScriptDependencies(source) {
    // PayPal_Braintree 4.8.0 uses Prototype's Array.each without requiring it.
    // Fix only the browser-delivered copy, preserving source bytes and lines.
    // Remove this adapter once the supported upstream script declares Prototype.
    const call = /\brequire\s*\(\s*\[([^\]]*)\]\s*,\s*function\s*\(/.exec(source);
    const dependencies = call?.[1].split(',').map(value => value.trim()).filter(Boolean)
        .map(value => /^(['"])(.*?)\1$/.exec(value)?.[2]);
    const expected = ['jquery', 'Magento_Ui/js/modal/alert', 'mage/translate', 'domReady!'];
    if (!dependencies || dependencies.filter(value => value !== 'prototype').join('\0') !== expected.join('\0')) {
        throw new Error('Unsupported Braintree Admin dependency declaration; review the compatibility adapter.');
    }
    if (dependencies.includes('prototype')) return source;
    const end = call.index + call[0].indexOf('[') + 1 + call[1].length;
    return source.slice(0, end) + (/[,]\s*$/.test(call[1]) ? " 'prototype'" : ", 'prototype'") + source.slice(end);
}

function installCypressAdminDependencies(browser = cy) {
    browser.intercept({url: braintreeScript, middleware: true}, request => {
        request.on('before:response', response => {
            if (response.statusCode === 200) response.body = adminScriptDependencies(response.body);
        });
    });
}

async function installPlaywrightAdminDependencies(context) {
    // Playwright routing disables HTTP caching for the entire context. A narrow
    // Chrome response hook leaves caching and all other requests alone.
    const pages = new Map();
    const failures = [];
    const install = async page => {
        const session = await context.newCDPSession(page);
        session.on('Fetch.requestPaused', async response => {
            try {
                if (response.responseStatusCode !== 200 || !braintreeScript.test(response.request.url)) {
                    await session.send('Fetch.continueResponse', {requestId: response.requestId});
                    return;
                }
                const result = await session.send('Fetch.getResponseBody', {requestId: response.requestId});
                const source = result.base64Encoded ? Buffer.from(result.body, 'base64').toString('utf8') : result.body;
                const body = Buffer.from(adminScriptDependencies(source));
                const headers = response.responseHeaders.filter(header => !['content-encoding', 'content-length', 'cache-control', 'etag', 'last-modified'].includes(header.name.toLowerCase()));
                headers.push({name: 'Content-Length', value: String(body.length)}, {name: 'Cache-Control', value: 'no-store'});
                await session.send('Fetch.fulfillRequest', {requestId: response.requestId, responseCode: 200,
                    responseHeaders: headers, body: body.toString('base64')});
            } catch (error) {
                failures.push(error);
                try { await session.send('Fetch.failRequest', {requestId: response.requestId, errorReason: 'Failed'}); }
                catch { /* Closing a page can already have disposed its request. */ }
            }
        });
        await session.send('Fetch.enable', {patterns: [{urlPattern: '*/PayPal_Braintree/js/system.js*', requestStage: 'Response'}]});
    };
    const track = page => {
        if (!pages.has(page)) pages.set(page, install(page));
        return pages.get(page);
    };
    const opened = page => { track(page).catch(error => failures.push(error)); };
    const newPage = context.newPage;
    context.on('page', opened);
    context.newPage = async function (...args) { const page = await newPage.apply(this, args); await track(page); return page; };
    await Promise.all(context.pages().map(track));
    return () => {
        context.off('page', opened);
        context.newPage = newPage;
        if (failures.length) throw new Error('Braintree Admin dependency response hook failed.', {cause: failures[0]});
    };
}

module.exports = {disablePageTransitions, adminScriptDependencies, installCypressAdminDependencies, installPlaywrightAdminDependencies};
