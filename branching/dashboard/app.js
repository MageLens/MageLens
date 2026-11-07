// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const params = new URLSearchParams(location.hash.slice(1));
    let selectedRun = params.get('run'), selectedNode = params.get('node'), pinned = params.get('history') === '1';
    let data = {runs: [], plan: null, warnings: []}, scale = 1, dimensions = {width: 800, height: 400}, graphKey;
    const elements = new Map();
    let following = true, followed, hoveredNode, linearRun;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    let pulseTimer;
    function updatePulse() {
        const active = current()?.nodes.some(node => node.active) && !document.hidden && !reducedMotion.matches;
        if (!active) { clearTimeout(pulseTimer); pulseTimer = null; document.documentElement.classList.remove('pulse-dim'); return; }
        if (!pulseTimer) pulseTimer = setTimeout(() => {
            pulseTimer = null; document.documentElement.classList.toggle('pulse-dim'); updatePulse();
        }, 700);
    }
    reducedMotion.addEventListener('change', updatePulse);
    document.addEventListener('visibilitychange', updatePulse);
    const words = value => (value ?? '—').replaceAll('-', ' ');
    const short = value => value.slice(0, 8);
    function current() { return selectedRun === 'source-plan' ? data.plan : data.runs.find(run => run.id === selectedRun); }
    function remember() {
        const hash = new URLSearchParams(); if (selectedRun) hash.set('run', selectedRun); if (selectedNode) hash.set('node', selectedNode); if (pinned) hash.set('history', '1');
        history.replaceState(null, '', '#' + hash.toString());
    }
    function chooseRun(id) { selectedRun = id; selectedNode = null; hoveredNode = null; pinned = id !== data.runs[0]?.id; remember(); render(); }
    function chooseNode(id) { selectedNode = id; remember(); renderDetails(current()); for (const [key, el] of elements) el.classList.toggle('selected', key === id); }
    function setZoom(value) {
        scale = Math.max(.25, Math.min(1.75, value));
        $('canvas').style.transform = `scale(${scale})`;
        $('canvas-wrap').style.width = `${dimensions.width * scale}px`;
        $('canvas-wrap').style.height = `${dimensions.height * scale}px`;
    }
    function centerStart() {
        const first = [...elements.values()].sort((a, b) => a.offsetTop - b.offsetTop)[0];
        $('viewport').scrollTo({top: 0, left: first ? (first.offsetLeft + 111) * scale - $('viewport').clientWidth / 2 : 0, behavior: 'instant'});
    }
    function fit() {
        setZoom(Math.min(1, Math.max(.55, ($('viewport').clientWidth - 12) / dimensions.width)));
        if (!current()?.nodes.some(node => node.active)) centerStart();
    }
    function followActive(run, force = false) {
        if (!following || !run) return;
        const active = run.nodes.filter(node => node.active);
        const latest = run.activity.findLast(event => event.type === 'node-start' && active.some(node => node.id === event.node));
        const node = active.find(node => node.id === latest?.node) ?? active[0];
        if (!node) return;
        const key = `${run.id}:${node.id}:${node.operation}`;
        if (!force && followed === key) return;
        followed = key;
        const el = elements.get(node.id), viewport = $('viewport');
        viewport.scrollTo({left: (el.offsetLeft + el.offsetWidth / 2) * scale - viewport.clientWidth / 2,
            top: (el.offsetTop + el.offsetHeight / 2) * scale - viewport.clientHeight / 2,
            behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
    }
    function layout(nodes, schedule) {
        const children = new Map(nodes.map(node => [node.id, []])), points = new Map();
        const roots = [];
        for (const node of nodes) (children.get(node.parent) ?? roots).push(node);
        const order = new Map(schedule.map((id, index) => [id, index])), earliest = new Map();
        const firstTest = node => {
            if (!earliest.has(node.id)) earliest.set(node.id, order.get(node.id) ?? Math.min(...children.get(node.id).map(firstTest)));
            return earliest.get(node.id);
        };
        const byExecution = (a, b) => firstTest(a) - firstTest(b);
        roots.sort(byExecution); for (const branch of children.values()) branch.sort(byExecution);
        let column = 0, maxDepth = 0, offsetY = 0, width = 278;
        function place(node, depth) {
            maxDepth = Math.max(maxDepth, depth);
            const branch = children.get(node.id);
            const xs = branch.map(child => place(child, depth + 1));
            const x = xs.length ? (xs[0] + xs.at(-1)) / 2 : 28 + column++ * 258;
            points.set(node.id, {x, y: offsetY + 28 + depth * 184}); return x;
        }
        // Independent groups run sequentially. Give each its own vertical band
        // instead of treating every root as simultaneous work on one row.
        for (const node of roots) {
            column = 0; maxDepth = 0; place(node, 0);
            width = Math.max(width, column * 258 + 20);
            offsetY += (maxDepth + 1) * 184 + 40;
        }
        dimensions = {width, height: Math.max(420, offsetY)};
        return points;
    }
    function block(node) {
        const button = document.createElement('button'); button.className = 'node'; button.dataset.node = node.id;
        const top = document.createElement('span'); top.className = 'node-top';
        const type = document.createElement('span'); type.className = 'node-kind';
        const dot = document.createElement('i'); dot.className = 'working-dot'; dot.setAttribute('aria-hidden', 'true');
        top.append(type, dot); button.append(top);
        for (const field of ['title', 'status', 'footer']) { const span = document.createElement('span'); span.className = 'node-' + field; button.append(span); }
        button.addEventListener('click', () => chooseNode(node.id));
        for (const name of ['mouseenter', 'focus']) button.addEventListener(name, () => { hoveredNode = node.id; renderDetails(current()); });
        for (const name of ['mouseleave', 'blur']) button.addEventListener(name, () => { hoveredNode = null; renderDetails(current()); });
        return button;
    }
    function renderGraph(run) {
        const key = run.id + ':' + run.nodes.map(n => n.id + n.parent).join(',');
        const fresh = key !== graphKey; graphKey = key;
        if (fresh) { elements.clear(); $('nodes').replaceChildren(); }
        const points = layout(run.nodes, run.schedule);
        $('canvas').style.width = dimensions.width + 'px'; $('canvas').style.height = dimensions.height + 'px';
        $('edges').setAttribute('width', dimensions.width); $('edges').setAttribute('height', dimensions.height);
        const edges = [];
        for (const node of run.nodes) {
            let el = elements.get(node.id);
            if (!el) { el = block(node); elements.set(node.id, el); $('nodes').append(el); }
            const point = points.get(node.id);
            el.style.left = point.x + 'px'; el.style.top = point.y + 'px';
            el.dataset.kind = node.kind; el.dataset.depth = node.depth > 1 ? 'follow' : 'first';
            el.dataset.status = node.status; el.dataset.active = String(node.active);
            el.dataset.checkpoint = node.checkpointState;
            const last = node.kind === 'checkpoint' && node.remaining === 1 && node.checkpointState === 'available';
            el.dataset.last = String(last); el.classList.toggle('selected', node.id === selectedNode);
            const type = node.kind === 'test' ? 'End test' : node.kind === 'step' ? 'Linear step' : node.depth > 1 ? 'Follow-up checkpoint' : 'First checkpoint';
            el.querySelector('.node-kind').textContent = node.kind === 'test' ? `${type} · ${run.schedule.indexOf(node.id) + 1}/${run.schedule.length}` : type;
            el.querySelector('.node-title').textContent = node.label; el.title = node.label;
            const status = node.active ? `${words(node.operation)} · active` : outcome(node.status);
            el.querySelector('.node-status').textContent = status;
            const footer = node.kind === 'test' ? (node.blockedBy ? 'Blocked by ' + node.blockedBy : node.source?.file ?? node.id)
                : node.checkpointState === 'released' ? '✓ Cleaned after last use'
                    : node.checkpointState === 'retained' ? 'Retained by run policy'
                        : last ? 'Last consumer · cleanup next'
                            : node.kind === 'step' ? 'Replayed when needed' : `${node.remaining} consumers left · ${words(node.checkpointState)}`;
            el.querySelector('.node-footer').textContent = footer;
            el.setAttribute('aria-label', `${type}: ${node.label}. ${status}. ${footer}`);
            const parent = points.get(node.parent);
            if (parent) {
                const edge = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                const x = parent.x + 111, y = parent.y + 124, endX = point.x + 111, endY = point.y, middle = (y + endY) / 2;
                edge.setAttribute('d', `M${x},${y} C${x},${middle} ${endX},${middle} ${endX},${endY}`);
                edge.dataset.from = node.parent; edge.dataset.to = node.id;
                edge.classList.toggle('active', node.active); edges.push(edge);
            }
        }
        $('edges').replaceChildren(...edges);
        if (fresh) {
            followed = null; fit();
            centerStart();
        } else setZoom(scale);
        followActive(run);
    }
    function renderDetails(run) {
        const node = run?.nodes.find(n => n.id === (hoveredNode ?? selectedNode));
        $('node-details').hidden = !node;
        $('node-details').dataset.pinned = String(Boolean(selectedNode));
        $('details').replaceChildren(); $('last-use').hidden = true;
        $('detail-title').textContent = node?.label ?? '';
        $('detail-description').textContent = node ? `${node.id}${node.source ? ` · ${node.source.file}:${node.source.line}` : ''}` : '';
        if (!node) return;
        $('detail-kind').textContent = `${node.kind === 'step' ? 'Linear step' : words(node.kind)} details`;
        elements.get(node.id)?.setAttribute('aria-describedby', 'node-details');
        const fields = [['Type', words(node.kind)], ['Status', node.active ? words(node.operation) + ' · active' : words(node.status)],
            ['Checkpoint', words(node.checkpointState)], ['Executions / restores', `${node.executions} / ${node.restores}`]];
        if (node.kind !== 'test') fields.push(['Remaining consumers', `${node.remaining} / ${node.consumers.length}`],
            ['Last consumer', run.nodes.find(n => n.id === node.lastConsumer)?.label ?? 'None'], ['Release policy', words(node.releasePolicy)]);
        if (node.blockedBy) fields.push(['Blocked by', node.blockedBy]);
        if (node.lastError) fields.push(['Failure phase', words(node.lastError)]);
        for (const [title, value] of fields) {
            const group = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
            dt.textContent = title; dd.textContent = value; group.append(dt, dd); $('details').append(group);
        }
        if (node.kind === 'checkpoint') {
            $('last-use').hidden = false;
            $('last-use').textContent = node.checkpointState === 'released' ? 'Checkpoint storage has been cleaned. Its execution history stays in this graph.'
                : node.checkpointState === 'recovery-required' ? 'Cleanup needs recovery. The checkpoint has not been marked as released.'
                    : node.releasePolicy === 'retained' ? 'This run retains its checkpoint storage for inspection.'
                        : node.releasePolicy === 'run' ? 'Released during final run cleanup.'
                            : `Kept until ${run.nodes.find(n => n.id === node.lastConsumer)?.label ?? 'the last consumer'} finishes, including a failed last test.`;
        }
        positionDetails();
    }
    function positionDetails() {
        const el = elements.get(hoveredNode ?? selectedNode), popup = $('node-details');
        if (!el || popup.hidden) return;
        const rect = el.getBoundingClientRect();
        const left = rect.right + popup.offsetWidth + 24 <= innerWidth ? rect.right + 12 : rect.left - popup.offsetWidth - 12;
        popup.style.left = Math.max(8, Math.min(left, innerWidth - popup.offsetWidth - 12)) + 'px';
        popup.style.top = Math.max(8, Math.min(rect.top, innerHeight - popup.offsetHeight - 12)) + 'px';
    }
    function outcome(status) { return status === 'passed' ? '✓ Passed' : status === 'failed' ? '✕ Failed' : status === 'blocked' ? '✕ Blocked' : words(status); }
    function renderTests(run) {
        $('test-progress').replaceChildren(...run.schedule.map((id, index) => {
            const node = run.nodes.find(n => n.id === id);
            const active = run.status === 'running' && run.currentSpec === id && !['passed', 'failed', 'blocked'].includes(node.status);
            const status = active ? 'running' : node.status;
            const row = document.createElement('li'), button = document.createElement('button');
            button.className = 'test-cell'; button.dataset.test = id; button.dataset.status = status;
            const title = document.createElement('strong'); title.textContent = `${index + 1}. ${node.label}`;
            const label = document.createElement('span'); label.className = 'test-outcome';
            label.textContent = active ? `Running · ${run.nodes.find(n => n.id === node.activeStage)?.label ?? 'test actions'}` : outcome(status);
            const progress = document.createElement('progress'); progress.max = (node.setup?.length ?? 0) + 1;
            progress.value = node.status === 'passed' ? progress.max : (node.completedStages?.length ?? 0);
            progress.setAttribute('aria-label', `Execution progress: ${node.label}`);
            const detail = document.createElement('small'); detail.textContent = `${node.completedStages?.length ?? 0}/${node.setup?.length ?? 0} setup stages completed${node.restores ? ' · restored' : ''}`;
            if (run.status === 'planned') { progress.value = 0; detail.textContent = 'Not started'; }
            button.append(title, label, progress, detail);
            button.addEventListener('click', () => {
                chooseNode(id); const el = elements.get(id), viewport = $('viewport');
                viewport.scrollTo({left: (el.offsetLeft + 111) * scale - viewport.clientWidth / 2,
                    top: (el.offsetTop + 62) * scale - viewport.clientHeight / 2, behavior: 'instant'});
                positionDetails();
            });
            row.append(button); return row;
        }));
        if (linearRun !== run.id) { $('test-progress').scrollTop = 0; linearRun = run.id; }
        if (following && run.status === 'running' && run.currentSpec) $('test-progress').querySelector(`[data-test="${CSS.escape(run.currentSpec)}"]`)?.scrollIntoView({block: 'nearest', container: 'nearest'});
    }
    function activityText(event, run) {
        const label = run.nodes.find(n => n.id === event.node)?.label;
        const messages = {'run-start': 'Graph planned', 'checkpoint-ready': 'Checkpoint available', 'checkpoint-released': 'Checkpoint cleaned',
            'checkpoint-invalid': 'Checkpoint rejected · replay required', 'consumer-finished': 'Consumer finished', 'cleanup-end': 'Cleanup checked',
            'spec-start': 'Test selected', 'spec-end': 'Test ' + words(event.status), 'run-error': 'Failure during ' + words(event.phase),
            'run-end': 'Run ' + words(event.status), 'run-phase': words(event.phase), 'node-start': words(event.operation), 'node-end': words(event.operation) + ' ' + words(event.status)};
        return (label ? label + ' · ' : '') + (messages[event.type] ?? words(event.type));
    }
    function render() {
        if (!pinned) {
            const latest = data.runs[0]?.id ?? (data.plan ? 'source-plan' : null);
            if (selectedRun !== latest) { selectedNode = null; hoveredNode = null; }
            selectedRun = latest;
        }
        if (!current()) selectedRun = data.runs[0]?.id ?? (data.plan ? 'source-plan' : null);
        const run = current();
        updatePulse();
        $('latest-run').setAttribute('aria-pressed', String(!pinned));
        const limited = (run?.warnings ?? []).filter(warning => warning.code === 'checkpoint-limit');
        const warnings = [...data.warnings, ...(run?.warnings ?? []).filter(warning => warning.code !== 'checkpoint-limit').map(warning => warning.message),
            ...(limited.length <= 1 ? limited.map(warning => warning.message) : [`${limited.length} tests have more than ${limited[0].limit} checkpoint candidates (up to ${Math.max(...limited.map(warning => warning.candidates))}). Execution selects at most ${limited[0].limit} per test. Consider splitting these long shared journeys.`])];
        $('warnings').hidden = !warnings.length; $('warnings').textContent = warnings.join(' ');
        $('plan-button').hidden = !data.plan;
        const options = data.runs.map(item => { const option = document.createElement('option'); option.value = item.id; option.textContent = `${item.approach} · ${short(item.id)} · ${item.status}`; return option; });
        if (data.plan) { const option = document.createElement('option'); option.value = 'source-plan'; option.textContent = 'Source plan'; options.push(option); }
        if (!options.length) { const option = document.createElement('option'); option.textContent = 'Waiting for a run'; options.push(option); }
        $('run-select').replaceChildren(...options); $('run-select').value = selectedRun ?? '';
        $('run-list').replaceChildren(...data.runs.slice(0, 8).map(item => {
            const button = document.createElement('button'); button.className = 'run-link'; button.classList.toggle('selected', item.id === selectedRun);
            const title = document.createElement('strong'), meta = document.createElement('small');
            title.textContent = `${item.approach} · ${short(item.id)}`; meta.textContent = `${item.schedule.length} tests · ${words(item.status)}`;
            button.append(title, meta); button.addEventListener('click', () => chooseRun(item.id)); return button;
        }));
        $('empty').hidden = Boolean(run); $('viewport').hidden = !run;
        if (!run) { renderDetails(null); $('test-progress').replaceChildren(); return; }
        document.body.dataset.run = run.id; document.body.dataset.sequence = run.sequence;
        const tests = run.nodes.filter(n => n.kind === 'test'), checkpoints = run.nodes.filter(n => n.kind === 'checkpoint');
        $('subtitle').textContent = run.id === 'source-plan' ? `${run.sourceFiles} source files · ${run.diagnostics} diagnostics · candidates before cost selection`
            : `${run.approach} · ${short(run.id)} · ${run.wallMs ? (run.wallMs / 1000).toFixed(1) + ' s' : words(run.phase)}`;
        $('run-status').textContent = run.status === 'running' ? words(run.phase) : words(run.status); $('run-status').className = 'status-pill ' + run.status;
        const active = run.nodes.find(n => n.active), currentTest = run.nodes.find(n => n.id === run.currentSpec);
        $('current-work').textContent = run.status === 'running' ? (active ? `Running now: ${active.label}` : `Run ${words(run.phase)}`) +
            (currentTest ? ` · test ${run.schedule.indexOf(currentTest.id) + 1}/${run.schedule.length}: ${currentTest.label}` : '')
            : run.status === 'planned' ? 'Preview · groups follow planned execution order' : `Run ${words(run.status)} · no work is active`;
        $('metric-tests').textContent = `${tests.filter(n => ['passed', 'failed', 'blocked'].includes(n.status)).length} / ${tests.length}`;
        $('metric-checkpoints').textContent = `${checkpoints.filter(n => n.checkpointState === 'available').length} / ${checkpoints.length}`;
        $('metric-reuses').textContent = run.counts.reuseHits ?? '—';
        $('metric-cleaned').textContent = checkpoints.filter(n => n.checkpointState === 'released').length;
        $('graph-summary').textContent = `${run.nodes.length} stages and tests · ${checkpoints.length} ${run.status === 'planned' ? 'candidate ' : ''}checkpoints · ${tests.length} end tests`;
        $('cleanup-summary').textContent = !run.cleanup ? 'Cleanup pending' : run.cleanup.failed ? 'Recovery required' : run.cleanup.retained ? 'Storage retained by policy' : run.cleanup.storageReleased ? 'Cleanup complete' : 'Storage still present';
        renderGraph(run); renderDetails(run); renderTests(run);
        $('activity').replaceChildren(...run.activity.slice(-15).reverse().map(event => {
            const li = document.createElement('li'), time = document.createElement('time'), text = document.createElement('span');
            time.textContent = new Date(event.time).toLocaleTimeString('en-GB'); text.textContent = activityText(event, run); li.append(time, text); return li;
        }));
    }
    $('run-select').addEventListener('change', event => chooseRun(event.target.value));
    $('latest-run').addEventListener('click', () => { pinned = false; selectedNode = null; hoveredNode = null; render(); remember(); });
    $('plan-button').addEventListener('click', () => chooseRun('source-plan'));
    $('zoom-in').addEventListener('click', () => { setZoom(scale + .15); followActive(current(), true); });
    $('zoom-out').addEventListener('click', () => { setZoom(scale - .15); followActive(current(), true); });
    $('zoom-fit').addEventListener('click', () => { fit(); followActive(current(), true); });
    $('follow-active').addEventListener('click', () => {
        following = !following; $('follow-active').setAttribute('aria-pressed', String(following));
        followActive(current(), true);
    });
    window.addEventListener('resize', () => { fit(); followActive(current(), true); positionDetails(); });
    $('viewport').addEventListener('scroll', positionDetails, {passive: true});
    function dismissDetails() { selectedNode = null; hoveredNode = null; remember(); renderDetails(current()); for (const el of elements.values()) el.classList.remove('selected'); }
    document.addEventListener('keydown', event => { if (event.key === 'Escape') dismissDetails(); });
    document.addEventListener('pointerdown', event => { if (!event.target.closest('.node,.test-cell,#node-details')) dismissDetails(); });
    const stream = new EventSource('/events');
    let revision;
    stream.addEventListener('open', () => { $('connection').className = 'connected'; $('connection').lastChild.textContent = ' Live updates'; });
    stream.addEventListener('error', () => { $('connection').className = 'disconnected'; $('connection').lastChild.textContent = ' Reconnecting'; });
    const journals = new Map(), journalWarnings = new Map(); let frame, preview = null, model;
    stream.addEventListener('journal', event => {
        const update = JSON.parse(event.data);
        if (revision && update.uiRevision && revision !== update.uiRevision) { location.reload(); return; }
        revision = update.uiRevision; model ??= globalThis.MageLensDashboardModel(update.limits);
        if (update.reset) { journals.clear(); journalWarnings.clear(); }
        for (const id of update.removed) { journals.delete(id); journalWarnings.delete(id); }
        for (const delta of update.journals) {
            try {
                const previous = journals.get(delta.id);
                if (delta.from && previous?.offset !== delta.from) throw new Error('Missing event batch');
                let state = delta.from ? structuredClone(previous.state) : null;
                for (const line of delta.content.trim().split('\n').filter(Boolean)) state = model.applyEvent(state, JSON.parse(line));
                journals.set(delta.id, {state, offset: delta.from + delta.content.length}); journalWarnings.delete(delta.id);
            } catch { journalWarnings.set(delta.id, 'An incomplete or invalid event journal could not be read.'); }
        }
        if ('manifest' in update) {
            preview = null; journalWarnings.delete('manifest');
            try { if (update.manifest) preview = model.manifestView(JSON.parse(update.manifest)); }
            catch { journalWarnings.set('manifest', 'The source manifest could not be read.'); }
        }
        data = {runs: [...journals.values()].map(journal => journal.state).filter(Boolean).sort((a, b) => b.startedAt - a.startedAt),
            plan: preview, warnings: [...update.warnings, ...journalWarnings.values()]};
        // Coalesce incoming batches and let the browser schedule visual work.
        if (!frame) frame = requestAnimationFrame(() => { frame = null; render(); });
    });
    window.addEventListener('pagehide', () => { clearTimeout(pulseTimer); stream.close(); });
})();
