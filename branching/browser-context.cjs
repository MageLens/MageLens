// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

async function closePages(context) {
    for (const page of context.pages()) await page.close();
    if (context.pages().length) throw new Error('Browser pages remained after fencing');
}

async function restoreContext(browser, context, storage, options) {
    const created = !context;
    if (context) await closePages(context);
    else context = await browser.newContext({...options, serviceWorkers: 'block'});
    // Pages must be closed first: their DOM, timers, sessionStorage and open
    // IndexedDB handles belong to the previous branch, not the saved state.
    await context.setStorageState(storage ?? {cookies: [], origins: []});
    return {context, created};
}

const storageState = context => context.storageState({indexedDB: true, opfs: true});
module.exports = {closePages, restoreContext, storageState};
