// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

import {$} from './dom.mjs';
import {DashboardState} from './state.mjs';
import {connectStream} from './stream.mjs';
import {createGraph} from './graph.mjs';
import {createDetails} from './details.mjs';
import {createTestProgress} from './test-progress.mjs';
import {createPulse} from './pulse.mjs';
import {renderHistory} from './run-history.mjs';
import {renderWarnings, renderSummary, renderActivity} from './run-summary.mjs';

const state = new DashboardState(location.hash);
const graph = createGraph({
    onSelect: chooseNode,
    onHover(id) {
        state.hoveredNode = id;
        details.render(state.current, state);
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
    details.render(state.current, state);
    graph.select(id);
}

function dismissDetails() {
    state.dismissNode();
    remember();
    details.render(state.current, state);
    graph.select(null);
}

function render() {
    const run = state.current;
    pulse.update(run);
    renderHistory(state.data, state, chooseRun);
    renderWarnings(state.data, run);
    $('empty').hidden = Boolean(run);
    $('viewport').hidden = !run;
    if (!run) {
        details.render(null, state);
        $('test-progress').replaceChildren();
        return;
    }
    renderSummary(run);
    graph.render(run, state.selectedNode);
    details.render(run, state);
    progress.render(run, state.following);
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
        graph.followActive(state.current, true);
    });
}
function fitGraph() {
    graph.fit(state.current);
    graph.followActive(state.current, true);
    details.position();
}
$('zoom-fit').addEventListener('click', fitGraph);
$('follow-active').addEventListener('click', () => {
    state.following = !state.following;
    graph.setFollowing(state.following);
    $('follow-active').setAttribute('aria-pressed', String(state.following));
    graph.followActive(state.current, true);
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
