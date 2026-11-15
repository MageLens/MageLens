// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {createCoverageMap} = require('istanbul-lib-coverage');
// Restore, readiness and state verification execute application code as provider
// overhead. Retain prefix coverage; count only subsequent test-segment deltas.
class CoverageGate {
    constructor(project, key) {
        this.project = project; this.key = key; this.paused = true;
        this.latest = new Map(); this.recorded = new Map(); this.offset = new Map(); this.prior = new Map();
    }
    receive(snapshot) {
        const key = snapshot[this.key];
        this.latest.set(key,structuredClone(snapshot));
        if (this.paused) return null;
        const result = this.project(snapshot,this.offset.get(key),this.prior.get(key));
        this.recorded.set(key,structuredClone(result));
        return result;
    }
    pause() { this.paused = true; }
    resume() {
        for (const [key,snapshot] of this.latest) {
            this.offset.set(key,structuredClone(snapshot));
            this.prior.set(key,structuredClone(this.recorded.get(key)));
        }
        this.paused = false;
    }
}
function javascript(snapshot, offset, prior) {
    const delta = structuredClone(snapshot.coverage);
    for (const [file,data] of Object.entries(delta)) {
        const before = offset?.coverage?.[file];
        for (const kind of ['s','f']) for (const id of Object.keys(data[kind])) data[kind][id] = Math.max(0,data[kind][id]-(before?.[kind]?.[id] ?? 0));
        for (const id of Object.keys(data.b)) data.b[id] = data.b[id].map((count,index)=>Math.max(0,count-(before?.b?.[id]?.[index] ?? 0)));
    }
    const combined = createCoverageMap(structuredClone(prior?.coverage ?? {})); combined.merge(delta);
    return {...snapshot,coverage:Object.fromEntries(combined.files().map(file=>[file,combined.fileCoverageFor(file).toJSON()]))};
}
function templates(snapshot, offset, prior) {
    const hits = structuredClone(prior?.hits ?? {});
    for (const [id,statements] of Object.entries(snapshot.hits)) for (const [statement,count] of Object.entries(statements)) {
        const delta = Math.max(0,count-(offset?.hits?.[id]?.[statement] ?? 0));
        if (delta) { hits[id] ??= {}; hits[id][statement] = (hits[id][statement] ?? 0)+delta; }
    }
    const ids = [...new Set([...(prior?.ids ?? []),...snapshot.ids.filter(id=>!offset?.ids?.includes(id))])];
    const excluded = new Set((offset?.references ?? []).map(JSON.stringify));
    const references = new Map([...(prior?.references ?? []),...snapshot.references.filter(ref=>!excluded.has(JSON.stringify(ref)))].map(ref=>[JSON.stringify(ref),ref]));
    return {...snapshot,hits,ids,references:[...references.values()]};
}
module.exports = {CoverageGate,javascript,templates};
