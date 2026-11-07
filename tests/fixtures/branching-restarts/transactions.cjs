// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

function foreignTransactions(transactions, {activeSchema, target, ownedSchemas = []}) {
    const allowed = target && target !== activeSchema && ownedSchemas.includes(target) ? target : null;
    return transactions.filter(transaction => !(allowed && transaction.schema === allowed &&
        transaction.user === 'root' && transaction.host === 'localhost'));
}
module.exports = {foreignTransactions};
