// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// The dynamic-code result is produced by the normally loaded probe.js asset.
async function verifyScriptPolicy(document) {
    const win = document.defaultView;
    const blocked = new Promise(resolve => {
        const listener = event => {
            if (event.blockedURI === 'inline') { finish(true); }
        };
        const finish = value => { clearTimeout(timer); document.removeEventListener('securitypolicyviolation', listener); resolve(value); };
        const timer = setTimeout(() => finish(false), 3000);
        document.addEventListener('securitypolicyviolation', listener);
    });
    const unsigned = document.createElement('script');
    unsigned.textContent = 'window.__magelensUnsignedExecuted = true';
    document.head.append(unsigned); unsigned.remove();
    return {evalBlocked: win.__magelensEvalBlocked, inlineBlocked: await blocked, inlineExecuted: win.__magelensUnsignedExecuted === true};
}
module.exports = {verifyScriptPolicy};
