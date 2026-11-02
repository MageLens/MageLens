// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const http = require('node:http');
async function startFixture() {
    let baseUrl;
    let authorizationOrigin;
    const application = http.createServer((req, res) => {
        const pathname = new URL(req.url, baseUrl).pathname;
        res.setHeader('content-type', 'text/html');
        if (pathname === '/start' || pathname === '/start-redirect-set') {
            const action = pathname === '/start' ? '/set' : '/redirect-set';
            res.end(`<form method="post" action="${action}"><button>Set message</button></form>`);
        } else if (['/redirect-set', '/redirect-next', '/return-hop'].includes(pathname)) {
            const destination = {'/redirect-set': '/set', '/redirect-next': '/next', '/return-hop': '/oauth-callback'}[pathname];
            res.writeHead(302, {location: destination});
            res.end();
        } else if (['/set', '/set-update', '/set-delete', '/set-redirect-next'].includes(pathname)) {
            res.setHeader('set-cookie', 'message=previous; Path=/; SameSite=Strict');
            const value = pathname === '/set-update' ? 'message=updated; Path=/; SameSite=Strict'
                : pathname === '/set-delete' ? 'message=; Path=/; SameSite=Strict; Max-Age=0'
                    : 'message=; Path=/; SameSite=Strict';
            const action = pathname === '/set-redirect-next' ? '/redirect-next' : '/next';
            res.end(`<form method="post" action="${action}"><button>Continue</button></form><script>document.cookie=${JSON.stringify(value)};</script>`);
        } else if (['/oauth-login', '/oauth-fast-login', '/oauth-multi-login'].includes(pathname)) {
            res.setHeader('set-cookie', 'oauth_state=csrf-token; Path=/; HttpOnly; SameSite=Lax');
            const destination = pathname === '/oauth-login' ? '/authorize' : pathname === '/oauth-multi-login' ? '/redirect-multi' : '/redirect';
            res.end(`<a href="${authorizationOrigin}${destination}">Authorize</a>`);
        } else if (pathname === '/oauth-callback') {
            const state = (req.headers.cookie || '').split('; ').find(cookie => cookie.startsWith('oauth_state='));
            res.end(`<pre id="received">${state || 'missing'}</pre>`);
        } else {
            const value = (req.headers.cookie || '').split('; ').find(cookie => cookie.startsWith('message='));
            res.end(`<pre id="received">${value || 'absent'}</pre>`);
        }
    });
    const authorization = http.createServer((req, res) => {
        const pathname = new URL(req.url, authorizationOrigin).pathname;
        if (pathname === '/redirect' || pathname === '/redirect-multi') {
            res.writeHead(302, {location: baseUrl + (pathname === '/redirect-multi' ? '/return-hop' : '/oauth-callback')});
            res.end();
        } else {
            res.setHeader('content-type', 'text/html');
            res.end('<form action="/redirect"><button>Authorize</button></form>');
        }
    });
    const close = async () => {
        for (const server of [application, authorization]) {
            server.closeAllConnections();
            if (server.listening) await new Promise(resolve => server.close(resolve));
        }
    };
    try {
        for (const server of [application, authorization]) {
            await new Promise((resolve, reject) => {
                server.once('error', reject);
                server.listen(0, '127.0.0.1', resolve);
            });
        }
        baseUrl = `http://localhost:${application.address().port}`;
        authorizationOrigin = `http://127.0.0.1:${authorization.address().port}`;
        return {baseUrl, authorizationOrigin, close};
    } catch (error) { await close(); throw error; }
}
module.exports = {startFixture};
