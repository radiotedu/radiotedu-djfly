import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fixturePath, loadGraph, validateGraph, mapping } from '../connectome/load.mjs';
import { FlyDecisionEngine } from '../decision/engine.mjs';
import { createDJFly, DJEngine } from '../index.mjs';
import { LeakyPropagation } from '../decision/activity.mjs';
import { encodeStimulus, featureVector } from '../decision/stimulus.mjs';
import { harmonicCompatibility, validStrategies } from '../music/candidates.mjs';

const { graph } = await loadGraph(fixturePath, { allowFixture: true });
const example = JSON.parse(await readFile(new URL('../examples/request.json', import.meta.url), 'utf8'));
const request = () => structuredClone(example);
const engine = () => new FlyDecisionEngine(graph, { allowFixture: true, debug: true });

test('fixture provenance requires explicit opt-in; missing artifact cannot start', async () => {
  await assert.rejects(loadGraph(fixturePath), /fixture requires explicit/);
  await assert.rejects(createDJFly({ graphPath: 'does-not-exist.json.gz' }), /ENOENT/);
  assert.equal(graph.provenance.dataset, null);
  assert(graph.nodes.every(n => n.bodyId.startsWith('fixture:')));
});

test('rejects malformed sparse graphs, duplicate IDs and empty or mislabeled populations', () => {
  const mutations = [g => { g.edges.indices[0] = g.nodes.length; },
    g => { g.edges.synapses[0] = NaN; }, g => { g.edges.indptr[2] = -1; },
    g => { g.nodes[1].bodyId = g.nodes[0].bodyId; },
    g => { g.inputs.energy = []; }, g => { g.outputs.risk = g.inputs.energy; },
    g => { g.provenance.kind = 'malecns'; }];
  for (const mutate of mutations) {
    const changed = structuredClone(graph); mutate(changed);
    assert.throws(() => validateGraph(changed, { allowFixture: true }), /Invalid DJ Fly graph/);
  }
});

test('same graph, request and seed replay exactly and candidate order does not matter', () => {
  const fly = engine();
  const first = fly.decide(request());
  assert.deepEqual(first, fly.decide(request()));
  const reversed = request(); reversed.pool.reverse();
  assert.deepEqual(first.decision, fly.decide(reversed).decision);
  assert.deepEqual(first.telemetry, fly.decide(reversed).telemetry);
  const otherSeed = request(); otherSeed.seed++;
  assert.notDeepEqual(first.debug.neuralInput, fly.decide(otherSeed).debug.neuralInput);
  const original = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Runtime tried to use the network.'); };
  try { assert.deepEqual(first.decision, engine().decide(request()).decision); }
  finally { globalThis.fetch = original; }
});

test('safety layer excludes incompatible, missing, unprepared and duplicate tracks', () => {
  const data = request();
  const invalid = structuredClone(data.pool[0]); invalid.id = 'missing'; delete invalid.energy;
  const unprepared = { ...data.pool[0], id: 'unprepared', prepared: false };
  data.pool.push(invalid, unprepared);
  const result = engine().decide(data);
  assert.equal(result.debug.candidates.length, 8);
  for (const id of ['development-incompatible', 'missing', 'unprepared']) {
    assert(result.debug.rejected.some(item => item.id === id));
    assert.notEqual(result.decision.selectedTrackId, id);
  }
  const duplicate = request(); duplicate.pool.push(duplicate.pool[0]);
  assert.throws(() => engine().decide(duplicate), /Duplicate track ID/);
  const none = request(); none.pool = [none.pool.at(-1)];
  assert.equal(engine().decide(none).decision, null);
  const noFeatures = request(); noFeatures.current.energy = Infinity;
  assert.throws(() => engine().decide(noFeatures), /missing\/invalid analysis/);
});

test('normalized features are explicit and bounded; unsupported music analysis fails closed', () => {
  const data = request();
  const features = featureVector(data.current, data.pool[0], data.state, 0.8);
  assert.deepEqual(Object.keys(features), mapping.features);
  assert.equal(features.candidateBpmDifference, 4 / 12);
  assert.equal(features.requestedEnergyDirection, 0.65);
  assert(Object.values(features).every(x => x >= 0 && x <= 1));
  assert.throws(() => encodeStimulus(graph, { ...features, energy: NaN }, 4), /Invalid normalized/);
  assert.throws(() => engine().decide({ ...data, seed: -1 }), /Seed/);
  assert.equal(harmonicCompatibility('12A', '1A'), 0.8);
  assert.equal(harmonicCompatibility('8A', '8B'), 0.9);
  assert.equal(harmonicCompatibility('8A', '3B'), 0);
});

test('activity is bounded, reproducible, silent without stimulus and depends on wiring', () => {
  const model = new LeakyPropagation(graph);
  assert(model.run(new Float64Array(graph.nodes.length)).state.every(x => x === 0));
  const saturated = model.run(new Float64Array(graph.nodes.length).fill(1.1));
  assert(saturated.state.every(x => x >= 0 && x < 1 && Number.isFinite(x)));
  const first = engine().decide(request());
  const changed = structuredClone(graph);
  // Change measured weights without changing memberships; neural outputs must respond.
  for (let row = 0; row < changed.nodes.length; row++) {
    if (changed.nodes[row].role === 'output' && changed.edges.indptr[row] < changed.edges.indptr[row + 1]) {
      changed.edges.synapses[changed.edges.indptr[row]] *= 50;
    }
  }
  const second = new FlyDecisionEngine(changed, { allowFixture: true, debug: true }).decide(request());
  assert.notDeepEqual(first.debug.candidates.map(c => c.readouts), second.debug.candidates.map(c => c.readouts));
  const values = first.debug.candidates.map(c => c.readouts.channels.preference);
  assert(Math.max(...values) - Math.min(...values) > 0.001);
});

test('telemetry reflects computed state and real fixture edges and stays compact', () => {
  const result = engine().decide(request());
  const chosen = result.debug.candidates.find(c => c.id === result.decision.selectedTrackId);
  const stimulus = encodeStimulus(graph, chosen.features, result.decision.seed);
  const state = new LeakyPropagation(graph).run(stimulus).state;
  const ids = new Map(graph.nodes.map((node, i) => [node.bodyId, i]));
  for (const node of result.telemetry.nodes) assert(Math.abs(node.activity - state[ids.get(node.id)]) <= 0.000051);
  const actual = new Set();
  for (let row = 0; row < graph.nodes.length; row++) {
    for (let e = graph.edges.indptr[row]; e < graph.edges.indptr[row + 1]; e++) {
      actual.add(`${graph.nodes[graph.edges.indices[e]].bodyId}|${graph.nodes[row].bodyId}`);
    }
  }
  for (const edge of result.telemetry.edges) assert(actual.has(`${edge.source}|${edge.target}`));
  for (const path of result.telemetry.paths) {
    assert.equal(graph.nodes[ids.get(path[0])].role, 'input');
    assert.equal(graph.nodes[ids.get(path.at(-1))].role, 'output');
    for (let i = 1; i < path.length; i++) assert(actual.has(`${path[i - 1]}|${path[i]}`));
  }
  assert(result.telemetry.nodes.length <= 192);
  assert(result.telemetry.edges.length <= 192);
  assert(Buffer.byteLength(JSON.stringify(result.telemetry)) < 65536);
  assert.equal(new FlyDecisionEngine(graph, { allowFixture: true }).decide(request()).debug, undefined);
});

test('readouts never expand available transitions or blend bars', () => {
  const data = request();
  data.capabilities = ['clean-blend']; data.state.maxShowOff = 0;
  const result = engine().decide(data);
  assert.equal(result.decision.selectedStrategyId, 'clean-blend');
  const candidate = data.pool.find(track => track.id === result.decision.selectedTrackId);
  assert(validStrategies(data.current, candidate, data.state, data.capabilities)[0].bars.includes(result.decision.preferredBlendBars));
  data.state.headroomDb = 1;
  assert.equal(engine().decide(data).decision, null);
  data.state.headroomDb = 8; data.state.phraseAligned = false;
  assert.equal(engine().decide(data).decision, null);
});

test('mixer revalidates after preparation and requires atomic revision contract', async () => {
  const snapshot = request();
  const calls = [];
  const adapter = { capabilities: snapshot.capabilities,
    async snapshot() { return structuredClone(snapshot); },
    async prepare(id) { calls.push(['prepare', id]); },
    async executeTransition(plan) { assert.equal(plan.expectedRevision, snapshot.state.revision); calls.push(['execute', plan]); } };
  const dj = new DJEngine(engine(), adapter);
  const result = await dj.perform();
  assert.equal(result.executed, true);
  assert.equal(calls[1][1].trackId, result.decision.selectedTrackId);
  adapter.prepare = async () => { snapshot.state.revision = 'changed'; };
  await assert.rejects(dj.perform(), /state changed/);
  assert.equal(calls.filter(c => c[0] === 'execute').length, 1);
  adapter.prepare = async id => { snapshot.pool.find(track => track.id === id).prepared = false; };
  await assert.rejects(dj.perform(), /no longer safe/);
});

test('overlapping mixer transitions and fabricated decisions are rejected', async () => {
  let unblock;
  const ready = new Promise(resolve => { unblock = resolve; });
  const data = request();
  const adapter = { capabilities: data.capabilities, async snapshot() { return structuredClone(data); },
    async prepare() { await ready; }, async executeTransition() {} };
  const dj = new DJEngine(engine(), adapter);
  const first = dj.perform();
  await assert.rejects(dj.perform(), /already being/);
  unblock(); await first;
  const fake = { decide() { return { decision: { selectedTrackId: 'outside-pool', selectedStrategyId: 'unsafe', stateRevision: data.state.revision } }; } };
  await assert.rejects(new DJEngine(fake, adapter).perform(), /no longer safe/);
});
