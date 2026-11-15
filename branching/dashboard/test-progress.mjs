// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

import {$, outcome, testTitle} from './dom.mjs';

export function createTestProgress({onSelect}) {
    let linearRun;

    function render(run, following) {
        const list = $('test-progress'), scroll = list.scrollTop;
        const focusedTest = list.contains(document.activeElement) && document.activeElement.dataset.test;
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
                title.textContent = `${index + 1}. ${testTitle(node.label)}`;
                button.title = node.label;
                const label = document.createElement('span');
                label.className = 'test-outcome';
                label.textContent = outcome(status);
                if (active) {
                    const stage = run.nodes.find((n) => n.id === node.activeStage && n.active);
                    label.textContent = status === 'failed' ? 'Running retry · failed attempt'
                        : stage ? `Running · ${stage.label}` : 'Running';
                }
                const progress = document.createElement('progress');
                progress.max = (node.setup?.length ?? 0) + 1;
                progress.value =
                    node.status === 'passed' ? progress.max : (node.completedStages?.length ?? 0);
                progress.setAttribute('aria-label', `Execution progress: ${node.label}`);
                const detail = document.createElement('small');
                detail.textContent = `${node.completedStages?.length ?? 0}/${node.setup?.length ?? 0} setup stages completed${node.restoredStages?.length ? ' · checkpoint restored' : ''}`;
                if (run.status === 'planned') progress.value = 0;
                button.append(title, label);
                if (node.setup?.length || active) button.append(progress);
                if (node.setup?.length && run.status !== 'planned') button.append(detail);
                button.addEventListener('click', () => {
                    onSelect(id);
                });
                row.append(button);
                return row;
            })
        );
        list.scrollTop = linearRun === run.id ? scroll : 0;
        if (focusedTest && linearRun === run.id)
            list.querySelector(`[data-test="${CSS.escape(focusedTest)}"]`)?.focus({preventScroll:true});
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
