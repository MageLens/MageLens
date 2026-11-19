// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {merge} = require('../bin/report-xml.cjs');
const [field, outcome, input, sourceRoot = 'src'] = process.argv.slice(2);
assert.ok(['template', 'data'].includes(field));
assert.ok(['success', 'failed'].includes(outcome));
const data = JSON.parse(fs.readFileSync(input));
const manifest = {id: 'reflection-proof', run: 'reflection-proof', files: data.files, layoutSources: data.layoutSources};
const sources = Object.fromEntries(data.files.map(file => [file.path, fs.readFileSync(path.join(sourceRoot, file.path))]));
const {files, layoutSources, ...evidence} = data;
const request = {...evidence, manifest: manifest.id, run: manifest.run, request: 'reflection-proof', readHook: true};
const report = merge(manifest, [request], sources);
assert.equal(report.files.length, 1);
assert.equal(report.files[0].declarations.length, files[0].declarations.length);
const template = report.files[0].declarations.find(item => item.layout.kind === 'template');
const argument = report.files[0].declarations.find(item => item.layout.kind === 'argument' && item.layout.element === 'value');
const effects = item => item.evidence.map(event => event.type);
assert.equal(effects(template).includes('layout-template-executed'), field !== 'template' || outcome === 'failed');
assert.equal(effects(argument).includes('layout-argument-read'), field !== 'data' || outcome === 'failed');
assert.equal(effects(template).includes('layout-template-replaced'), field === 'template' && outcome === 'success');
assert.equal(effects(argument).includes('layout-argument-replaced'), field === 'data' && outcome === 'success');
assert.ok(effects(template).includes('layout-template-selected'));
assert.ok(effects(argument).includes('layout-argument-applied'));
assert.equal(argument.state, 'covered', 'Earlier native argument application survives replacement');
assert.equal(template.hits > 0, field !== 'template' || outcome === 'failed');
assert.throws(() => merge({...manifest, run: 'stale'}, [request], sources), /Stale XML request/);
assert.throws(() => merge(manifest, [{...request, events: [...request.events, {...request.events[0], id: 'unknown'}]}], sources), /Unknown/);
console.log('Verified original reflection report inventory, independent facts, replacement, stale runs and unknown sources.');
