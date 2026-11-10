// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const predictor = require('./index.cjs');
const read = file => JSON.parse(fs.readFileSync(file));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', {flag: 'wx', mode: 0o600});
function main(args) {
    const [command, input, output, extra] = args;
    if (command === 'prepare') {
        const request = read(input);
        request.sources = request.files.map(entry => {
            const file=typeof entry==='string' ? {path:entry} : entry;
            return {name:file.path, role:file.role, source:fs.readFileSync(path.resolve(path.dirname(input),file.path),'utf8')};
        });
        write(output, predictor.prepare(request, extra ? predictor.loadModel(extra) : null));
    } else if (command === 'observe') {
        const measurement = read(extra);
        write(output, predictor.observe(read(input), measurement.actualMs, measurement));
    } else if (command === 'evaluate') write(output, predictor.evaluate(read(input)));
    else if(command==='pack-ci' || command==='pack-ci-chunks') {
        const bytes=fs.readFileSync(input),id=predictor.sha256(bytes);
        predictor.loadModel(input,id);
        const transport=require('./transport.cjs');
        const payload=command==='pack-ci' ? transport.pack(bytes) : JSON.stringify(Object.fromEntries(transport.packChunks(bytes).map((chunk,i)=>[`MAGELENS_PREDICTOR_MODEL_GZIP_BASE64_${i+1}`,chunk])),null,2);
        fs.writeFileSync(output,payload+'\n',{flag:'wx',mode:0o600});
        console.log(JSON.stringify({modelId:id,...(command==='pack-ci' ? {variable:'MAGELENS_PREDICTOR_MODEL_GZIP_BASE64'} : {variables:Object.keys(JSON.parse(payload))})}));
    } else throw new Error('Usage: predictor/cli.cjs prepare request.json snapshot.json [model.json] | observe snapshot.json sample.json measurement.json | evaluate samples.json report.json | pack-ci model.json model.b64 | pack-ci-chunks model.json variables.json');
}
module.exports = {main};
if (require.main === module) {
    try { main(process.argv.slice(2)); }
    catch (error) { console.error(JSON.stringify(error.toJSON?.() ?? {statusCode: 500, code: 'ESTIMATION_FAILED', message: error.message})); process.exitCode = 1; }
}
