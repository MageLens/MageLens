// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');

function sourceFiles(root, directory = 'src') {
    return fs.readdirSync(path.join(root, directory), {withFileTypes: true}).flatMap(entry => {
        const file = `${directory}/${entry.name}`;
        if (entry.isDirectory()) return sourceFiles(root, file);
        if (!/\.(rs|json)$/.test(entry.name)) return [];
        if (!entry.isFile()) throw new Error('Rust coverage source must be a regular file: ' + file);
        return [file];
    }).sort();
}

function rustCoverage(output) {
    if (process.env.MAGELENS_RUST_SELF_COVERAGE !== '1') return null;
    const container = process.env.MAGELENS_ORCHESTRATOR_CONTAINER;
    if (!/^[a-f0-9]{64}$/.test(container ?? '')) throw new Error('Native coverage requires a separate Rust container');
    const command = (name, args, options) => execFileSync('docker', ['exec', container, name, ...args], options);
    const root = path.resolve(__dirname, '../branching/planner'), raw = path.join(output, 'raw');
    fs.mkdirSync(raw, {recursive: true});
    const previous = process.env.LLVM_PROFILE_FILE;
    process.env.LLVM_PROFILE_FILE = path.join(raw, '%m-%p.profraw');
    const inputs = sourceFiles(root), files = inputs.filter(file => file.endsWith('.rs'));
    const hashes = Object.fromEntries(inputs.map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
    return {
        finish() {
            if (previous === undefined) delete process.env.LLVM_PROFILE_FILE; else process.env.LLVM_PROFILE_FILE = previous;
            const profiles = fs.readdirSync(raw).filter(name => name.endsWith('.profraw')).map(name => path.join(raw, name));
            if (!profiles.length) throw new Error('No native Rust coverage profiles were produced');
            const profile = path.join(output, 'planner.profdata');
            command('llvm-profdata', ['merge', '-sparse', ...profiles, '-o', profile]);
            const args = ['/usr/local/bin/magelens-source', '-instr-profile=' + profile,
                '-path-equivalence=/build,' + root, ...files.map(file => path.join(root, file))];
            const exported = JSON.parse(command('llvm-cov', ['export', ...args], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024}));
            fs.writeFileSync(path.join(output, 'coverage.json'), JSON.stringify(exported) + '\n');
            command('llvm-cov', ['show', ...args, '-format=html', '-output-dir=' + path.join(output, 'html')], {stdio: 'pipe'});
            const inventory = exported.data.flatMap(data => data.files.map(file => file.filename));
            const nonExecutableSources = [];
            for (const file of files) {
                if (!inventory.some(name => name.endsWith('/' + file))) {
                    // This file declares constants and a derived-data type only.
                    // LLVM maps no executable regions to it; retain its hash and
                    // report that fact instead of inventing a zero-hit denominator.
                    if (file !== 'src/baseline.rs' || /\bfn\s+/.test(fs.readFileSync(path.join(root, file), 'utf8'))) throw new Error('Missing Rust source in coverage: ' + file);
                    nonExecutableSources.push({file, reason: 'Constants and derived-data type; no LLVM instrumentable regions.'});
                }
            }
            if (JSON.stringify(sourceFiles(root)) !== JSON.stringify(inputs)) throw new Error('Rust source inventory changed during coverage');
            for (const file of inputs)
                if (createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex') !== hashes[file]) throw new Error('Rust source changed during coverage');
            const result = {schemaVersion: 1, compiler: 'rustc 1.91.0', sourceSha256: hashes, files: inventory,
                totals: exported.data[0].totals, profiles: profiles.length, originalSourcesUnchanged: true, nonExecutableSources,
                scope: 'Native planner commands executed by the Playwright dashboard self-tests; third-party Rust dependencies excluded.'};
            fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(result, null, 2) + '\n');
            console.log('Rust planner line coverage:', result.totals.lines.percent.toFixed(2) + '%');
            return result;
        }
    };
}
module.exports = {rustCoverage, sourceFiles};
