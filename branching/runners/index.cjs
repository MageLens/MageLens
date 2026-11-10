// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const adapters = Object.freeze({
    playwright: Object.freeze({id: 'playwright', implemented: true, image: 'branching-playwright', baseImage: 'runner-playwright', context: 'branching/runners/playwright'}),
    cypress: Object.freeze({id: 'cypress', implemented: true, image: 'branching-cypress', baseImage: 'runner-cypress', context: 'branching/runners/cypress'})
});
function descriptor(name) {
    const adapter = adapters[name];
    if (!adapter) throw new Error(`Unknown branching runner: ${name}`);
    if (!adapter.implemented) throw new Error(`Branching for ${name} is not implemented yet. Use the normal linear run without --branching.`);
    return adapter;
}
function loadRunner(name) { descriptor(name); return require(`./${name}/adapter.cjs`); }
module.exports = {adapters, descriptor, loadRunner};
