// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {gzipSync,gunzipSync}=require('node:zlib');
const variableLimit=48*1024, modelLimit=4*1024*1024;
function pack(bytes) {
    if(bytes.length>modelLimit)throw new Error('Predictor model exceeds the transport size limit');
    const encoded=gzipSync(bytes,{level:9}).toString('base64');
    if(Buffer.byteLength(encoded)>variableLimit)throw new Error('Compressed predictor exceeds the CI variable size limit');
    return encoded;
}
function unpack(encoded) {
    const text=encoded.trim(),bytes=Buffer.from(text,'base64');
    if(Buffer.byteLength(text)>variableLimit || bytes.toString('base64')!==text)
        throw new Error('Invalid compressed predictor encoding');
    return gunzipSync(bytes,{maxOutputLength:modelLimit});
}
module.exports={pack,unpack};
