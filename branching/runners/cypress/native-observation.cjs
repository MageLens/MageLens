// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const http = require('node:http');
const {randomUUID} = require('node:crypto');

async function listen(onEvent, run = randomUUID()) {
    const token = randomUUID();
    let sequence = 0;
    const server = http.createServer(async (request, response) => {
        try {
            if (request.method !== 'POST' || request.headers.authorization !== token) {
                response.writeHead(403); response.end(); return;
            }
            let body = '';
            for await (const chunk of request) {
                body += chunk;
                if (Buffer.byteLength(body) > 1024 * 1024) throw new Error('Native observation too large');
            }
            const event = JSON.parse(body);
            if (event.run !== run || event.sequence !== sequence + 1) throw new Error('Native observation sequence changed');
            await onEvent(event); sequence++;
            response.end('null');
        } catch { response.writeHead(500); response.end(); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    return {endpoint: {url: `http://127.0.0.1:${server.address().port}`, token, run},
        close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); })};
}
module.exports = {listen};
