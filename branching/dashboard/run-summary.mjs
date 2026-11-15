// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

import {$, words, short, testTitle} from './dom.mjs';

export function renderWarnings(data, run) {
    const limited = (run?.warnings ?? []).filter((warning) => warning.code === 'checkpoint-limit');
    const warnings = [
        ...data.warnings,
        ...(run?.warnings ?? [])
            .filter((warning) => warning.code !== 'checkpoint-limit')
            .map((warning) => warning.message),
        ...(limited.length <= 1
            ? limited.map((warning) => warning.message)
            : [
                  `${limited.length} tests have more than ${limited[0].limit} checkpoint candidates (up to ${Math.max(...limited.map((warning) => warning.candidates))}). Execution selects at most ${limited[0].limit} per test. Consider splitting these long shared journeys.`
              ])
    ];
    $('warnings').hidden = !warnings.length;
    $('warnings').textContent = warnings.join(' ');
}

function currentWork(run) {
    if (run.status === 'planned') return 'Test order from source';
    if (run.status !== 'running') return `Run ${words(run.status)} · no work is active`;

    const active = run.nodes.find((node) => node.active);
    const currentTest = run.nodes.find((node) => node.id === run.currentSpec);
    if (run.phaseTests?.length && !currentTest) return `${words(run.phase)} · ${run.phaseTests.length} native tests`;
    if (!currentTest) return active ? active.label : words(run.phase);
    const number = run.schedule.indexOf(currentTest.id) + 1;
    return `Test ${number} of ${run.schedule.length} · ${testTitle(currentTest.label)}`;
}

function cleanupStatus(cleanup) {
    if (!cleanup) return 'Cleanup pending';
    if (cleanup.failed) return 'Recovery required';
    if (cleanup.retained) return 'Storage retained by policy';
    return cleanup.storageReleased ? 'Cleanup complete' : 'Storage still present';
}

export function renderSummary(run, view) {
    document.body.dataset.run = run.id;
    document.body.dataset.sequence = run.sequence;
    const tests = run.nodes.filter((n) => n.kind === 'test');
    const checkpoints = view.nodes.filter((n) => n.kind === 'checkpoint');
    $('subtitle').textContent =
        run.id === 'source-plan'
            ? `${run.sourceFiles} source files · ${run.diagnostics} diagnostics · candidates before cost selection`
            : `${run.approach} · ${short(run.id)} · ${run.wallMs ? (run.wallMs / 1000).toFixed(1) + ' s' : words(run.phase)}`;
    $('run-status').textContent = run.status === 'running' && run.phase !== 'native execution'
        ? words(run.phase) : words(run.status);
    $('run-status').className = 'status-pill ' + run.status;
    const work = currentWork(run);
    if ($('current-work').textContent !== work) $('current-work').textContent = work;
    $('current-work').title = run.nodes.find(node => node.id === run.currentSpec)?.label ?? work;
    const completed = tests.filter(n => ['passed', 'failed', 'blocked', 'skipped'].includes(n.status)).length;
    $('metric-tests').textContent = `${completed} / ${tests.length}`;
    const progress = $('suite-progress'), maximum = Math.max(1, tests.length);
    // Reuse the existing frame-batched render and outcome count. Progress never
    // polls the runner or reads layout, and unchanged values need no DOM writes.
    if (progress.max !== maximum) progress.max = maximum;
    if (progress.value !== completed) progress.value = completed;
    const label = `${completed} / ${tests.length} tests completed`;
    if ($('suite-progress-label').textContent !== label) $('suite-progress-label').textContent = label;
    $('metric-checkpoints').textContent =
        `${checkpoints.filter((n) => n.checkpointState === 'available').length} / ${checkpoints.length}`;
    $('metric-prefixes').textContent = `${checkpoints.reduce((sum,node)=>sum+node.executions,0)} / ${run.counts.prefixExecutions ?? 0}`;
    renderCosts(run);
    $('metric-reuses').textContent = run.counts.reuseHits ?? '—';
    $('metric-cleaned').textContent = checkpoints.filter((n) => n.checkpointState === 'released').length;
    $('graph-summary').textContent =
        `${view.nodes.length} visible stages and tests · ${checkpoints.length} checkpoints · ${tests.length} end tests${run.excludedCandidates?.length ? ` · ${run.excludedCandidates.length} overlapping prefixes excluded` : ''}${run.ordering?.changed ? ' · independent tests grouped; required order preserved' : ''}`;
    $('cleanup-summary').textContent = cleanupStatus(run.cleanup);
    $('cleanup-summary').classList.toggle('recovery', Boolean(run.cleanup?.failed));
}

function activityText(event, run) {
    const label = run.nodes.find((n) => n.id === event.node)?.label;
    const messages = {
        'run-start': 'Run started',
        'discovery-complete': 'Shared prefixes and safe execution order discovered',
        'checkpoint-baseline': 'Checkpoint baseline loaded',
        'checkpoint-decision': event.decision?.reuse ? 'Measured prefix · reuse economical' : event.decision?.captured ? 'Reuse uneconomic · release and verified reset required' : 'Measured prefix · continue linearly',
        'checkpoint-cost-observed': `Cost recalibrated · ${event.observation?.component ?? ''}`,
        'checkpoint-reuse-abandoned': 'Reuse abandoned · reset verified',
        'checkpoint-ready': 'Checkpoint available',
        'checkpoint-released': 'Checkpoint cleaned',
        'checkpoint-ineligible': 'Setup runs normally · ' + words(event.reason),
        'checkpoint-invalid': 'Checkpoint rejected · replay required',
        'consumer-finished': 'Consumer finished',
        'cleanup-end': 'Cleanup checked',
        'group-cleanup': 'Checkpoint group cleanup checked',
        'spec-start': 'Test selected',
        'spec-end': 'Test ' + words(event.status),
        'run-error': 'Failure during ' + words(event.phase),
        'run-end': 'Run ' + words(event.status),
        'run-phase': words(event.phase),
        'node-start': words(event.operation),
        'node-end': words(event.operation) + ' ' + words(event.status)
    };
    return (label ? label + ' · ' : '') + (messages[event.type] ?? words(event.type));
}

export function renderActivity(run) {
    $('activity').replaceChildren(
        ...run.activity
            .slice(-15)
            .reverse()
            .map((event) => {
                const li = document.createElement('li');
                const time = document.createElement('time');
                const text = document.createElement('span');
                time.textContent = new Date(event.time).toLocaleTimeString('en-GB');
                text.textContent = activityText(event, run);
                li.append(time, text);
                return li;
            })
    );
}

function renderCosts(run) {
    const baseline = run.baseline;
    $('checkpoint-costs').hidden = !baseline;
    if (!baseline) return;
    $('baseline-status').textContent = `Starting baseline: ${words(baseline.status)}${baseline.reason ? ' · ' + words(baseline.reason) : ''}`;
    $('baseline-values').replaceChildren();
    for (const [key, label] of Object.entries({captureMs:'Capture',restoreMs:'Restore including readiness',releaseMs:'Release',resetMs:'Reset',firstResetMs:'First reset',backendMs:'Provider lifecycle'})) {
        const row = document.createElement('p');
        const samples = baseline.observations.filter(item=>item.component===key);
        const observed = samples.at(-1);
        const statistics=baseline.statistics[key];
        const average=statistics?.count ? ` · average ${(statistics.sumMs/statistics.count).toFixed(1)} ms from ${statistics.count} ${statistics.count===1 ? 'sample' : 'samples'}` : ' · no measured samples yet';
        row.textContent = baseline.current ? `${label}: ${baseline.before[key].toFixed(1)} → ${baseline.current[key].toFixed(1)} ms${observed ? ` · last actual ${observed.ms.toFixed(1)} ms (${samples.length} this run)` : ''}${average}` : `${label}: awaiting compatible measurement`;
        $('baseline-values').append(row);
    }
    $('measurement-note').textContent = `${baseline.observations.length} actual operation observations this run. No separate calibration run. Unmeasured costs use conservative estimates; decisions use the greater of the sample average and latest observation, plus the safety margin. Avoided work is not measured net savings.`;
}
