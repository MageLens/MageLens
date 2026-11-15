// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {javascript, templates} = require('../../coverage-gate.cjs');
const clone = value => structuredClone(value);
const project = (current, offset, prior) => ({
    javascript: javascript({coverage:current.javascript}, offset && {coverage:offset.javascript}, prior && {coverage:prior.javascript}).coverage,
    templates: templates(current.templates, offset?.templates, prior?.templates)
});

function observeTemplatePrefix(ids, references) {
    const observedIds = new Set(), observedReferences = new Map();
    const add = ids.add, set = references.set;
    const addDescriptor = Object.getOwnPropertyDescriptor(ids, 'add');
    const setDescriptor = Object.getOwnPropertyDescriptor(references, 'set');
    ids.add = function (id) {
        observedIds.add(id);
        return add.call(this, id);
    };
    references.set = function (key, reference) {
        observedReferences.set(key, reference);
        return set.call(this, key, reference);
    };
    return {
        read: () => ({ids: [...observedIds], references: [...observedReferences.values()]}),
        close() {
            if (addDescriptor) Object.defineProperty(ids, 'add', addDescriptor);
            else delete ids.add;
            if (setDescriptor) Object.defineProperty(references, 'set', setDescriptor);
            else delete references.set;
        }
    };
}

function excludeReconstruction(current, offset, prior) {
    const {coverage} = javascript({coverage: current}, {coverage: offset}, {coverage: prior});
    for (const [file, record] of Object.entries(coverage)) {
        if (!Object.hasOwn(prior, file) && Object.hasOwn(offset, file) &&
            ![...Object.values(record.s), ...Object.values(record.f), ...Object.values(record.b).flat()].some(Boolean))
            delete coverage[file];
    }
    return coverage;
}

// An adapter connects these operations to the original collectors' actual
// closure cells. Each consumer retains its own hooks plus the captured prefix;
// browser reconstruction contributes no hits or DOM observations.
class NativeCoverage {
    constructor(adapter) {
        for (const method of ['read','pause','resume']) if (typeof adapter[method]!=='function')
            throw new Error(`Native coverage requires ${method}`);
        this.adapter=adapter; this.paused=false;
    }
    entry() {
        this.observations?.close();
        this.initial=clone(this.adapter.read());
        this.observations=this.adapter.observeTemplates?.();
    }
    capture() {
        if (!this.initial || this.paused) throw new Error('Native prefix collection is not active');
        const current = this.adapter.read();
        const prefix = project(current,this.initial);
        if (this.observations) Object.assign(prefix.templates, this.observations.read());
        else if (current.templates.ids.length || current.templates.references.length)
            throw new Error('Native prefix requires direct template and DOM observations');
        return prefix;
    }
    pause() {
        if (this.paused) return;
        this.saved=clone(this.adapter.read());
        this.observations?.close();
        this.observations=undefined;
        this.adapter.pause(); this.paused=true;
    }
    restore(prefix) {
        if (!this.initial || !this.paused) throw new Error('Native coverage restore requires a paused consumer');
        this.saved=project(prefix,null,this.initial);
    }
    resume() {
        if (!this.paused) return;
        this.adapter.resume(clone(this.saved)); this.paused=false;
    }
}
module.exports={NativeCoverage, observeTemplatePrefix, excludeReconstruction};
