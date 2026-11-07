// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {dashboard, http} = require('../configs/dashboard.cjs');
function createEventStream(complete) {
    const clients = new Set();
    const channels = new WeakMap();
    function send(client, value) {
        const channel = channels.get(client);
        if (!channel || client.writableEnded) return;
        if (channel.blocked) {
            channel.dirty = true;
            return;
        }
        channel.blocked = !client.write(
            `id: ${value.version}\nevent: ${http.journalEvent}\ndata: ${JSON.stringify(value)}\n\n`
        );
        if (channel.blocked) {
            channel.timeout = setTimeout(() => {
                clients.delete(client);
                client.destroy();
            }, dashboard.drainTimeoutMs);
            client.once('drain', () => {
                clearTimeout(channel.timeout);
                channel.blocked = false;
                if (channel.dirty) {
                    channel.dirty = false;
                    send(client, complete());
                }
            });
        }
    }
    function connect(request, response) {
        if (clients.size >= dashboard.maxViewers) {
            response.writeHead(503);
            return response.end(http.tooManyViewers);
        }
        response.writeHead(200, {'Content-Type': 'text/event-stream', Connection: 'keep-alive'});
        response.write(`retry: ${http.reconnectMs}\n\n`);
        // Existing viewers use this revision to reload into the delta protocol.
        response.write(
            `event: ${http.snapshotEvent}\ndata: ${JSON.stringify({uiRevision: complete().uiRevision})}\n\n`
        );
        clients.add(response);
        channels.set(response, {blocked: false, dirty: false});
        send(response, complete());
        request.on('close', () => {
            clearTimeout(channels.get(response).timeout);
            clients.delete(response);
        });
        return;
    }
    const heartbeat = setInterval(() => {
        for (const client of clients) {
            if (!channels.get(client).blocked) client.write(': heartbeat\n\n');
        }
    }, dashboard.heartbeatMs);
    return {
        connect,
        publish(update) {
            for (const client of clients) send(client, update);
        },
        close() {
            clearInterval(heartbeat);
            for (const client of clients) {
                clearTimeout(channels.get(client).timeout);
                client.end();
            }
            clients.clear();
        }
    };
}
module.exports = {createEventStream};
