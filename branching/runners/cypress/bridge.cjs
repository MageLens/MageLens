// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const http = require('node:http');
const {randomUUID} = require('node:crypto');

class Bridge {
    constructor({timeout = 180000} = {}) {
        this.timeout = timeout; this.token = randomUUID(); this.serial = 0; this.pending = new Map(); this.queue = [];
        this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
        this.ready.catch(() => {});
        this.browser = new Promise((resolve, reject) => { this.resolveBrowser = resolve; this.rejectBrowser = reject; });
        this.browser.catch(() => {});
        this.startup = setTimeout(() => this.fail(new Error('Cypress queue did not become ready')), timeout);
        Promise.all([this.ready, this.browser]).then(() => clearTimeout(this.startup), () => {});
    }
    async listen() {
        this.server = http.createServer(async (request, response) => {
            try {
                if (request.method !== 'POST' || request.headers.authorization !== this.token) { response.writeHead(403); response.end(); return; }
                let body = '';
                for await (const bytes of request) { body += bytes; if (body.length > 8 * 1024 * 1024) throw new Error('Cypress bridge message too large'); }
                const message = JSON.parse(body);
                if (request.url === '/browser') { this.resolveBrowser(message); response.end('null'); return; }
                if (request.url !== '/next' || this.waiter) throw new Error('Unexpected Cypress bridge request');
                this.waiter = response;
                this.resolveReady();
                if (message.id !== undefined) {
                    const pending = this.pending.get(message.id);
                    if (!pending) throw new Error('Unknown Cypress command result');
                    clearTimeout(pending.timer); this.pending.delete(message.id); pending.resolve(message.value);
                }
                this.flush();
            } catch (error) { response.writeHead(500); response.end(JSON.stringify({error: error.message})); this.fail(error); }
        });
        await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(0, '127.0.0.1', resolve); });
        this.url = `http://127.0.0.1:${this.server.address().port}`;
        return this;
    }
    flush() {
        if (!this.waiter || !this.queue.length) return;
        const response = this.waiter; this.waiter = null;
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(this.queue.shift()));
    }
    call(operation, input = {}) {
        if (this.error) return Promise.reject(this.error);
        const id = ++this.serial;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => this.fail(new Error(`Cypress command timed out: ${operation}`)), this.timeout);
            this.pending.set(id, {resolve, reject, timer}); this.queue.push({id, operation, ...input}); this.flush();
        });
    }
    fail(error) {
        clearTimeout(this.startup);
        this.error ??= error; this.rejectReady(error); this.rejectBrowser(error);
        for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
        this.pending.clear(); this.queue = [];
        if (this.waiter) { this.waiter.end(JSON.stringify({operation: 'close'})); this.waiter = null; }
    }
    async close() {
        this.fail(new Error('Cypress bridge closed'));
        if (this.server) await new Promise(resolve => { this.server.close(resolve); this.server.closeAllConnections(); });
    }
}
module.exports = {Bridge};
