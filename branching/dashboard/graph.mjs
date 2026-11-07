// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

import {$} from './dom.mjs';
import {layout} from './layout.mjs';
import {createNode, updateNode} from './graph-node.mjs';

// Own graph elements and viewport state; selection stays in the application state.

export function createGraph({onSelect, onHover}) {
    const elements = new Map();
    let scale = 1;
    let dimensions = {
        width: 800,
        height: 400
    };
    let graphKey;
    let following = true;
    let followed;

    function setZoom(value) {
        scale = Math.max(0.25, Math.min(1.75, value));
        $('canvas').style.transform = `scale(${scale})`;
        $('canvas-wrap').style.width = `${dimensions.width * scale}px`;
        $('canvas-wrap').style.height = `${dimensions.height * scale}px`;
    }

    function centerStart() {
        const first = [...elements.values()].sort((a, b) => a.offsetTop - b.offsetTop)[0];
        $('viewport').scrollTo({
            top: 0,
            left: first ? (first.offsetLeft + 111) * scale - $('viewport').clientWidth / 2 : 0,
            behavior: 'instant'
        });
    }

    function fit(run) {
        setZoom(Math.min(1, Math.max(0.55, ($('viewport').clientWidth - 12) / dimensions.width)));
        if (!run?.nodes.some((node) => node.active)) centerStart();
    }

    function followActive(run, force = false) {
        if (!following || !run) return;
        const active = run.nodes.filter((node) => node.active);
        const latest = run.activity.findLast(
            (event) => event.type === 'node-start' && active.some((node) => node.id === event.node)
        );
        const node = active.find((node) => node.id === latest?.node) ?? active[0];
        if (!node) return;
        const key = `${run.id}:${node.id}:${node.operation}`;
        if (!force && followed === key) return;
        followed = key;
        const el = elements.get(node.id);
        const viewport = $('viewport');
        viewport.scrollTo({
            left: (el.offsetLeft + el.offsetWidth / 2) * scale - viewport.clientWidth / 2,
            top: (el.offsetTop + el.offsetHeight / 2) * scale - viewport.clientHeight / 2,
            behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
        });
    }

    function render(run, selectedNode) {
        const key = run.id + ':' + run.nodes.map((n) => n.id + n.parent).join(',');
        const fresh = key !== graphKey;
        graphKey = key;
        if (fresh) {
            elements.clear();
            $('nodes').replaceChildren();
        }
        const result = layout(run.nodes, run.schedule);
        const points = result.points;
        dimensions = result.dimensions;
        $('canvas').style.width = dimensions.width + 'px';
        $('canvas').style.height = dimensions.height + 'px';
        $('edges').setAttribute('width', dimensions.width);
        $('edges').setAttribute('height', dimensions.height);
        const edges = [];
        for (const node of run.nodes) {
            let el = elements.get(node.id);
            if (!el) {
                el = createNode(node, {
                    onSelect,
                    onHover
                });
                elements.set(node.id, el);
                $('nodes').append(el);
            }
            const point = points.get(node.id);
            el.style.left = point.x + 'px';
            el.style.top = point.y + 'px';
            updateNode(el, node, run, selectedNode);
            const parent = points.get(node.parent);
            if (parent) {
                const edge = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                const x = parent.x + 111;
                const y = parent.y + 124;
                const endX = point.x + 111;
                const endY = point.y;
                const middle = (y + endY) / 2;
                edge.setAttribute('d', `M${x},${y} C${x},${middle} ${endX},${middle} ${endX},${endY}`);
                edge.dataset.from = node.parent;
                edge.dataset.to = node.id;
                edge.classList.toggle('active', node.active);
                edges.push(edge);
            }
        }
        $('edges').replaceChildren(...edges);
        if (fresh) {
            followed = null;
            fit(run);
            centerStart();
        } else setZoom(scale);
        followActive(run);
    }

    function select(id) {
        for (const [key, element] of elements) element.classList.toggle('selected', key === id);
    }

    function focus(id) {
        const element = elements.get(id);
        if (!element) return;
        const viewport = $('viewport');
        viewport.scrollTo({
            left: (element.offsetLeft + 111) * scale - viewport.clientWidth / 2,
            top: (element.offsetTop + 62) * scale - viewport.clientHeight / 2,
            behavior: 'instant'
        });
    }
    return {
        render,
        select,
        focus,
        fit,
        followActive,
        getElement: (id) => elements.get(id),
        zoom: (amount) => setZoom(scale + amount),
        setFollowing: (value) => {
            following = value;
        }
    };
}
