const http = require('http');
const { URL } = require('url');

const MAX_BODY_BYTES = 10 * 1024;

function createServer({ sharedSecret, routes, logger }) {
  return http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, 'http://internal');
    const route = routes[parsedUrl.pathname];

    if (req.method !== 'POST' || !route) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }

    // KeyCRM's "Other" channel UI has no field for custom headers, so the
    // shared secret is also accepted as a ?token= query param on the URLs
    // configured in KeyCRM. The header is kept too for callers that can set it.
    const provided = req.headers['x-keycrm-shared-secret'] || parsedUrl.searchParams.get('token');
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
        const result = await route(parsed);
        res.writeHead(result.status || 200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result.body ?? {}));
      } catch (err) {
        const status = err.statusCode || 500;
        logger.error('http.route_error', { url: parsedUrl.pathname, error: err.message });
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  });
}

module.exports = { createServer };
