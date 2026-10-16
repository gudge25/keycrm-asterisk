const http = require('http');

const MAX_BODY_BYTES = 10 * 1024;

function createServer({ sharedSecret, routes, logger }) {
  return http.createServer((req, res) => {
    if (req.method !== 'POST' || !routes[req.url]) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }

    const provided = req.headers['x-keycrm-shared-secret'];
    if (provided !== sharedSecret) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    let body = '';
    let tooLarge = false;

    req.on('data', (chunk) => {
      if (tooLarge) return;
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        tooLarge = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'payload too large' }));
        req.destroy();
      }
    });

    req.on('end', async () => {
      if (tooLarge) return;

      let parsed;
      try {
        parsed = body ? JSON.parse(body) : {};
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON' }));
        return;
      }

      try {
        const result = await routes[req.url](parsed);
        res.writeHead(result.status || 200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result.body ?? {}));
      } catch (err) {
        const status = err.statusCode || 500;
        logger.error('http.route_error', { url: req.url, error: err.message });
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  });
}

module.exports = { createServer };
