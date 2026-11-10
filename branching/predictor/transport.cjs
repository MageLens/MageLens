// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {gzipSync,gunzipSync}=require('node:zlib');
const variableLimit=48000, modelLimit=4*1024*1024;
function pack(bytes) {
    if(bytes.length>modelLimit)throw new Error('Predictor model exceeds the transport size limit');
    const encoded=gzipSync(bytes,{level:9}).toString('base64');
    if(Buffer.byteLength(encoded)>variableLimit)throw new Error('Compressed predictor exceeds the CI variable size limit');
    return encoded;
}
function unpack(encoded, limit=variableLimit) {
    const text=encoded.trim(),bytes=Buffer.from(text,'base64');
    if(Buffer.byteLength(text)>limit || bytes.toString('base64')!==text)
        throw new Error('Invalid compressed predictor encoding');
    return gunzipSync(bytes,{maxOutputLength:modelLimit});
}
function packChunks(bytes) {
    if(bytes.length>modelLimit)throw new Error('Predictor model exceeds the transport size limit');
    const encoded=gzipSync(bytes,{level:9}).toString('base64');
    if(encoded.length>4*variableLimit)throw new Error('Compressed predictor exceeds the chunked CI variable size limit');
    return encoded.match(new RegExp(`.{1,${variableLimit}}`, 'g'));
}
function unpackChunks(chunks) {
    if(!Array.isArray(chunks)||!chunks.length||chunks.length>4||chunks.some(c=>typeof c!=='string'||!c.length||c.length>variableLimit))
        throw new Error('Invalid predictor chunks');
    return unpack(chunks.join(''),4*variableLimit);
}
module.exports={pack,unpack,packChunks,unpackChunks};
