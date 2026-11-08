// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {ESLint} = require('eslint');
const {checkCopyright} = require('../check-copyright.cjs');

async function main() {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {encoding: 'utf8'}).trim();
    process.chdir(root);
    const files = execFileSync('git', ['ls-files', '-z'], {encoding: 'utf8'}).split('\0').filter(Boolean);
    const copyright = checkCopyright(root);
    if (copyright.errors.length) {
        console.error(copyright.errors.join('\n'));
        process.exitCode = 1;
    } else {
        console.log(`Copyright and license notices verified for all ${copyright.count} tracked files.`);
    }

    const javascript = files.filter(file => /\.(cjs|mjs|js)$/.test(file));
    const eslint = new ESLint({cwd: root, overrideConfigFile: path.resolve(__dirname, '../../eslint.config.cjs')});
    if (javascript.length) {
        const results = await eslint.lintFiles(javascript);
        const output = (await eslint.loadFormatter('stylish')).format(results);
        if (output) console.error(output);
        if (results.some(result => result.errorCount || result.warningCount)) process.exitCode = 1;
        else console.log(`ESLint checked ${results.length} tracked JavaScript files.`);
    }

    let count = 0;
    for (const file of files) {
        if (!fs.statSync(file).isFile()) continue;
        const head = fs.readFileSync(file).subarray(0, 80).toString();
        let command;
        if (file.endsWith('.sh') || head.startsWith('#!/usr/bin/env bash')) command = ['bash', '-n'];
        else if (file.endsWith('.py')) command = ['python3', '-c', 'import ast, pathlib, sys; ast.parse(pathlib.Path(sys.argv[1]).read_text())'];
        else if (/\.(php|phtml)$/.test(file) || file.endsWith('.php.sample')) command = ['php', '-l'];
        if (!command) continue;
        try {
            execFileSync(command[0], [...command.slice(1), file], {stdio: 'pipe'});
            count++;
        } catch (error) {
            console.error(`${file}: ${error.stderr?.toString().trim() || error.stdout?.toString().trim() || error.message}`);
            process.exitCode = 1;
        }
    }
    console.log(`Syntax checked ${count} tracked Bash, Python and PHP scripts.`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
