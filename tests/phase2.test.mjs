import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createDJFly } from '../index.mjs';
import { StateMachine, eventAt, validateEvents, settingsFor } from '../events/domain.mjs';
import { MemoryEventRepository, MemoryPoolRepository } from '../events/repository.mjs';
import { validatePool } from '../music/manifest.mjs';
import { generateCandidates } from '../music/intelligence.mjs';
import { transitionOptions, transitionPlan, assertSafeIntent, automationValue } from '../mixer/transitions.mjs';
import { ProgramCoordinator } from '../events/coordinator.mjs';
import { EventJournal } from '../telemetry/journal.mjs';
import { createPublicServer } from '../server/app.mjs';

const original = JSON.parse(await readFile(new URL('../examples/request.json', import.meta.url), 'utf8'));
const baseTime = Date.parse('2026-10-02T18:00:00Z');
function event(settings = {}) { return { id: 'test-flight', title: 'Test event', description: 'Test metadata only', enabled: true, timezone: 'Europe/Istanbul',
  startAt: new Date(baseTime).toISOString(), endAt: new Date(baseTime + 3600000).toISOString(), poolId: 'test-pool', settings: { artistCooldownTracks: 0, repeatCooldownMinutes: .5, ...settings } }; }
function pool() {
  return validatePool({ schemaVersion: 1, id: 'test-pool', title: 'Synthetic test metadata', bpm: 120, tracks: Array.from({ length: 8 }, (_, i) => ({
    ...original.current, id: `test-${i}`, title: `Test ${i}`, artist: `Test artist ${i}`, bpm: 120, camelotKey: '8A', playbackBpm: 120,
    energy: .5 + i * .015, audioFile: `test-${i}.wav`, duration: 96, decodedBytes: 96 * 44100 * 8,
    cueIn: 0, intro: { start: 0, end: 32 }, outro: { start: 64, end: 96, loopSafe: true }, grid: { firstDownbeat: 0, beatsPerBar: 4, phraseBars: 8 },
    availableBlendBars: 16, beatGridConfidence: 1, playable: true, prepared: true, tags: ['house'], waveform: [0, .2, .1],
    rights: { authorized: true, source: 'test' }, analysis: { reviewed: true, gridBasis: 'test' }
  })) });
}
const real = await createDJFly({ debug: true });
const decisionAdapter = { ready: Promise.resolve(true), available: true, identity: { sourceMode: 'REAL_MALECNS' }, decide: async request => real.decide(request) };

test('event schedule uses explicit instants and Istanbul boundaries', () => {
  const events = validateEvents([event()]);
  assert.equal(eventAt([], baseTime).phase, 'IDLE');
  assert.equal(eventAt(events, baseTime - 1).phase, 'UPCOMING');
  assert.equal(eventAt(events, baseTime).phase, 'LIVE');
  assert.equal(eventAt(events, baseTime + 3600000).phase, 'ENDED');
  assert.throws(() => validateEvents([{ ...event(), startAt: '2026-10-02T21:00:00' }]));
  assert.throws(() => validateEvents([event(), { ...event(), id: 'overlap' }]));
  assert.throws(() => settingsFor(event({ maxTempoCorrection: .5 })));
});

test('music manifest rejects unauthorized, unreviewed and mismatched tempo audio', () => {
  for (const mutate of [t => { t.rights.authorized = false; }, t => { t.analysis.reviewed = false; }, t => { t.playbackBpm = 180; }, t => { t.audioFile = '../private.wav'; }]) {
    const data = pool(); mutate(data.tracks[0]); assert.throws(() => validatePool(data));
  }
});

test('music intelligence enforces history, artist, genre, event and six-candidate bounds', () => {
  const data = pool(), current = data.tracks[0];
  const result = generateCandidates({ current, pool: data, history: [], event: event(), now: baseTime, revision: 'r1' });
  assert.equal(result.candidates.length, 6);
  assert(!result.candidates.some(c => c.track.id === current.id));
  data.tracks[1].artist = 'Repeat'; data.tracks[2].tags = ['metal']; data.tracks[3].camelotKey = '2B'; data.tracks[4].energy = .95;
  const filtered = generateCandidates({ current, pool: data, history: [{ trackId: 'test-5', artist: 'Repeat', startAt: baseTime - 1000 }],
    event: event({ artistCooldownTracks: 2, repeatCooldownMinutes: 20 }), now: baseTime, revision: 'r2' });
  const reasons = new Set(filtered.rejected.map(r => r.reason));
  for (const reason of ['artist-cooldown', 'genre-distance', 'harmonic-distance', 'event-energy-rule', 'track-cooldown']) assert(reasons.has(reason), reason);
});

test('all seven transitions expose valid bounded plans and respect capability and risk ceilings', () => {
  const [a, b] = pool().tracks, settings = settingsFor(event());
  const options = transitionOptions(a, b, settings); assert.equal(options.length, 7);
  for (const option of options) {
    const plan = transitionPlan({ current: a, next: b, strategyId: option.id, bars: option.bars[0], startAt: baseTime, settings });
    assert(plan.endAt > plan.startAt); assert(plan.preparationSeconds >= 5);
    for (const segment of plan.automation) for (const t of [-1, 0, plan.duration / 2, plan.duration + 1]) assert(Number.isFinite(automationValue(segment, t)));
  }
  assert(transitionOptions(a, b, { ...settings, riskCeiling: .2 }).every(s => s.risk <= .2));
  assert.throws(() => transitionPlan({ current: a, next: b, strategyId: 'short-loop', bars: 32, startAt: baseTime, settings }));
  assert.equal(transitionOptions(a, { ...b, playbackBpm: 126 }, settings).length, 0);
});

test('real MaleCNS cannot escape the phase-two track and transition allowlist', () => {
  const data = pool(), generated = generateCandidates({ current: data.tracks[0], pool: data, history: [], event: event({ allowedTransitions: ['clean-blend'] }), now: baseTime, revision: 'real-safe' });
  const result = real.decide({ ...generated.request, seed: 42 });
  assert.equal(result.telemetry.source.mode, 'REAL_MALECNS');
  assert.equal(result.decision.selectedStrategyId, 'clean-blend');
  assertSafeIntent(result.decision, generated.candidates, 'real-safe');
  assert.throws(() => assertSafeIntent({ ...result.decision, selectedTrackId: 'not-approved' }, generated.candidates, 'real-safe'));
  assert.throws(() => assertSafeIntent({ ...result.decision, preferredBlendBars: 1000 }, generated.candidates, 'real-safe'));
});

test('program coordinator uses real decisions and joins an existing scheduled program', async () => {
  const journal = new EventJournal(), coordinator = new ProgramCoordinator({ events: new MemoryEventRepository([event()]), pools: new MemoryPoolRepository([pool()]),
    decisions: decisionAdapter, journal, clock: () => baseTime + 40000 });
  await coordinator.tick();
  const state = coordinator.snapshot();
  assert.equal(state.event.phase, 'LIVE'); assert.equal(state.program.length, 2);
  assert.equal(state.thought.source, 'REAL_MALECNS');
  assert.equal(state.program[1].startAt, baseTime + 64000);
  assert.equal(state.thought.telemetry.source.mode, 'REAL_MALECNS');
  assert(journal.events.some(e => e.type === 'malecns-decision'));
  await coordinator.tick(); assert.equal(coordinator.items.length, 2, 'A poll must not recompute a decision.');
});

test('unavailable or invalid neural output yields a labeled safe fallback, never a fixture', async () => {
  for (const decide of [async () => { throw new Error('Unavailable'); }, async () => ({ decision: { selectedTrackId: 'unsafe' } })]) {
    const journal = new EventJournal(), coordinator = new ProgramCoordinator({ events: new MemoryEventRepository([event()]), pools: new MemoryPoolRepository([pool()]),
      decisions: { ...decisionAdapter, decide }, journal, clock: () => baseTime + 40000 });
    await coordinator.tick(); const result = coordinator.snapshot();
    assert.equal(result.thought.source, 'SAFETY_FALLBACK'); assert.equal(result.thought.telemetry, null);
    assert.equal(result.thought.decision.selectedStrategyId, 'clean-blend');
    assert(journal.events.some(e => e.type === 'fallback-used'));
    assert(!JSON.stringify(result).includes('DEVELOPMENT_FIXTURE'));
  }
});

test('empty safe sets hold existing music and illegal state jumps are rejected', async () => {
  const data = pool(); data.tracks = data.tracks.slice(0, 1);
  const coordinator = new ProgramCoordinator({ events: new MemoryEventRepository([event()]), pools: new MemoryPoolRepository([data]),
    decisions: decisionAdapter, journal: new EventJournal(), clock: () => baseTime + 40000 });
  await coordinator.tick(); assert.equal(coordinator.snapshot().dj.failure, 'no-safe-candidates'); assert.equal(coordinator.items.length, 1);
  const machine = new StateMachine('EMPTY', { EMPTY: ['LOADING'], LOADING: ['READY'], READY: ['PLAYING'] });
  assert.throws(() => machine.move('PLAYING')); machine.move('LOADING'); machine.move('READY'); assert.equal(machine.move('PLAYING'), 'PLAYING');
});

test('public API exposes real compact state, isolates private files and disables developer commands', async () => {
  const journal = new EventJournal(), coordinator = new ProgramCoordinator({ events: new MemoryEventRepository([event()]), pools: new MemoryPoolRepository([pool()]),
    decisions: decisionAdapter, journal, clock: () => baseTime + 40000 });
  const server = await createPublicServer({ coordinator, journal }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/djfly`;
  try {
    const response = await fetch(base + '/api/state'); assert.equal(response.status, 200); const data = await response.json();
    assert.equal(data.graph.mode, 'REAL_MALECNS'); assert.equal(data.development, false);
    assert(Buffer.byteLength(JSON.stringify(data)) < 70000);
    for (const path of ['/api/dev', '/generated/runtime-manifest.json', '/connectome/fixtures/development.graph.json', '/media/private.wav']) assert.equal((await fetch(base + path)).status, 404, path);
    assert.equal((await fetch(base + '/api/client-events', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://wrong.invalid' }, body: '{"type":"track-started"}' })).status, 403);
  } finally { server.endStreams(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
