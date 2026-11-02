// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
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
module.exports = {observeStorefrontReadiness};
