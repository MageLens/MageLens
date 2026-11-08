// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {assets} = require('../configs/dashboard-assets.cjs');
const {http} = require('../configs/dashboard.cjs');
function createHandler({snapshot, stream, assetDirectory, transformAsset}) {
    return async (request, response) => {
        const url = new URL(request.url, 'http://localhost');
        if (
            !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(request.headers.host ?? '') ||
            (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`)
        ) {
            response.writeHead(403);
            return response.end(http.localOnly);
        }
        response.setHeader('Cache-Control', http.cacheControl);
        response.setHeader('X-Content-Type-Options', http.contentTypeOptions);
        response.setHeader('Content-Security-Policy', http.contentSecurityPolicy);
        if (request.method !== 'GET') {
            response.writeHead(405, {Allow: 'GET'});
            return response.end();
        }
        if (url.pathname === http.stateRoute || url.pathname === http.streamRoute) {
            const state = snapshot();
            if (state.error) {
                response.writeHead(500, {'Content-Type': 'application/json'});
                return response.end(JSON.stringify(state));
            }
            if (url.pathname === http.streamRoute) return stream.connect(request, response);
            response.setHeader('Content-Type', 'application/json');
            return response.end(JSON.stringify(state));
        }
        const asset = assets[url.pathname];
        if (!asset) {
            response.writeHead(404);
            return response.end(http.notFound);
        }
        const [name, type] = asset,
            file = path.join(assetDirectory, name);
        try {
            let source = await fs.promises.readFile(file, 'utf8');
            if (transformAsset) source = transformAsset(file, source);
            response.setHeader('Content-Type', type + '; charset=utf-8');
            response.end(source);
        } catch {
            response.writeHead(503, {'Retry-After': '1'});
            response.end(http.updating);
        }
    };
}
module.exports = {createHandler};
