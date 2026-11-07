// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

import {$, words, short} from './dom.mjs';

export function renderHistory(data, state, onSelect) {
    $('latest-run').setAttribute('aria-pressed', String(!state.pinned));
    $('plan-button').hidden = !data.plan;
    const options = data.runs.map((item) => {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = `${item.approach} · ${short(item.id)} · ${item.status}`;
        return option;
    });
    if (data.plan) {
        const option = document.createElement('option');
        option.value = 'source-plan';
        option.textContent = 'Source plan';
        options.push(option);
    }
    if (!options.length) {
        const option = document.createElement('option');
        option.textContent = 'Waiting for a run';
        options.push(option);
    }
    $('run-select').replaceChildren(...options);
    $('run-select').value = state.selectedRun ?? '';
    $('run-list').replaceChildren(
        ...data.runs.slice(0, 8).map((item) => {
            const button = document.createElement('button');
            button.className = 'run-link';
            button.classList.toggle('selected', item.id === state.selectedRun);
            const title = document.createElement('strong');
            const meta = document.createElement('small');
            title.textContent = `${item.approach} · ${short(item.id)}`;
            meta.textContent = `${item.schedule.length} tests · ${words(item.status)}`;
            button.append(title, meta);
            button.addEventListener('click', () => onSelect(item.id));
            return button;
        })
    );
}
