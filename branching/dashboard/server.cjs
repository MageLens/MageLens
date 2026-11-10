// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const path = require('node:path');
const http = require('node:http');
const {assets} = require('../configs/dashboard-assets.cjs');
const {createJournalReader} = require('./journal-reader.cjs');
const {createEventStream} = require('./event-stream.cjs');
const {createHandler} = require('./http.cjs');
const {dashboard} = require('../configs/dashboard.cjs');
async function startDashboard({
    directory,
    manifest,
    port = dashboard.port,
    host = dashboard.host,
    pollMs = dashboard.pollMs,
    transformAsset,
    assetDirectory = __dirname
} = {}) {
    directory = path.resolve(directory ?? dashboard.eventDirectory);
    const revisionFiles = [
        ...Object.values(assets).map(([name]) => path.join(assetDirectory, name)),
        ...[
            './server.cjs',
            './journal-reader.cjs',
            './event-stream.cjs',
            './http.cjs',
            '../estimation.cjs',
            '../configs/dashboard-assets.cjs',
            '../configs/dashboard.cjs',
            '../planner/src/limits.json'
        ].map((file) => require.resolve(file))
    ];
    const reader = createJournalReader({
        directory,
        manifest,
        revisionFiles,
        onUpdate: (update) => stream.publish(update)
    });
    const stream = createEventStream(reader.complete);
    const server = http.createServer(
        createHandler({snapshot: reader.snapshot, stream, assetDirectory, transformAsset})
    );
    try {
        await reader.scan();
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(port, host, resolve);
        });
    } catch (error) {
        stream.close();
        await reader.close();
        throw error;
    }
    const timer = setInterval(() => {
        void reader.scan();
    }, pollMs);
    return {
        server,
        snapshot: reader.snapshot,
        scan: reader.scan,
        url: `http://${dashboard.host}:${server.address().port}`,
        async close() {
            clearInterval(timer);
            await reader.close();
            stream.close();
            await new Promise((resolve) => {
                server.close(resolve);
                server.closeIdleConnections();
            });
        }
    };
}
if (require.main === module) {
    const [directory = dashboard.eventDirectory, manifest = dashboard.manifest] = process.argv.slice(2);
    startDashboard({
        directory,
        manifest,
        port: Number(process.env.PORT ?? dashboard.port),
        host: process.env.MAGELENS_DASHBOARD_BIND ?? dashboard.host
    })
        .then((app) => {
            console.log(`Branching dashboard: ${app.url}`);
            for (const signal of ['SIGINT', 'SIGTERM'])
                process.once(signal, () => app.close().then(() => process.exit(0)));
        })
        .catch((error) => {
            console.error(error.message);
            process.exitCode = 1;
        });
}
module.exports = {startDashboard};
