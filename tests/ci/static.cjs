// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const {execFileSync} = require('node:child_process');
const files = execFileSync('git', ['ls-files', '-z'], {encoding: 'utf8'}).split('\0').filter(Boolean);
let count = 0;
for (const file of files) {
    if (!fs.statSync(file).isFile()) continue;
    const head = fs.readFileSync(file).subarray(0, 80).toString();
    let command;
    if (file.endsWith('.sh') || head.startsWith('#!/usr/bin/env bash')) command = ['bash', '-n'];
    else if (/\.(cjs|mjs|js)$/.test(file)) command = ['node', '--check'];
    else if (file.endsWith('.py')) command = ['python3', '-c', 'import ast, pathlib, sys; ast.parse(pathlib.Path(sys.argv[1]).read_text())'];
    else if (/\.(php|phtml)$/.test(file) || file.endsWith('.php.sample')) command = ['php', '-l'];
    if (command) { execFileSync(command[0], [...command.slice(1), file], {stdio: 'pipe'}); count++; }
}
console.log(`Syntax checked ${count} tracked scripts.`);
