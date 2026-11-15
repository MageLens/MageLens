// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Match the options used to reconstruct every checkpoint browser context.
function contextOptions(baseURL, options = {}) {
    return {...options, baseURL, serviceWorkers:'block'};
}
module.exports = {contextOptions};
