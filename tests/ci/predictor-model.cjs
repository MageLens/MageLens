// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Repository variables pin an explicitly selected JSON model. No download,
// deserialization of executable objects, retraining or automatic promotion.
const fs = require('node:fs'), path = require('node:path');
const {loadModel,sha256} = require('../../branching/predictor/index.cjs');
const json=process.env.MAGELENS_PREDICTOR_MODEL_JSON, compressed=process.env.MAGELENS_PREDICTOR_MODEL_GZIP_BASE64;
const chunks=Array.from({length:4},(_,i)=>process.env[`MAGELENS_PREDICTOR_MODEL_GZIP_BASE64_${i+1}`] ?? '');
while(chunks.length && !chunks.at(-1))chunks.pop();
if([!!json,!!compressed,!!chunks.length].filter(Boolean).length>1)throw new Error('Configure exactly one predictor model representation');
const bytes = chunks.length ? require('../../branching/predictor/transport.cjs').unpackChunks(chunks) : compressed ? require('../../branching/predictor/transport.cjs').unpack(compressed) : json;
if (bytes) {
    if (!/^[a-f0-9]{64}$/.test(process.env.MAGELENS_PREDICTOR_MODEL_SHA256 ?? '')) throw new Error('A pinned predictor SHA-256 is required');
    if(sha256(bytes)!==process.env.MAGELENS_PREDICTOR_MODEL_SHA256)throw new Error('Predictor model digest mismatch');
    const file = path.resolve('.runtime/predictor/model.json');
    fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});
    const {id} = loadModel(file,process.env.MAGELENS_PREDICTOR_MODEL_SHA256);
    if (process.env.GITHUB_ENV) fs.appendFileSync(process.env.GITHUB_ENV,`MAGELENS_PREDICTOR_MODEL=${file}\n`);
    console.log(`Frozen prediction model: ${id}`);
} else console.log('Predictor model is not configured; CI will report missing predictions and retain observations.');
