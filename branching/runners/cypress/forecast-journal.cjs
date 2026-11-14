// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const {digest} = require('../../identity.cjs');

function verifyForecastJournal(file, forecasts) {
    const bytes = fs.readFileSync(file, 'utf8');
    if (!bytes.endsWith('\n')) throw new Error('Incomplete Cypress forecast journal');
    const batches = bytes.slice(0,-1).split('\n').map(line => JSON.parse(line));
    if (batches.some(batch => !Array.isArray(batch))) throw new Error('Invalid Cypress forecast journal batch');
    const entries = batches.flat();
    const ids = new Set();
    if (entries.length !== forecasts.length || !forecasts.every(({id,snapshot}, index) => {
        const entry = entries[index];
        if (!entry || ids.has(id) || entry.id !== id || entry.digest !== digest(snapshot)) return false;
        ids.add(id);
        return true;
    })) throw new Error('Cypress forecast journal differs from the prepared snapshots');
}

module.exports = {verifyForecastJournal};
