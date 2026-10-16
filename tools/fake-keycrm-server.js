// Standalone: stands in for KeyCRM's webhook URL during manual testing.
// Logs every inbound POST body. Point KEYCRM_WEBHOOK_URL at this
// server's address while testing against a real Asterisk box.
const http = require('http');

const port = Number(process.argv[2] || process.env.FAKE_KEYCRM_PORT || 9099);

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    console.log(`[fake-keycrm] ${new Date().toISOString()} ${req.method} ${req.url}`);
    try {
      console.log(JSON.stringify(JSON.parse(body), null, 2));
    } catch {
      console.log(body);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
});

server.listen(port, () => {
  console.log(`[fake-keycrm] listening on http://127.0.0.1:${port}`);
});
