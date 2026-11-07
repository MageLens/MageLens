// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

import {$, words} from './dom.mjs';

function checkpointLifetime(node, run) {
    if (node.checkpointState === 'released') {
        return 'Checkpoint storage has been cleaned. Its execution history stays in this graph.';
    }
    if (node.checkpointState === 'recovery-required') {
        return 'Cleanup needs recovery. The checkpoint has not been marked as released.';
    }
    if (node.releasePolicy === 'retained') return 'This run retains its checkpoint storage for inspection.';
    if (node.releasePolicy === 'run') return 'Released during final run cleanup.';
    const consumer =
        run.nodes.find((candidate) => candidate.id === node.lastConsumer)?.label ?? 'the last consumer';
    return `Kept until ${consumer} finishes, including a failed last test.`;
}

export function createDetails({getElement}) {
    let activeNode;
    let describedElement;

    function render(run, selection) {
        const {hoveredNode, selectedNode} = selection;
        activeNode = hoveredNode ?? selectedNode;
        const node = run?.nodes.find((n) => n.id === activeNode);
        describedElement?.removeAttribute('aria-describedby');
        describedElement = getElement(activeNode);
        $('node-details').hidden = !node;
        $('node-details').dataset.pinned = String(Boolean(selectedNode));
        $('details').replaceChildren();
        $('last-use').hidden = true;
        $('detail-title').textContent = node?.label ?? '';
        $('detail-description').textContent = node
            ? `${node.id}${node.source ? ` · ${node.source.file}:${node.source.line}` : ''}`
            : '';
        if (!node) return;
        $('detail-kind').textContent = `${node.kind === 'step' ? 'Linear step' : words(node.kind)} details`;
        describedElement?.setAttribute('aria-describedby', 'node-details');
        const fields = [
            ['Type', words(node.kind)],
            ['Status', node.active ? words(node.operation) + ' · active' : words(node.status)],
            ['Checkpoint', words(node.checkpointState)],
            ['Executions / restores', `${node.executions} / ${node.restores}`]
        ];
        if (node.kind !== 'test')
            fields.push(
                ['Remaining consumers', `${node.remaining} / ${node.consumers.length}`],
                ['Last consumer', run.nodes.find((n) => n.id === node.lastConsumer)?.label ?? 'None'],
                ['Release policy', words(node.releasePolicy)]
            );
        if (node.blockedBy) fields.push(['Blocked by', node.blockedBy]);
        if (node.lastError) fields.push(['Failure phase', words(node.lastError)]);
        for (const [title, value] of fields) {
            const group = document.createElement('div');
            const dt = document.createElement('dt');
            const dd = document.createElement('dd');
            dt.textContent = title;
            dd.textContent = value;
            group.append(dt, dd);
            $('details').append(group);
        }
        if (node.kind === 'checkpoint') {
            $('last-use').hidden = false;
            $('last-use').textContent = checkpointLifetime(node, run);
        }
        positionDetails();
    }

    function positionDetails() {
        const el = getElement(activeNode);
        const popup = $('node-details');
        if (!el || popup.hidden) return;
        const rect = el.getBoundingClientRect();
        const left =
            rect.right + popup.offsetWidth + 24 <= innerWidth
                ? rect.right + 12
                : rect.left - popup.offsetWidth - 12;
        popup.style.left = Math.max(8, Math.min(left, innerWidth - popup.offsetWidth - 12)) + 'px';
        popup.style.top = Math.max(8, Math.min(rect.top, innerHeight - popup.offsetHeight - 12)) + 'px';
    }
    return {
        render,
        position: positionDetails
    };
}
