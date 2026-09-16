import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { ProgramCoordinator } from '../events/coordinator.mjs';
import { MemoryEventRepository, MemoryPoolRepository } from '../events/repository.mjs';
import { EventJournal } from '../telemetry/journal.mjs';
import { createPublicServer } from '../server/app.mjs';

function coordinator(clock = () => 1_000_000) {
  return new ProgramCoordinator({
    events: new MemoryEventRepository([]), pools: new MemoryPoolRepository([]),
    decisions: { ready: Promise.resolve(true), available: false, identity: {} },
    journal: new EventJournal(), clock
  });
}

const telemetry = {
  source: { mode: 'REAL_MALECNS' }, graphId: 'abc', decision: null,
  nodes: [{ id: '10013', type: 'KCab-m', role: 'input', activity: 0.9, stimulus: 0.8, x: 0.1, y: 0.2 }],
  edges: [], paths: [], groups: [], readouts: { preference: 0.7 }
};
const decision = { selectedTrackId: 'test-1', selectedStrategyId: 'clean-blend', preferredBlendBars: 8 };

test('broadcast snapshot overrides thought while fresh, then goes stale', () => {
  let now = 1_000_000;
  const c = coordinator(() => now);
  assert.equal(c.snapshot().thought, null);
  assert.equal(c.snapshot().broadcast, null);
  c.ingestBroadcast({ trackId: 'test-1', decidedAt: new Date(now).toISOString(), decision, telemetry });
  const fresh = c.snapshot();
  assert.equal(fresh.thought.source, 'BROADCAST_MALECNS');
  assert.equal(fresh.thought.telemetry.nodes.length, 1);
  assert.equal(fresh.broadcast.stale, false);
  now += 16 * 60 * 1000;
  const old = c.snapshot();
  assert.equal(old.broadcast.stale, true);
  assert.equal(old.thought, null);
  assert.throws(() => c.ingestBroadcast({ trackId: '' }), TypeError);
});

test('broadcast endpoint needs token, validates shape and feeds snapshot', async () => {
  const c = coordinator();
  const server = await createPublicServer({ coordinator: c, journal: c.journal });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/djfly/api/broadcast-telemetry`;
  const body = { trackId: 'test-1', decidedAt: new Date(1_000_000).toISOString(), decision, telemetry };
  try {
    delete process.env.DJFLY_BROADCAST_TOKEN;
    assert.equal((await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status, 404);
    process.env.DJFLY_BROADCAST_TOKEN = 'test-token-123';
    assert.equal((await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong' }, body: JSON.stringify(body) })).status, 401);
    assert.equal((await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token-123' }, body: JSON.stringify({ trackId: '' }) })).status, 400);
    const ok = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token-123' }, body: JSON.stringify(body) });
    assert.equal(ok.status, 202);
    const snap = c.snapshot();
    assert.equal(snap.thought.source, 'BROADCAST_MALECNS');
    assert.equal(snap.broadcast.trackId, 'test-1');
  } finally {
    delete process.env.DJFLY_BROADCAST_TOKEN;
    server.endStreams(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});
