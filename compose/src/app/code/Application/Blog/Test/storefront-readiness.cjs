// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Observe real Hyva initialization, including asynchronously loaded customer data.
// Assertions must not leave the page before its message sources have completed.
function observeStorefrontReadiness(win = window) {
    const state = {messages: false, privateContent: false};
    win.__magelensStorefrontReady = state;
    win.addEventListener('messages-loaded', () => { state.messages = true; });
    win.addEventListener('private-content-loaded', () => { state.privateContent = true; });
}
// Luma clears the message cookie when its UI component initializes. Let the
// current document finish that work before a form sends a new message.
function lumaMessagesReady(win = window) {
    return Boolean(win.require?.defined?.('uiRegistry') && win.require('uiRegistry').get('messages'));
}
module.exports = {observeStorefrontReadiness, lumaMessagesReady};
