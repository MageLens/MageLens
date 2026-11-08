// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Reduce journal deltas atomically and publish at most once per animation frame.

export function connectStream({onData, onConnection}) {
    let data;
    const stream = new EventSource('/events');
    let revision;
    stream.addEventListener('open', () => onConnection(true));
    stream.addEventListener('error', async () => {
        onConnection(false);
        // EventSource hides non-200 bodies. Fetch the same assessment failure
        // so a newly opened dashboard shows its reason instead of stale data.
        try {
            const response = await fetch('/api/state');
            if (response.status === 500) {
                const state = await response.json();
                if (state.error?.code === 'ESTIMATION_FAILED') onData(state);
            }
        } catch { /* Connection state already reports an unreachable server. */ }
    });
    const journals = new Map();
    const journalWarnings = new Map();
    let frame;
    let preview = null;
    let model;
    stream.addEventListener('journal', (event) => {
        const update = JSON.parse(event.data);
        if (revision && update.uiRevision && revision !== update.uiRevision) {
            location.reload();
            return;
        }
        revision = update.uiRevision;
        model ??= globalThis.MageLensDashboardModel(update.limits);
        if (update.reset) {
            journals.clear();
            journalWarnings.clear();
        }
        for (const id of update.removed) {
            journals.delete(id);
            journalWarnings.delete(id);
        }
        for (const delta of update.journals) {
            try {
                const previous = journals.get(delta.id);
                if (delta.from && previous?.offset !== delta.from) throw new Error('Missing event batch');
                let state = delta.from ? structuredClone(previous.state) : null;
                for (const line of delta.content.trim().split('\n').filter(Boolean))
                    state = model.applyEvent(state, JSON.parse(line));
                journals.set(delta.id, {
                    state,
                    offset: delta.from + delta.content.length
                });
                journalWarnings.delete(delta.id);
            } catch {
                journalWarnings.set(delta.id, 'An incomplete or invalid event journal could not be read.');
            }
        }
        if ('manifest' in update) {
            preview = null;
            journalWarnings.delete('manifest');
            try {
                if (update.manifest) preview = model.manifestView(JSON.parse(update.manifest));
            } catch {
                journalWarnings.set('manifest', 'The source manifest could not be read.');
            }
        }
        data = {
            runs: [...journals.values()]
                .map((journal) => journal.state)
                .filter(Boolean)
                .sort((a, b) => b.startedAt - a.startedAt),
            plan: preview,
            warnings: [...update.warnings, ...journalWarnings.values()]
        };
        // Coalesce incoming batches and let the browser schedule visual work.
        if (!frame)
            frame = requestAnimationFrame(() => {
                frame = null;
                onData(data);
            });
    });
    return {
        close() {
            stream.close();
            cancelAnimationFrame(frame);
        }
    };
}
