// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const net = require('node:net');
const fs = require('node:fs');

if (process.env.MAGELENS_RUNNER === 'playwright' &&
    !fs.existsSync(require('/workspace/node_modules/@playwright/test').chromium.executablePath())) {
    throw new Error('Playwright Chromium is missing. Rerun ./install.sh --playwright.');
}

const desktop = new Promise((resolve, reject) => {
    const socket = net.connect({host: '127.0.0.1', port: 5900});
    let header = '';
    socket.setTimeout(2000, () => socket.destroy(new Error('VNC handshake timed out')));
    socket.on('error', reject);
    socket.on('data', chunk => {
        header += chunk.toString();
        if (header.length < 12) return;
        socket.destroy();
        if (/^RFB \d{3}\.\d{3}\n/.test(header)) resolve();
        else reject(new Error('Invalid VNC handshake'));
    });
    socket.on('end', () => reject(new Error('VNC closed before its handshake')));
});

const viewer = fetch('http://127.0.0.1:6080/vnc.html', {signal: AbortSignal.timeout(2000)})
    .then(async response => {
        await response.arrayBuffer();
        if (!response.ok) throw new Error(`Viewer returned HTTP ${response.status}`);
    });

Promise.all([desktop, viewer]).then(() => process.exit(0)).catch(error => {
    console.error(error.message);
    process.exit(1);
});
