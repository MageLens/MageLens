// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.
const http = require('node:http');
http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost:8123').pathname;
  console.log(JSON.stringify({phase: 'fixture', method: req.method, path: pathname, cookie: req.headers.cookie, fetchSite: req.headers['sec-fetch-site'], referer: req.headers.referer}));
  res.setHeader('content-type', 'text/html');
  if (pathname === '/start') {
    res.end('<form method="post" action="/set"><button>Set message</button></form>');
  } else if (['/set', '/set-update', '/set-delete'].includes(pathname)) {
    res.setHeader('set-cookie', 'message=previous; Path=/; SameSite=Strict');
    const value = pathname === '/set-update' ? 'message=updated; Path=/; SameSite=Strict'
      : pathname === '/set-delete' ? 'message=; Path=/; SameSite=Strict; Max-Age=0'
        : 'message=; Path=/; SameSite=Strict';
    res.end('<form method="post" action="/next"><button>Continue</button></form><script>document.cookie=' + JSON.stringify(value) + ';</script>');
  } else if (['/oauth-login', '/oauth-fast-login'].includes(pathname)) {
    res.setHeader('set-cookie', 'oauth_state=csrf-token; Path=/; HttpOnly; SameSite=Lax');
    const destination = pathname === '/oauth-login' ? '/authorize' : '/redirect';
    res.end('<a href="http://127.0.0.1:8124' + destination + '">Authorize</a>');
  } else if (pathname === '/oauth-callback') {
    const state = (req.headers.cookie || '').split('; ').find(cookie => cookie.startsWith('oauth_state='));
    res.end('<pre id="received">' + (state || 'missing') + '</pre>');
  } else {
    const value = (req.headers.cookie || '').split('; ').find(cookie => cookie.startsWith('message='));
    res.end('<pre id="received">' + (value || 'absent') + '</pre>');
  }
}).listen(8123, '0.0.0.0');
http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1:8124').pathname;
  console.log(JSON.stringify({phase: 'authorization', method: req.method, path: pathname, cookie: req.headers.cookie, fetchSite: req.headers['sec-fetch-site']}));
  if (pathname === '/redirect') {
    res.writeHead(302, {location: 'http://localhost:8123/oauth-callback'});
    res.end();
  } else {
    res.setHeader('content-type', 'text/html');
    res.end('<form action="/redirect"><button>Authorize</button></form>');
  }
}).listen(8124, '0.0.0.0');
