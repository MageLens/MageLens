// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {createHash} = require('node:crypto');
const {applyEvent, manifestView} = require('./model.cjs');
const limits = require('../planner/src/limits.json');
const MAX_JOURNAL_BYTES = 4 * 1024 * 1024;
const assets = {'/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'],
    '/model.js': ['model.cjs', 'text/javascript'], '/style.css': ['style.css', 'text/css']};

async function startDashboard({directory, manifest, port = 4173, host = '127.0.0.1', pollMs = 250, transformAsset, assetDirectory = __dirname} = {}) {
    directory = path.resolve(directory ?? '.runtime/branching-events');
    const journals = new Map(), clients = new Set(), channels = new WeakMap(), warnings = new Map();
    let manifestText = null, manifestStamp = null, version = 0, uiRevision, assetStamp, scanning, rescan = false, closing = false;
    const revisionFiles = [...Object.values(assets).map(([name]) => path.join(assetDirectory, name)), __filename,
        require.resolve('../planner/src/limits.json')];
    // Kept for explicit diagnostic requests. The live stream never reconstructs
    // graphs on the server: it relays appended metadata for browser-side reduction.
    function snapshot() {
        const runs = [], problems = [...warnings.values()]; let plan = null;
        for (const journal of journals.values()) {
            try { runs.push(journal.contents.trim().split('\n').filter(Boolean).map(JSON.parse).reduce(applyEvent, null)); }
            catch { problems.push('An incomplete or invalid event journal could not be read.'); }
        }
        try { if (manifestText) plan = manifestView(JSON.parse(manifestText)); }
        catch { problems.push('The source manifest could not be read.'); }
        return {version, uiRevision, runs: runs.filter(Boolean).sort((a, b) => b.startedAt - a.startedAt), plan, warnings: problems};
    }
    function packet(updates, removed = [], reset = false, manifestChanged = false) {
        return {version, uiRevision, limits, reset, journals: updates, removed,
            ...(reset || manifestChanged ? {manifest: manifestText} : {}), warnings: [...warnings.values()]};
    }
    function complete() {
        return packet([...journals.values()].map(j => ({id: j.id, from: 0, content: j.contents})), [], true);
    }
    function send(client, value) {
        const channel = channels.get(client);
        if (!channel || client.writableEnded) return;
        if (channel.blocked) { channel.dirty = true; return; }
        channel.blocked = !client.write(`id: ${version}\nevent: journal\ndata: ${JSON.stringify(value)}\n\n`);
        if (channel.blocked) {
            channel.timeout = setTimeout(() => { clients.delete(client); client.destroy(); }, 10000);
            client.once('drain', () => {
                clearTimeout(channel.timeout); channel.blocked = false;
                if (channel.dirty) { channel.dirty = false; send(client, complete()); }
            });
        }
    }
    async function scanOnce() {
        const previousWarnings = JSON.stringify([...warnings.values()]), updates = [], removed = [];
        let changed = false, manifestChanged = false;
        try {
            const stats = await Promise.all(revisionFiles.map(file => fs.promises.stat(file)));
            const stamp = stats.map(s => `${s.ino}:${s.size}:${s.mtimeMs}`).join('|');
            if (stamp !== assetStamp) {
                const hash = createHash('sha256');
                for (const content of await Promise.all(revisionFiles.map(file => fs.promises.readFile(file)))) hash.update(content);
                const revision = hash.digest('hex'); changed = uiRevision !== revision; uiRevision = revision; assetStamp = stamp;
            }
            warnings.delete('assets');
        } catch { warnings.set('assets', 'Dashboard files are being updated; waiting for a complete revision.'); }
        let names = [];
        try { names = (await fs.promises.readdir(directory)).filter(name => /^[a-f0-9-]{36}\.ndjson$/.test(name)); warnings.delete('directory'); }
        catch (error) { if (error.code !== 'ENOENT') warnings.set('directory', 'Cannot read the event directory.'); }
        const files = await Promise.all(names.map(async name => {
            try { return {name, stat: await fs.promises.lstat(path.join(directory, name))}; } catch { return null; }
        }));
        const recent = files.filter(row => row?.stat.isFile()).sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs).slice(0, 20);
        for (const [name, journal] of journals) if (!recent.some(row => row.name === name)) {
            journals.delete(name); warnings.delete(name); removed.push(journal.id); changed = true;
        }
        for (const {name, stat} of recent) {
            const previous = journals.get(name), stamp = `${stat.ino}:${stat.size}:${stat.mtimeMs}`;
            if (previous?.stamp === stamp) continue;
            if (stat.size > MAX_JOURNAL_BYTES) { warnings.set(name, 'An event journal exceeds the dashboard size limit.'); continue; }
            try {
                const text = await fs.promises.readFile(path.join(directory, name), 'utf8');
                const contents = text.slice(0, text.lastIndexOf('\n') + 1), id = name.slice(0, -7);
                journals.set(name, {id, stamp, contents}); warnings.delete(name);
                if (contents === previous?.contents) continue;
                const from = previous && contents.startsWith(previous.contents) ? previous.contents.length : 0;
                updates.push({id, from, content: contents.slice(from)}); changed = true;
            } catch { warnings.set(name, 'An event journal could not be read.'); }
        }
        if (manifest) {
            try {
                const stat = await fs.promises.lstat(manifest);
                if (!stat.isFile() || stat.size > MAX_JOURNAL_BYTES) throw new Error('Invalid manifest file');
                const stamp = `${stat.mtimeMs}:${stat.size}`;
                if (stamp !== manifestStamp) { manifestText = await fs.promises.readFile(manifest, 'utf8'); manifestStamp = stamp; changed = true; manifestChanged = true; }
                warnings.delete('manifest');
            } catch (error) {
                if (manifestText) { manifestText = null; changed = true; manifestChanged = true; }
                manifestStamp = null;
                if (error.code !== 'ENOENT') warnings.set('manifest', 'The source manifest could not be read.');
            }
        }
        if (changed || previousWarnings !== JSON.stringify([...warnings.values()])) {
            version++; const update = packet(updates, removed, false, manifestChanged);
            for (const client of clients) send(client, update);
        }
    }
    function scan() {
        if (closing) return Promise.resolve();
        if (scanning) { rescan = true; return scanning; }
        scanning = (async () => { do { rescan = false; await scanOnce(); } while (rescan && !closing); })()
            .catch(() => { warnings.set('scan', 'Event discovery failed; the last complete state is displayed.'); })
            .finally(() => { scanning = null; });
        return scanning;
    }
    const server = http.createServer(async (request, response) => {
        const url = new URL(request.url, 'http://localhost');
        if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(request.headers.host ?? '') || (request.headers.origin &&
            request.headers.origin !== `http://${request.headers.host}`)) {
            response.writeHead(403); return response.end('Local dashboard only');
        }
        response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'");
        if (request.method !== 'GET') { response.writeHead(405, {'Allow': 'GET'}); return response.end(); }
        if (url.pathname === '/api/state') { response.setHeader('Content-Type', 'application/json'); return response.end(JSON.stringify(snapshot())); }
        if (url.pathname === '/events') {
            if (clients.size >= 32) { response.writeHead(503); return response.end('Too many viewers'); }
            response.writeHead(200, {'Content-Type': 'text/event-stream', 'Connection': 'keep-alive'});
            response.write('retry: 1000\n\n');
            // Existing viewers use this revision to reload into the delta protocol.
            response.write(`event: snapshot\ndata: ${JSON.stringify({uiRevision})}\n\n`);
            clients.add(response); channels.set(response, {blocked: false, dirty: false}); send(response, complete());
            request.on('close', () => { clearTimeout(channels.get(response).timeout); clients.delete(response); }); return;
        }
        const asset = assets[url.pathname];
        if (!asset) { response.writeHead(404); return response.end('Not found'); }
        const [name, type] = asset, file = path.join(assetDirectory, name);
        try {
            let source = await fs.promises.readFile(file, 'utf8');
            if (transformAsset) source = transformAsset(file, source);
            response.setHeader('Content-Type', type + '; charset=utf-8'); response.end(source);
        } catch { response.writeHead(503, {'Retry-After': '1'}); response.end('Dashboard update in progress.'); }
    });
    await scan();
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
    const timer = setInterval(() => { void scan(); }, pollMs);
    const heartbeat = setInterval(() => { for (const client of clients) if (!channels.get(client).blocked) client.write(': heartbeat\n\n'); }, 10000);
    return {server, snapshot, scan, url: `http://127.0.0.1:${server.address().port}`,
        async close() {
            closing = true; clearInterval(timer); clearInterval(heartbeat); await scanning;
            for (const client of clients) { clearTimeout(channels.get(client).timeout); client.end(); } clients.clear();
            await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); });
        }};
}
if (require.main === module) {
    const [directory = '.runtime/branching-events', manifest = '.runtime/branching-plan.json'] = process.argv.slice(2);
    startDashboard({directory, manifest, port: Number(process.env.PORT ?? 4173), host: process.env.MAGELENS_DASHBOARD_BIND ?? '127.0.0.1'})
        .then(app => {
            console.log(`Branching dashboard: ${app.url}`);
            for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.close().then(() => process.exit(0)));
        }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = {startDashboard};
