// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Run/node selection is independent of the DOM and live transport.

export class DashboardState {
    constructor(hash) {
        const params = new URLSearchParams(hash.replace(/^#/, ''));
        this.selectedRun = params.get('run');
        this.selectedNode = params.get('node');
        this.pinned = params.get('history') === '1';
        this.hoveredNode = null;
        this.following = true;
        this.data = {
            runs: [],
            plan: null,
            warnings: []
        };
    }
    get current() {
        return this.selectedRun === 'source-plan'
            ? this.data.plan
            : this.data.runs.find((run) => run.id === this.selectedRun);
    }
    update(data) {
        this.data = data;
        this.reconcile();
    }
    reconcile() {
        const latest = this.data.runs[0]?.id ?? (this.data.plan ? 'source-plan' : null);
        if ((!this.pinned || !this.current) && this.selectedRun !== latest) {
            this.dismissNode();
            this.selectedRun = latest;
        }
    }
    chooseRun(id) {
        this.selectedRun = id;
        this.pinned = id !== this.data.runs[0]?.id;
        this.dismissNode();
        this.reconcile();
    }
    followLatest() {
        this.pinned = false;
        this.dismissNode();
        this.reconcile();
    }
    dismissNode() {
        this.selectedNode = null;
        this.hoveredNode = null;
    }
    toHash() {
        const params = new URLSearchParams();
        if (this.selectedRun) params.set('run', this.selectedRun);
        if (this.selectedNode) params.set('node', this.selectedNode);
        if (this.pinned) params.set('history', '1');
        return '#' + params.toString();
    }
}
