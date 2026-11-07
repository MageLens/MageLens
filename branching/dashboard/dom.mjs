// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

export const $ = (id) => document.getElementById(id);
export const words = (value) => (value ?? '—').replaceAll('-', ' ');
export const short = (value) => value.slice(0, 8);

export function outcome(status) {
    const labels = {
        passed: '✓ Passed',
        failed: '✕ Failed',
        blocked: '✕ Blocked'
    };
    return labels[status] ?? words(status);
}
