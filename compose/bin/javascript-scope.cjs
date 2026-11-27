// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const path = require('node:path');
const {isCoverageExcluded, readCoverageConfig} = require('./project.cjs');

function createJavascriptScope(sourceFiles, config = readCoverageConfig().javascript || {}) {
    if (config.metric !== undefined && config.metric !== 'statements') throw new Error('JavaScript reporting uses statements so minified lines do not distort coverage');
    if (config.inline !== undefined) throw new Error('Remove javascript.inline: inline scripts are always measured by template coverage.');
    const files = sourceFiles.filter(file => file.endsWith('.js')).map(file =>
        path.relative(path.resolve('src'), path.resolve(file)).replaceAll('\\', '/')).sort();
    const available = new Set(files), exclusions = new Map();
    const libraries = new Set(config.libraries || []), requiredExecuted = config.requiredExecuted || [];
    for (const entry of config.exclude || []) {
        if (typeof entry.reason !== 'string' || !entry.reason.trim() || exclusions.has(entry.path)) throw new Error(`Invalid JS exclusion: ${entry.path}`);
        exclusions.set(entry.path, entry);
    }
    for (const file of [...exclusions.keys(), ...libraries, ...requiredExecuted]) {
        if (!available.has(file)) throw new Error(`Configured JS asset is missing from the selected scope: ${file}`);
    }
    const included = [], excluded = [];
    for (const file of files) {
        if (isCoverageExcluded(file)) excluded.push({path: file, reason: 'Test, setup, or build tooling; not browser runtime code.'});
        else if (exclusions.has(file)) excluded.push(exclusions.get(file));
        else included.push({path: file, coveragePath: path.resolve('src', file), kind: 'standalone', group: libraries.has(file) ? 'libraries' : 'application'});
    }
    const includedPaths = new Set(included.map(entry => entry.path));
    for (const entry of excluded) {
        if (entry.replacement && !includedPaths.has(entry.replacement)) throw new Error(`Missing runtime replacement for ${entry.path}`);
    }
    for (const file of requiredExecuted) if (!includedPaths.has(file)) throw new Error(`Required runtime asset excluded: ${file}`);
    return {metric: 'statements', included, excluded, requiredExecuted};
}

module.exports = {createJavascriptScope};
