// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.
const http = require('node:http');
http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  if (req.url === '/start') {
    res.end('<form method="post" action="/set"><button>Set message</button></form>');
  } else if (req.url === '/set') {
    res.setHeader('set-cookie', 'message=previous; Path=/; SameSite=Strict');
    res.end('<form method="post" action="/next"><button>Continue</button></form><script>document.cookie="message=; Path=/; SameSite=Strict";</script>');
  } else {
    const value = (req.headers.cookie || '').split('; ').find(cookie => cookie.startsWith('message='));
    res.end('<pre id="received">' + (value || 'absent') + '</pre>');
  }
}).listen(8123, '0.0.0.0');
