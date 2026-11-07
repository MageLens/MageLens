// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

import {words, outcome} from './dom.mjs';

function nodeType(node) {
    if (node.kind === 'test') return 'End test';
    if (node.kind === 'step') return 'Linear step';
    return node.depth > 1 ? 'Follow-up checkpoint' : 'First checkpoint';
}

function nodeFooter(node, last) {
    if (node.kind === 'test') {
        return node.blockedBy ? 'Blocked by ' + node.blockedBy : (node.source?.file ?? node.id);
    }
    if (node.checkpointState === 'released') return '✓ Cleaned after last use';
    if (node.checkpointState === 'retained') return 'Retained by run policy';
    if (last) return 'Last consumer · cleanup next';
    if (node.kind === 'step') return 'Replayed when needed';
    return `${node.remaining} consumers left · ${words(node.checkpointState)}`;
}

export function createNode(node, {onSelect, onHover}) {
    const button = document.createElement('button');
    button.className = 'node';
    button.dataset.node = node.id;
    const top = document.createElement('span');
    top.className = 'node-top';
    const type = document.createElement('span');
    type.className = 'node-kind';
    const dot = document.createElement('i');
    dot.className = 'working-dot';
    dot.setAttribute('aria-hidden', 'true');
    top.append(type, dot);
    button.append(top);
    for (const field of ['title', 'status', 'footer']) {
        const span = document.createElement('span');
        span.className = 'node-' + field;
        button.append(span);
    }
    button.addEventListener('click', () => onSelect(node.id));
    for (const name of ['mouseenter', 'focus'])
        button.addEventListener(name, () => {
            onHover(node.id);
        });
    for (const name of ['mouseleave', 'blur'])
        button.addEventListener(name, () => {
            onHover(null);
        });
    return button;
}

export function updateNode(el, node, run, selectedNode) {
    el.dataset.kind = node.kind;
    el.dataset.depth = node.depth > 1 ? 'follow' : 'first';
    el.dataset.status = node.status;
    el.dataset.active = String(node.active);
    el.dataset.checkpoint = node.checkpointState;
    const last = node.kind === 'checkpoint' && node.remaining === 1 && node.checkpointState === 'available';
    el.dataset.last = String(last);
    el.classList.toggle('selected', node.id === selectedNode);
    const type = nodeType(node);
    el.querySelector('.node-kind').textContent =
        node.kind === 'test' ? `${type} · ${run.schedule.indexOf(node.id) + 1}/${run.schedule.length}` : type;
    el.querySelector('.node-title').textContent = node.label;
    el.title = node.label;
    const status = node.active ? `${words(node.operation)} · active` : outcome(node.status);
    el.querySelector('.node-status').textContent = status;
    const footer = nodeFooter(node, last);
    el.querySelector('.node-footer').textContent = footer;
    el.setAttribute('aria-label', `${type}: ${node.label}. ${status}. ${footer}`);
}
