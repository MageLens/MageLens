// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {EventEmitter} = require('node:events');
const {setTimeout: delay} = require('node:timers/promises');
class Cdp extends EventEmitter {
    constructor(socket) {
        super(); this.socket = socket; this.serial = 0; this.pending = new Map();
        socket.addEventListener('message', ({data}) => {
            const message = JSON.parse(data);
            if (!message.id) { this.emit(message.method, message.params); return; }
            const pending = this.pending.get(message.id);
            if (!pending) return;
            clearTimeout(pending.timer); this.pending.delete(message.id);
            if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
        });
        socket.addEventListener('close', () => this.fail(new Error('Chrome debugging connection closed')));
    }
    static async connect(port, timeout = 30000) {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
            try {
                const response = await fetch(`http://127.0.0.1:${port}/json/list`, {signal: AbortSignal.timeout(1000)});
                const pages = (await response.json()).filter(target => target.type === 'page');
                if (pages.length === 1) {
                    const socket = new WebSocket(pages[0].webSocketDebuggerUrl);
                    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, {once: true}); socket.addEventListener('error', reject, {once: true}); });
                    return new Cdp(socket);
                }
            } catch { /* Chrome is still starting. No test command is retried. */ }
            await delay(50);
        }
        throw new Error('Cypress Chrome target did not become available');
    }
    send(method, params = {}) {
        if (this.error) return Promise.reject(this.error);
        const id = ++this.serial;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Chrome command timed out: ${method}`)); }, 30000);
            this.pending.set(id, {resolve, reject, timer}); this.socket.send(JSON.stringify({id, method, params}));
        });
    }
    fail(error) {
        this.error = error;
        for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
        this.pending.clear();
    }
    close() { this.fail(new Error('Chrome debugging connection closed')); this.socket.close(); }
}
module.exports = {Cdp};
