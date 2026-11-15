// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

import {$} from './dom.mjs';
import {DashboardState} from './state.mjs';
import {connectStream} from './stream.mjs';
import {createGraph} from './graph.mjs';
import {executionView} from './layout.mjs';
import {createDetails} from './details.mjs';
import {createTestProgress} from './test-progress.mjs';
import {createPulse} from './pulse.mjs';
import {renderHistory} from './run-history.mjs';
import {renderWarnings, renderSummary, renderActivity} from './run-summary.mjs';

const state = new DashboardState(location.hash);
let view;
const graph = createGraph({
    onSelect: chooseNode,
    onHover(id) {
        state.hoveredNode = id;
        details.render(view, state);
    }
});
const details = createDetails({getElement: graph.getElement});
const progress = createTestProgress({
    onSelect(id) {
        chooseNode(id);
        graph.focus(id);
        details.position();
    }
});
const pulse = createPulse();

function remember() {
    history.replaceState(null, '', state.toHash());
}

function chooseRun(id) {
    state.chooseRun(id);
    remember();
    render();
}

function chooseNode(id) {
    state.selectedNode = id;
    remember();
    details.render(view, state);
    graph.select(id);
}

function dismissDetails() {
    state.dismissNode();
    remember();
    details.render(view, state);
    graph.select(null);
}

function render() {
    const run = state.current;
    const ready = Boolean(run?.ready || run?.status === 'planned');
    $('workspace').hidden = !ready;
    $('preparation').hidden = ready;
    $('preparation-status').textContent = run ? run.status === 'failed' ? 'Preparation failed. The suite has not started.' : /discover/i.test(run.phase) ? 'Discovering tests.' : 'Preparing execution.' : 'Waiting for a ready run.';
    $('preparation-warning').textContent = (state.data.warnings ?? []).join(' ');
    $('preparation-warning').hidden = !state.data.warnings?.length;
    if (!ready) {
        view = undefined;
        pulse.update(null);
        details.render(null, state);
        return;
    }
    view = executionView(run);
    pulse.update(view);
    renderHistory(state.data, state);
    renderWarnings(state.data, run);
    renderSummary(run, view);
    graph.render(view, state.selectedNode);
    details.render(view, state);
    progress.render(view, state.following);
    renderActivity(run);
}

$('run-select').addEventListener('change', (event) => chooseRun(event.target.value));
$('plan-button').addEventListener('click', () => chooseRun('source-plan'));
$('latest-run').addEventListener('click', () => {
    state.followLatest();
    render();
    remember();
});
for (const [id, amount] of [
    ['zoom-in', 0.15],
    ['zoom-out', -0.15]
]) {
    $(id).addEventListener('click', () => {
        graph.zoom(amount);
        graph.followActive(view, true);
    });
}
function fitGraph() {
    if ($('workspace').hidden) return;
    graph.fit(view);
    graph.followActive(view, true);
    details.position();
}
$('zoom-fit').addEventListener('click', fitGraph);
$('follow-active').addEventListener('click', () => {
    state.following = !state.following;
    graph.setFollowing(state.following);
    $('follow-active').setAttribute('aria-pressed', String(state.following));
    graph.followActive(view, true);
    if (state.following) progress.followActive();
});
window.addEventListener('resize', fitGraph);
$('viewport').addEventListener('scroll', details.position, {passive: true});
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') dismissDetails();
});
document.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('.node,.test-cell,#node-details')) dismissDetails();
});

const stream = connectStream({
    onData(data) {
        state.update(data);
        render();
    },
    onConnection(connected) {
        $('connection').className = connected ? 'connected' : 'disconnected';
        $('connection').lastChild.textContent = connected ? ' Live updates' : ' Reconnecting';
    }
});
window.addEventListener('pagehide', () => {
    pulse.stop();
    stream.close();
});
