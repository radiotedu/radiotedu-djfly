import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const CLIENT_EVENTS = new Set(['listening-started', 'track-started', 'transition-armed', 'transition-started', 'transition-completed',
  'deck-load-failure', 'fallback-used', 'playback-interruption', 'playback-resumed', 'visualizer-disabled', 'audio-error', 'missed-deadline']);

async function bodyOf(req, maxBytes = 16384) {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > maxBytes) throw new Error('Request too large.'); }
  return JSON.parse(body);
}

function validBroadcastTelemetry(telemetry) {
  if (telemetry === null) return true;
  if (!telemetry || typeof telemetry !== 'object' || !Array.isArray(telemetry.nodes)) return false;
  if (telemetry.nodes.length > 200 || !Array.isArray(telemetry.edges) || telemetry.edges.length > 300) return false;
  for (const n of telemetry.nodes) {
    if (!n || typeof n.id !== 'string' || typeof n.role !== 'string'
      || !Number.isFinite(n.activity) || !Number.isFinite(n.stimulus)) return false;
  }
  return true;
}

export async function createPublicServer({ coordinator, journal, mediaDirectory = resolve(ROOT, 'local/media'),
  assetDirectory = resolve(ROOT, 'dist'), publicOrigin = 'https://radiotedu.com', development = false }) {
  if (development && process.env.NODE_ENV === 'production') throw new Error('Development controls are forbidden in production.');
  const clients = new Set(), rates = new Map();
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  const broadcast = () => {
    const message = `event: state\ndata: ${JSON.stringify(coordinator.snapshot())}\n\n`;
    for (const res of clients) if (!res.write(message)) { res.end(); clients.delete(res); }
  };
  coordinator.onChange = broadcast;
  await coordinator.tick();
  let previous = '';
  const timer = setInterval(async () => {
    await coordinator.tick();
    const state = coordinator.snapshot();
    const identity = `${state.revision}:${state.dj.phase}:${state.dj.failure}:${state.broadcast?.trackId ?? '-'}:${state.broadcast?.receivedAt ?? 0}`;
    if (identity !== previous) { previous = identity; broadcast(); }
  }, 500);
  const keepAlive = setInterval(() => { for (const res of clients) res.write(': keepalive\n\n'); }, 15000);
  timer.unref(); keepAlive.unref();
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; media-src 'self' blob:; worker-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
    const loopbackHost = `127.0.0.1:${req.socket.localPort}`;
    const allowedHosts = new Set([loopbackHost, `localhost:${req.socket.localPort}`, new URL(publicOrigin).host]);
    if (!allowedHosts.has(req.headers.host)) return json(res, 403, { error: 'Unrecognized host.' });
    try {
      const url = new URL(req.url, publicOrigin);
      const pathname = decodeURIComponent(url.pathname);
      if (req.method === 'GET' && pathname === '/djfly') { res.writeHead(302, { Location: '/djfly/' }); return res.end(); }
      if (req.method === 'GET' && pathname === '/djfly/api/health') return json(res, coordinator.decisions.available ? 200 : 503,
        { status: coordinator.decisions.available ? 'ready' : 'safety-fallback', graphSource: coordinator.decisions.available ? 'REAL_MALECNS' : 'UNAVAILABLE', fixture: false });
      if (req.method === 'GET' && pathname === '/djfly/api/state') { await coordinator.tick(); return json(res, 200, coordinator.snapshot()); }
      if (req.method === 'GET' && pathname === '/djfly/api/events') {
        if (clients.size >= 200) return json(res, 503, { error: 'Use the snapshot endpoint.' });
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
        clients.add(res); res.write(`event: state\ndata: ${JSON.stringify(coordinator.snapshot())}\n\n`);
        req.on('close', () => clients.delete(res)); return;
      }
      if (pathname === '/djfly/api/dev') {
        if (!development || req.headers.host !== loopbackHost) return json(res, 404, { error: 'Not found.' });
        if (req.method === 'GET') return json(res, 200, { state: coordinator.snapshot(), journal: journal.events });
        if (req.method === 'POST' && req.headers.origin === `http://${loopbackHost}` && req.headers['content-type']?.startsWith('application/json')) {
          return json(res, 200, await coordinator.command(await bodyOf(req)));
        }
        return json(res, 403, { error: 'Same-origin development command required.' });
      }
      if (req.method === 'POST' && pathname === '/djfly/api/client-events') {
        const expected = req.headers.host === loopbackHost ? `http://${loopbackHost}` : publicOrigin;
        if (req.headers.origin !== expected || !req.headers['content-type']?.startsWith('application/json')) return json(res, 403, { error: 'Same-origin JSON required.' });
        const key = req.socket.remoteAddress, now = Date.now();
        const bucket = rates.get(key) ?? { since: now, count: 0 };
        if (now - bucket.since > 60000) { bucket.since = now; bucket.count = 0; }
        if (++bucket.count > 120) return json(res, 429, { error: 'Event limit.' });
        if (rates.size > 1000) rates.clear(); rates.set(key, bucket);
        const data = await bodyOf(req);
        if (!CLIENT_EVENTS.has(data.type)) return json(res, 400, { error: 'Unsupported event.' });
        const safe = { clientReported: true, eventId: coordinator.event?.id ?? null };
        for (const key of ['trackId', 'deck', 'strategyId', 'reason', 'sessionId']) if (typeof data[key] === 'string') safe[key] = data[key].slice(0, 160);
        journal.record(data.type, safe); return json(res, 202, { accepted: true });
      }
      if (req.method === 'POST' && pathname === '/djfly/api/broadcast-telemetry') {
        const expected = process.env.DJFLY_BROADCAST_TOKEN;
        if (!expected) return json(res, 404, { error: 'Not found.' });
        if (req.headers.authorization !== `Bearer ${expected}`) return json(res, 401, { error: 'Unauthorized broadcaster.' });
        if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 400, { error: 'JSON required.' });
        const key = `broadcast:${req.socket.remoteAddress}`, now = Date.now();
        const bucket = rates.get(key) ?? { since: now, count: 0 };
        if (now - bucket.since > 60000) { bucket.since = now; bucket.count = 0; }
        if (++bucket.count > 60) return json(res, 429, { error: 'Broadcast limit.' });
        rates.set(key, bucket);
        const data = await bodyOf(req, 131072);
        if (!data || typeof data.trackId !== 'string' || !data.trackId || data.trackId.length > 160) return json(res, 400, { error: 'Invalid broadcast track.' });
        if (data.decidedAt !== undefined && data.decidedAt !== null && typeof data.decidedAt !== 'string') return json(res, 400, { error: 'Invalid broadcast time.' });
        if (!validBroadcastTelemetry(data.telemetry ?? null)) return json(res, 400, { error: 'Invalid broadcast telemetry.' });
        coordinator.ingestBroadcast({ trackId: data.trackId, decidedAt: data.decidedAt ?? null, decision: data.decision ?? null, telemetry: data.telemetry ?? null });
        return json(res, 202, { accepted: true });
      }
      if (['GET', 'HEAD'].includes(req.method) && pathname.startsWith('/djfly/media/')) {
        const name = pathname.slice('/djfly/media/'.length);
        if (!coordinator.pool?.tracks.some(t => t.audioFile === name)) return json(res, 404, { error: 'Authorized audio not found.' });
        const path = resolve(mediaDirectory, name), info = await stat(path);
        let start = 0, end = info.size - 1, code = 200;
        if (req.headers.range) {
          const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
          if (!match || Number(match[1]) >= info.size || (match[2] && Number(match[2]) < Number(match[1]))) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); return res.end(); }
          start = Number(match[1]); end = Math.min(end, match[2] ? Number(match[2]) : end); code = 206;
        }
        res.writeHead(code, { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1,
          'Cache-Control': 'public, max-age=31536000, immutable', ...(code === 206 ? { 'Content-Range': `bytes ${start}-${end}/${info.size}` } : {}) });
        if (req.method === 'HEAD') return res.end();
        const stream = createReadStream(path, { start, end }); stream.on('error', () => res.destroy()); stream.pipe(res); return;
      }
      if (req.method === 'GET' && pathname.startsWith('/djfly/')) {
        const relative = pathname.slice('/djfly/'.length) || 'index.html';
        if (!/^(?:index\.html|assets\/[\w.-]+)$/.test(relative)) return json(res, 404, { error: 'Not found.' });
        const bytes = await readFile(resolve(assetDirectory, relative));
        const tag = '"' + createHash('sha256').update(bytes).digest('hex').slice(0, 16) + '"';
        if (req.headers['if-none-match'] === tag) { res.writeHead(304); return res.end(); }
        res.writeHead(200, { 'Content-Type': MIME[extname(relative)] ?? 'application/octet-stream', ETag: tag,
          'Cache-Control': relative === 'index.html' ? 'no-cache' : 'public, max-age=300' }); return res.end(bytes);
      }
      return json(res, 404, { error: 'Not found.' });
    } catch (error) {
      if (res.headersSent) return res.end();
      return json(res, error.code === 'ENOENT' ? 404 : 400, { error: 'Request unavailable. Check the event or authorized media configuration.' });
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  server.on('close', () => { clearInterval(timer); clearInterval(keepAlive); for (const res of clients) res.end(); coordinator.onChange = null; });
  server.endStreams = () => { for (const res of clients) res.end(); clients.clear(); };
  return server;
}
