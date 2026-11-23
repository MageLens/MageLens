// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {randomUUID} = require('node:crypto');
const {StringDecoder} = require('node:string_decoder');

// This is ordinary JSON, with a distinct whitespace prefix and each array record on its own line.
const prefix = '{\n\n';

function writeXmlJson(file, report) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    const fd = fs.openSync(temporary, 'wx');
    const write = value => fs.writeFileSync(fd, value);
    try {
        try {
            write(prefix);
            let separator = '';
            for (const [key, value] of Object.entries(report)) {
                if (value === undefined) continue;
                const property = `${separator}  ${JSON.stringify(key)}:`;
                if (Array.isArray(value)) {
                    write(property + '[\n');
                    let recordSeparator = '';
                    for (const record of value) {
                        write(recordSeparator);
                        write(JSON.stringify(record) ?? 'null');
                        recordSeparator = ',\n';
                    }
                    if (value.length) write('\n');
                    write('  ]');
                } else {
                    write(property);
                    write(JSON.stringify(value));
                }
                separator = ',\n';
            }
            write('\n}\n');
        } finally {
            fs.closeSync(fd);
        }
        fs.renameSync(temporary, file);
    } finally {
        fs.rmSync(temporary, {force: true});
    }
}

function* readLines(fd) {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    const decoder = new StringDecoder('utf8');
    let rest = '';
    let size;
    while ((size = fs.readSync(fd, buffer)) !== 0) {
        const lines = decoder.write(buffer.subarray(0, size)).split('\n');
        rest += lines[0];
        if (lines.length === 1) continue;
        yield rest;
        yield* lines.slice(1, -1);
        rest = lines.at(-1);
    }
    rest += decoder.end();
    if (rest) yield rest;
}

function readXmlJson(file, {omit = []} = {}) {
    const fd = fs.openSync(file, 'r');
    try {
        const start = Buffer.alloc(prefix.length);
        fs.readSync(fd, start);
        if (start.toString() !== prefix) {
            // Reports from older versions used one JSON.stringify call.
            const report = JSON.parse(fs.readFileSync(file, 'utf8'));
            for (const key of omit) delete report[key];
            return report;
        }
        const lines = readLines(fd);
        const fields = new Map();
        let moreFields = true;
        let hasField = false;
        const invalid = `Invalid XML coverage JSON: ${file}`;
        for (let line of lines) {
            if (line === '}') {
                assert.ok(!moreFields || !hasField, invalid);
                assert.ok(lines.next().done, invalid);
                return Object.fromEntries(fields);
            }
            const property = /^  ("(?:[^"\\]|\\.)*"):(.*)$/s.exec(line);
            assert.ok(moreFields && property, invalid);
            hasField = true;
            const key = JSON.parse(property[1]);
            const discard = omit.includes(key);
            if (property[2] === '[') {
                const records = [];
                let moreRecords = true;
                let hasRecord = false;
                for (;;) {
                    line = lines.next().value;
                    assert.notEqual(line, undefined, invalid);
                    if (line === '  ]' || line === '  ],') {
                        assert.ok(!moreRecords || !hasRecord, invalid);
                        break;
                    }
                    assert.ok(moreRecords, invalid);
                    hasRecord = true;
                    moreRecords = line.endsWith(',');
                    const record = JSON.parse(moreRecords ? line.slice(0, -1) : line);
                    if (!discard) records.push(record);
                }
                if (!discard) fields.set(key, records);
            } else {
                const value = JSON.parse(line.endsWith(',') ? property[2].slice(0, -1) : property[2]);
                if (!discard) fields.set(key, value);
            }
            moreFields = line.endsWith(',');
        }
        throw new SyntaxError(invalid);
    } finally {
        fs.closeSync(fd);
    }
}

module.exports = {writeXmlJson, readXmlJson};
