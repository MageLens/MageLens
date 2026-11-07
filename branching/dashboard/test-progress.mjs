// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

import {$, outcome} from './dom.mjs';

export function createTestProgress({onSelect}) {
    let linearRun;

    function render(run, following) {
        $('test-progress').replaceChildren(
            ...run.schedule.map((id, index) => {
                const node = run.nodes.find((n) => n.id === id);
                const active =
                    run.status === 'running' &&
                    run.currentSpec === id &&
                    !['passed', 'failed', 'blocked'].includes(node.status);
                const status = active ? 'running' : node.status;
                const row = document.createElement('li');
                const button = document.createElement('button');
                button.className = 'test-cell';
                button.dataset.test = id;
                button.dataset.status = status;
                const title = document.createElement('strong');
                title.textContent = `${index + 1}. ${node.label}`;
                const label = document.createElement('span');
                label.className = 'test-outcome';
                label.textContent = active
                    ? `Running · ${run.nodes.find((n) => n.id === node.activeStage)?.label ?? 'test actions'}`
                    : outcome(status);
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
        if (linearRun !== run.id) {
            $('test-progress').scrollTop = 0;
            linearRun = run.id;
        }
        if (following && run.status === 'running' && run.currentSpec)
            $('test-progress')
                .querySelector(`[data-test="${CSS.escape(run.currentSpec)}"]`)
                ?.scrollIntoView({
                    block: 'nearest',
                    container: 'nearest'
                });
    }
    return {
        render
    };
}
