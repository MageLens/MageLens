// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const messages = require('./configs/messages.cjs');

const config = require('./configs/runtime.cjs');

const {canonical, digest} = require('./identity.cjs');
class Graph {
    constructor({stages, specs, identity}) {
        if (!Array.isArray(stages) || !stages.length || !Array.isArray(specs) || !specs.length)
            throw new Error(messages.emptyWorkflow);
        this.identity = JSON.parse(canonical(identity));
        for (const field of ['source', 'fixture', 'configuration', 'dependencies', 'implementation']) {
            if (!identity[field]) throw new Error(messages.missingIdentity(field));
        }
        this.stages = new Map();
        this.specs = new Map();
        this.keys = new Map();
        const ids = new Set();
        for (const [nodes, target, kind] of [
            [stages, this.stages, 'Stage'],
            [specs, this.specs, 'Spec']
        ]) {
            for (const node of nodes) {
                if (!/^[a-z][a-z0-9-]{0,79}$/.test(node.id) || ids.has(node.id))
                    throw new Error(messages.invalidOrDuplicateNodeId);
                if (typeof node.run !== 'function' || typeof node.assert !== 'function')
                    throw new Error(messages.needsExecutionAndAssertions(kind));
                if (node.checkpoint !== undefined && typeof node.checkpoint !== 'boolean')
                    throw new Error(messages.checkpointMustBeBoolean);
                if (kind === 'Spec' && typeof node.parent !== 'string')
                    throw new Error(messages.specMustDependOnExactlyOneStage);
                if (node.parent !== undefined && node.parent !== null && typeof node.parent !== 'string')
                    throw new Error(messages.onlyOneStageParentIsSupported);
                ids.add(node.id);
                target.set(node.id, {...node, inputs: JSON.parse(canonical(node.inputs ?? {}))});
            }
        }
        for (const node of [...this.stages.values(), ...this.specs.values()]) {
            if (node.parent != null && !this.stages.has(node.parent))
                throw new Error(messages.missingStage(node.parent));
        }
        for (const id of this.stages.keys()) this.key(id, new Set());
    }
    key(id, visiting = new Set()) {
        if (this.keys.has(id)) return this.keys.get(id);
        if (visiting.has(id)) throw new Error(messages.stageCycle);
        visiting.add(id);
        const node = this.stages.get(id);
        const key = digest({
            identity: this.identity,
            id,
            inputs: node.inputs,
            parent: node.parent ? this.key(node.parent, visiting) : null,
            run: node.run.toString(),
            assert: node.assert.toString(),
            checkpoint: node.checkpoint ?? true,
            boundary: node.boundary ?? config.checkpoint.boundary
        });
        visiting.delete(id);
        this.keys.set(id, key);
        return key;
    }
    chain(id) {
        const result = [];
        let node = this.stages.get(id);
        while (node) {
            result.unshift(node);
            node = this.stages.get(node.parent);
        }
        return result;
    }
    select(ids = [...this.specs.keys()]) {
        if (!ids.length || new Set(ids).size !== ids.length)
            throw new Error(messages.emptyOrDuplicateSpecSelection);
        return ids.map((id) => {
            if (!this.specs.has(id)) throw new Error(messages.unknownSpec(id));
            return this.specs.get(id);
        });
    }
}

module.exports = {Graph};
