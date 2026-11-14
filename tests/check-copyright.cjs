// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

// Preserve vendored artwork and the upstream license verbatim, with scoped notices.
const thirdParty = new Set([
    'assets/badge-icons/cypress.svg',
    'assets/badge-icons/html5.svg',
    'assets/badge-icons/javascript.svg',
    'assets/badge-icons/php.svg',
    'assets/badge-icons/LICENSE.md'
]);

function notice(file, legacy = false) {
    if (thirdParty.has(file)) {
        return 'SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko (MageLens packaging)\n' +
            'SPDX-FileCopyrightText: Simple Icons contributors\n' +
            'SPDX-License-Identifier: CC0-1.0\n' +
            'License: see assets/badge-icons/LICENSE.md in the repository root.\n';
    }
    return (legacy ? 'SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko\n' : 'Copyright (c)  MageLens\n') +
        'SPDX-License-Identifier: Elastic-2.0\n' +
        'License: see LICENSE in the repository root.\n';
}

function style(file, content) {
    if (file === 'LICENSE' || thirdParty.has(file) || content.includes(0)) return 'sidecar';
    const extension = path.extname(file);
    if (['.json', '.lock'].includes(extension)) return 'sidecar';
    if (['.php', '.phtml'].includes(extension) || file.endsWith('.php.sample')) return 'php';
    if (['.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx'].includes(extension)) return 'slash';
    if (['.css', '.less', '.scss'].includes(extension)) return 'block';
    if (['.md', '.html', '.xml', '.svg'].includes(extension)) return 'markup';
    if (extension === '.ini') return 'semicolon';
    if (extension === '.patch') return 'plain';
    if (['.sh', '.bash', '.yaml', '.yml', '.conf'].includes(extension) ||
        ['Dockerfile', '.gitignore', '.gitattributes', '.dockerignore'].includes(path.basename(file)) ||
        content.subarray(0, 2).toString() === '#!') return 'hash';
    // Unknown formats and binaries are never silently excluded.
    return 'sidecar';
}

function header(file, kind, legacy = false) {
    const lines = notice(file, legacy).trimEnd().split('\n');
    if (kind === 'php' || kind === 'block') return `/*\n${lines.map(line => ` * ${line}`).join('\n')}\n */\n`;
    if (kind === 'markup') return `<!--\n${lines.join('\n')}\n-->\n`;
    const prefix = {slash: '// ', hash: '# ', semicolon: '; ', plain: ''}[kind];
    if (prefix === undefined) throw new Error(`No inline header for ${kind}`);
    return lines.map(line => prefix + line).join('\n') + '\n';
}

function preamble(file, text) {
    let offset = text.startsWith('\uFEFF') ? 1 : 0;
    const shebang = text.slice(offset).match(/^#![^\n]*\n/);
    if (shebang) offset += shebang[0].length;
    const xml = text.slice(offset).match(/^<\?xml\b[^\n]*\?>\r?\n/);
    if (xml) offset += xml[0].length;
    if (file.endsWith('.md') && text.slice(offset).startsWith('---\n')) {
        const end = text.indexOf('\n---\n', offset + 3);
        if (end === -1) throw new Error('Unclosed Markdown front matter');
        offset = end + 5;
    }
    return offset;
}

// A missing base/history is an actionable detection error, never a reason to migrate all files.
function changedFiles(root, env = process.env) {
    const git = args => execFileSync('git', args, {cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
    let base = env.COPYRIGHT_BASE;
    if (!base && env.GITHUB_EVENT_NAME?.startsWith('pull_request')) {
        base = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8')).pull_request?.base?.sha;
        if (!base) throw new Error('PR target base SHA is unavailable');
    }
    let ranges;
    if (base) {
        const mergeBase = git(['merge-base', base, 'HEAD']).trim();
        ranges = [[mergeBase, 'HEAD']];
    } else {
        // An unborn local branch has only newly staged files.
        const head = git(['rev-parse', '--revs-only', 'HEAD']).trim();
        ranges = head ? [['--cached', 'HEAD'], []] : [['--cached'], []];
    }
    const changed = new Set();
    for (const range of ranges) {
        const args = ['diff', ...range, '--no-renames'];
        const contentUnchangedRenames = new Set();
        const names = git(['diff', ...range, '--find-renames', '--name-status', '-z']).split('\0').filter(Boolean);
        for (let i = 0; i < names.length;) {
            const status = names[i++];
            i++; // Source path (or the only path for a non-rename).
            if (status.startsWith('R') || status.startsWith('C')) {
                const destination = names[i++];
                if (status === 'R100') contentUnchangedRenames.add(destination);
            }
        }
        for (const file of git([...args, '--name-only', '-z', '--diff-filter=A']).split('\0').filter(Boolean)) {
            if (!contentUnchangedRenames.has(file)) changed.add(file);
        }
        for (const record of git([...args, '--numstat', '-z', '--diff-filter=ACMT']).split('\0').filter(Boolean)) {
            const [, added, removed, file] = record.match(/^([^\t]+)\t([^\t]+)\t([\s\S]*)$/);
            // Mode-only changes do not make a legacy file eligible.
            if ((added !== '0' || removed !== '0') && !contentUnchangedRenames.has(file)) changed.add(file);
        }
    }
    return changed;
}

function checkCopyright(root) {
    const files = execFileSync('git', ['ls-files', '--cached', '-z'], {cwd: root, maxBuffer: 16 * 1024 * 1024})
        .toString('utf8').split('\0').filter(Boolean);
    const deleted = execFileSync('git', ['ls-files', '--deleted', '-z'], {cwd: root}).toString('utf8').split('\0');
    const tracked = new Set(files.filter(file => !deleted.includes(file)));
    const changed = changedFiles(root);
    const errors = [];
    if (!tracked.has('LICENSE')) errors.push('LICENSE: the referenced license must be tracked');
    for (const file of tracked) {
        try {
            const absolute = path.join(root, file);
            const stat = fs.lstatSync(absolute);
            if (file.endsWith('.license')) {
                const target = file.slice(0, -'.license'.length);
                if (!tracked.has(target)) throw new Error('License sidecar has no tracked target');
                if (!stat.isFile()) throw new Error('License sidecar must be a regular file');
                const text = fs.readFileSync(absolute, 'utf8').replace(/\r\n/g, '\n');
                const requiresNew = changed.has(file) || changed.has(target);
                if (text !== notice(target) && (requiresNew || text !== notice(target, true))) {
                    throw new Error('Expected the exact year-free copyright and license notice');
                }
                continue;
            }
            const content = stat.isFile() ? fs.readFileSync(absolute) : Buffer.alloc(0);
            const kind = stat.isFile() ? style(file, content) : 'sidecar';
            if (kind === 'sidecar') {
                if (!tracked.has(`${file}.license`)) throw new Error(`Missing tracked sidecar: ${file}.license`);
            } else {
                const text = content.toString('utf8').replace(/\r\n/g, '\n');
                let body = text.slice(preamble(file, text));
                if (kind === 'php') {
                    if (!body.startsWith('<?php\n')) throw new Error('Expected a PHP opening tag before the copyright comment');
                    body = body.slice('<?php\n'.length);
                }
                if (!body.startsWith(header(file, kind)) && (changed.has(file) || !body.startsWith(header(file, kind, true)))) {
                    throw new Error('Missing year-free copyright and license header at the start of the file');
                }
            }
            if (thirdParty.has(file) && !tracked.has('assets/badge-icons/LICENSE.md')) {
                throw new Error('The referenced CC0 license must be tracked');
            }
        } catch (error) {
            errors.push(`${JSON.stringify(file)}: ${error.message}`);
        }
    }
    return {count: tracked.size, errors};
}

if (require.main === module) {
    try {
        const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {encoding: 'utf8'}).trim();
        const result = checkCopyright(root);
        if (result.errors.length) {
            console.error(result.errors.join('\n'));
            console.error('Use Copyright (c)  MageLens (no year) for added or content-modified first-party files, ' +
                'SPDX-License-Identifier: Elastic-2.0, and License: see LICENSE in the repository root.');
            process.exitCode = 1;
        } else {
            console.log(`Copyright and license notices verified for all ${result.count} tracked files (new format required only for added or content-modified first-party files).`);
        }
    } catch (error) {
        console.error(`Copyright check failed: ${error.message}`);
        process.exitCode = 1;
    }
}

module.exports = {changedFiles, checkCopyright, header, notice, preamble, style};
