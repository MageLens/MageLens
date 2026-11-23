// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');

// MagentoTemplateCoverage v2.1.1 (efc06dbbdb859ef3cfcdbd2cde3251388a0da242).
// Remove when the pinned package can serve Alpine bindings without its observer.
const patches = [
    {
        file: 'alpine.js',
        original: 'be60be19e7c02db76fea41260289c3904870b0c443198670755ba84f48177600',
        patched: '3089c2bcbea8df454d754f81fe5522224b42928e3cccc6fc1c496a600a1d9650',
        before: '                edits.push({offset: from, text: `__mtc_${templateId}_${id}.`});',
        after: [
            '                // Keep the actual expression usable without the browser collector.',
            '                // The adjacent marker follows its binding even for PHP-generated names.',
            '                edits.push({offset: span.endOffset, text: ` data-mtc-binding-${id}=""`});'
        ].join('\n')
    },
    {
        file: 'execution.js',
        original: '1ecaeb777824da2c6ab96b95b94e9a51ab1021e3ef9243bb7a5f8813a350dd42',
        patched: 'a1cf7151db326cb22fa20aaa3f3756d5da4d62468306b0c2c91ed04e85c7541d',
        before: '    if (!alpine?.directive || !alpine?.addScopeToNode) return false;',
        after: [
            '    if (!alpine?.directive || !alpine?.addScopeToNode || !alpine?.interceptInit || !alpine?.mutateDom) return false;',
            '    alpine.interceptInit(element => {',
            "        const marker = /^([a-f0-9]{32}):([0-9,]+)$/.exec(element.getAttribute('x-mtc'));",
            '        if (!marker) return;',
            '        const [, template, ids] = marker;',
            "        const statements = new Set(ids.split(','));",
            '        const attributes = Array.from(element.attributes);',
            '        for (let index = 1; index < attributes.length; index++) {',
            '            const counter = /^data-mtc-binding-(\\d+)$/.exec(attributes[index].name);',
            '            if (!counter || !statements.has(counter[1])) continue;',
            '            const binding = attributes[index - 1];',
            '            if (!/^(?:x-|@|:)/.test(binding.name)) continue;',
            '            const prefix = `__mtc_${template}_${counter[1]}.`;',
            "            const loop = binding.name === 'x-for'",
            "                ? /^([\\s\\S]*?\\s+(?:in|of)\\s+)/.exec(binding.value)?.[0] : '';",
            '            if (loop === undefined || binding.value.startsWith(prefix, loop.length)) continue;',
            '            // Rewrite before Alpine reads directives, without firing its attribute observer.',
            '            alpine.mutateDom(() => { binding.value = loop + prefix + binding.value.slice(loop.length); });',
            '        }',
            '    });'
        ].join('\n')
    }
];

const digest = source => createHash('sha256').update(source).digest('hex');

function applyTemplateCoveragePatch(library) {
    const {version} = JSON.parse(fs.readFileSync(path.resolve(library, '../package.json'), 'utf8'));
    if (version !== '2.1.1') return;
    const changes = patches.flatMap(({file, original, patched, before, after}) => {
        const target = path.join(library, file);
        const source = fs.readFileSync(target, 'utf8');
        const hash = digest(source);
        if (hash === patched) return [];
        const replacement = source.replace(before, () => after);
        if (hash !== original || digest(replacement) !== patched) {
            throw new Error(`Unexpected Magento template coverage ${version} source: ${file}`);
        }
        return [{target, replacement}];
    });
    for (const {target, replacement} of changes) {
        const temporary = `${target}.${randomUUID()}.tmp`;
        try {
            fs.writeFileSync(temporary, replacement, {mode: fs.statSync(target).mode});
            fs.renameSync(temporary, target);
        } finally {
            fs.rmSync(temporary, {force: true});
        }
    }
}

module.exports = {applyTemplateCoveragePatch};
