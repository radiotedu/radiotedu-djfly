import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createPreview } from '../scripts/preview.mjs';

test('local preview serves real telemetry, replays seed and denies artifacts/debug when disabled', async () => {
  for (const debug of [false, true]) {
    const server = await createPreview({ fixture: true, debug });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}/djfly/`;
    try {
      for (const path of ['', 'app.mjs', 'style.css', 'api/telemetry']) {
        const response = await fetch(base + path);
        assert.equal(response.status, 200);
        assert(response.headers.get('content-security-policy').includes("connect-src 'self'"));
      }
      const initial = await (await fetch(base + 'api/telemetry')).json();
      assert.equal(initial.telemetry.source.kind, 'development-fixture');
      assert.equal(initial.debugEnabled, debug);
      assert.equal((await fetch(base + 'api/debug')).status, debug ? 200 : 404);
      for (const path of ['connectome/fixtures/development.graph.json', '.env', 'api/graph']) {
        assert.equal((await fetch(base + path)).status, 404);
      }
      if (debug) {
        const repeat = await fetch(base + 'api/rerun', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ seed: initial.telemetry.decision.seed }) });
        assert.equal(repeat.status, 200);
        assert.deepEqual((await repeat.json()).decision, initial.telemetry.decision);
        assert.equal((await fetch(base + 'api/rerun', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"seed":-1}' })).status, 400);
        assert.equal((await fetch(base + 'api/rerun', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://unrelated.test' }, body: '{"seed":1}' })).status, 403);
      }
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
});
