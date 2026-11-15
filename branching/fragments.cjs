// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {stripTypeScriptTypes} = require('node:module');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
function compileFragment(parameters, code) {
    const strict = '"use strict";\n';
    try { return new AsyncFunction(...parameters, strict + code); }
    catch (original) {
        if (!(original instanceof SyntaxError)) throw original;
        try { return new AsyncFunction(...parameters, strict + stripTypeScriptTypes(code, {mode: 'transform'})); }
        catch (error) {
            if (error.code === 'ERR_NO_TYPESCRIPT') {
                original.message += '; TypeScript syntax requires the pinned runner Node build'; throw original;
            }
            throw error;
        }
    }
}

function fragments(manifest) {
    const files = new Map(), compiled = new Map();
    function source(test, from, to) {
        if (!files.has(test.file)) files.set(test.file, fs.readFileSync(path.join(manifest.root, test.file)));
        const bytes = files.get(test.file);
        // Rust source ranges are UTF-8 byte offsets.
        return test.steps.slice(from, to).map(step => bytes.subarray(step.start, step.end).toString('utf8')).join('\n');
    }
    function compile(test, from, to, parameters = ['page','expect']) {
        const key = JSON.stringify([test.id,from,to,parameters]);
        if (!compiled.has(key)) compiled.set(key,compileFragment(parameters,source(test,from,to)));
        return compiled.get(key);
    }
    return {
        source,
        prepare(test, cuts, parameters) {
            for (let i=1;i<cuts.length;i++) compile(test,cuts[i-1],cuts[i],parameters);
        },
        execute(test, from, to, runtime, expect) {
            return compile(test,from,to)(runtime.page,expect ?? require('@playwright/test').expect);
        }
    };
}
module.exports = {compileFragment, fragments};
