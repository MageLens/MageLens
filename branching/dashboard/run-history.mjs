// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

import {$, words, short} from './dom.mjs';

export function renderHistory(data, state) {
    $('latest-run').setAttribute('aria-pressed', String(!state.pinned));
    $('plan-button').hidden = !data.plan;
    const runs = data.runs.map(item => [item.id, `${item.approach} · ${short(item.id)} · ${words(item.status)}`]);
    if (state.selectedRun === 'source-plan') runs.push(['source-plan', 'Source plan']);
    const select = $('run-select');
    const unchanged = runs.length === select.options.length && runs.every(([id, label], index) =>
        select.options[index].value === id && select.options[index].text === label);
    if (!unchanged) select.replaceChildren(...runs.map(([id, label]) => new Option(label, id)));
    if (select.value !== state.selectedRun) select.value = state.selectedRun ?? '';
}
