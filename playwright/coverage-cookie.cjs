// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const NAME = 'application_coverage';

function coverageCookie(baseURL, runId) {
    if (typeof runId !== 'string' || !/^[a-f0-9]{32}$/.test(runId))
        throw new Error('Expected an active application coverage run ID');
    return {name:NAME, value:runId, domain:new URL(baseURL).hostname, path:'/',
        sameSite:'Lax', httpOnly:true, secure:true};
}

function withoutCoverageCookie(storage) {
    return {...storage, cookies:(storage?.cookies ?? []).filter(cookie => cookie.name !== NAME)};
}

module.exports = {coverageCookie, withoutCoverageCookie};
