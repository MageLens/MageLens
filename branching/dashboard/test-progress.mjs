// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

import {$, outcome} from './dom.mjs';

export function createTestProgress({onSelect}) {
    let linearRun;

    function render(run, following) {
        const list = $('test-progress'), scroll = list.scrollTop;
        list.replaceChildren(
            ...run.schedule.map((id, index) => {
                const node = run.nodes.find((n) => n.id === id);
                const active = run.status === 'running' && run.currentSpec === id;
                const status = active && node.status === 'waiting' ? 'running' : node.status;
                const row = document.createElement('li');
                const button = document.createElement('button');
                button.className = 'test-cell';
                button.dataset.test = id;
                button.dataset.status = status;
                if (active) button.setAttribute('aria-current', 'true');
                const title = document.createElement('strong');
                title.textContent = `${index + 1}. ${node.label}`;
                const label = document.createElement('span');
                label.className = 'test-outcome';
                label.textContent = outcome(status);
                if (active) label.textContent = status === 'failed'
                    ? 'Running retry · failed attempt'
                    : `Running · ${run.nodes.find((n) => n.id === node.activeStage)?.label ?? 'test actions'}`;
                const progress = document.createElement('progress');
                progress.max = (node.setup?.length ?? 0) + 1;
                progress.value =
                    node.status === 'passed' ? progress.max : (node.completedStages?.length ?? 0);
                progress.setAttribute('aria-label', `Execution progress: ${node.label}`);
                const detail = document.createElement('small');
                detail.textContent = `${node.completedStages?.length ?? 0}/${node.setup?.length ?? 0} setup stages completed${node.restores ? ' · restored' : ''}`;
                if (run.status === 'planned') {
                    progress.value = 0;
                    detail.textContent = 'Not started';
                }
                button.append(title, label, progress, detail);
                button.addEventListener('click', () => {
                    onSelect(id);
                });
                row.append(button);
                return row;
            })
        );
        list.scrollTop = linearRun === run.id ? scroll : 0;
        linearRun = run.id;
        if (following) followActive();
    }

    function followActive() {
        $('test-progress').querySelector('[aria-current="true"]')?.scrollIntoView({
            block: 'nearest',
            container: 'nearest'
        });
    }
    return {render, followActive};
}
