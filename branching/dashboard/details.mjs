// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

import {$, words} from './dom.mjs';

function checkpointLifetime(node, run) {
    if (node.releaseReason === 'uneconomic') return node.reuseState === 'abandoned' ? 'Reuse abandoned after verified reset. Remaining tests execute normally.' : 'Storage released; verified reset has not completed.';
    if (['candidate', 'measuring', 'linear'].includes(node.checkpointState)) return 'No checkpoint storage has been captured.';
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
        const expanded = Boolean(node && node.id === selectedNode);
        $('node-details').dataset.pinned = String(expanded);
        $('details').replaceChildren();
        $('last-use').hidden = true;
        $('detail-title').textContent = node?.label ?? '';
        $('detail-description').textContent = node?.source
            ? node.source.file + (node.source.line > 0 ? ':' + node.source.line : '') : '';
        if (!node) return;
        $('detail-kind').textContent = `${describedElement.dataset.type} details`;
        describedElement?.setAttribute('aria-describedby', 'node-details');
        const current = run.status === 'running' && run.currentSpec === node.id;
        const fields = [['Status', node.active ? words(node.operation) + ' · active'
            : current ? 'Running' : words(node.status)]];
        if (node.kind === 'checkpoint') {
            fields.push(['Checkpoint', words(node.checkpointState)],
                ['Remaining consumers', `${node.remaining} / ${node.consumers.length}`]);
            if (expanded) fields.push(['Executions / restores', `${node.executions} / ${node.restores}`],
                ['Last consumer', run.nodes.find((n) => n.id === node.lastConsumer)?.label ?? 'None'],
                ['Release policy', words(node.releasePolicy)]);
        }
        if (expanded && node.decision) {
            const d = node.decision;
            fields.push(['Measured prefix', `${d.prefixMs.toFixed(1)} ms`],
                ['Remaining consumers at decision', String(d.remaining)],
                ['Potential avoided work', `${d.avoidedMs.toFixed(1)} ms`],
                ['Incremental checkpoint cost', `${d.costMs.toFixed(1)} ms`],
                ['Required saving threshold', `${d.requiredMs.toFixed(1)} ms`],
                ['Decision', d.reuse ? 'Reuse economical' : 'Continue linearly'],
                ['Capture cost', d.captured ? 'Sunk; included in total elapsed time' : `${d.components.capture.toFixed(1)} ms`],
                ['Remaining restores', `${d.components.restore.toFixed(1)} ms`],
                ['Incremental release / lifecycle', `${d.components.release.toFixed(1)} / ${d.components.lifecycle.toFixed(1)} ms`],
                ['Decision history', (node.decisions ?? []).map(item => `${item.remaining} remaining: ${item.reuse ? 'reuse' : 'linear'}`).join(' → ')]);
        }
        if (node.releaseReason) fields.push(['Release reason', words(node.releaseReason)]);
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
        if (expanded && node.kind === 'checkpoint') {
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
