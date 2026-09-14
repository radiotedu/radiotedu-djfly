import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createDJFly } from '../index.mjs';
import { fixturePath } from '../connectome/load.mjs';

export async function createPreview({ fixture = false, debug = false, graphPath } = {}) {
  const fly = await createDJFly({ graphPath: fixture ? fixturePath : graphPath, allowFixture: fixture, debug });
  const request = JSON.parse(await readFile(new URL('../examples/request.json', import.meta.url), 'utf8'));
  let latest = fly.decide(request);
  const assets = new Map(await Promise.all([
    ['', 'index.html', 'text/html; charset=utf-8'], ['app.mjs', 'app.mjs', 'text/javascript; charset=utf-8'],
    ['style.css', 'style.css', 'text/css; charset=utf-8']
  ].map(async ([route, file, type]) => [route, { bytes: await readFile(new URL(`../web/${file}`, import.meta.url)), type }])));
  return http.createServer(async (req, res) => {
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'");
    const host = req.headers.host;
    const expectedHost = `127.0.0.1:${req.socket.localPort}`;
    if (host !== expectedHost) return json(403, { error: 'Loopback preview host required.' });
    const pathname = new URL(req.url, `http://${expectedHost}`).pathname;
    if (req.method === 'GET' && pathname === '/djfly') { res.writeHead(302, { Location: '/djfly/' }); return res.end(); }
    if (req.method === 'GET' && pathname === '/djfly/api/telemetry') return json(200, { telemetry: latest.telemetry, debugEnabled: debug });
    if (req.method === 'GET' && pathname === '/djfly/api/debug' && debug) return json(200, latest.debug);
    if (req.method === 'POST' && pathname === '/djfly/api/rerun' && debug) {
      if ((req.headers.origin && req.headers.origin !== `http://${expectedHost}`)
        || req.headers['content-type'] !== 'application/json') return json(403, { error: 'Same-origin JSON required.' });
      try {
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 1024) return json(413, { error: 'Request too large.' });
        }
        const { seed } = JSON.parse(body);
        if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) return json(400, { error: 'Invalid seed.' });
        latest = fly.decide({ ...request, seed });
        return json(200, { decision: latest.decision });
      } catch { return json(400, { error: 'Invalid decision request.' }); }
    }
    const asset = pathname.startsWith('/djfly/') ? assets.get(pathname.slice('/djfly/'.length)) : null;
    if (req.method === 'GET' && asset) { res.writeHead(200, { 'Content-Type': asset.type }); return res.end(asset.bytes); }
    return json(404, { error: 'Not found.' });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await createPreview({ fixture: process.argv.includes('--fixture'), debug: process.argv.includes('--debug') });
  const port = Number(process.env.DJFLY_PREVIEW_PORT ?? 5189);
  server.listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${server.address().port}/djfly/`));
}
