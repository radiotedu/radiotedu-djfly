import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep, basename } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { loadGraph, validateGraph, fixturePath, runtimeManifestPath, mapping } from '../connectome/load.mjs';
import { graphMetrics } from '../connectome/metrics.mjs';
import { createDJFly } from '../index.mjs';
import { LeakyPropagation } from '../decision/activity.mjs';
import { encodeStimulus } from '../decision/stimulus.mjs';
import { musicScenarios } from '../examples/scenarios.mjs';
import { createPreview } from '../scripts/preview.mjs';

const loaded = await loadGraph();
const { graph, artifactSha256, resolvedPath } = loaded;
const scenarios = musicScenarios();

test('normal runtime loads the reviewed MaleCNS artifact and validates its digest and identity', async () => {
  const manifest = JSON.parse(await readFile(runtimeManifestPath, 'utf8'));
  assert.equal(loaded.sourceMode, 'REAL_MALECNS');
  assert.equal(graph.provenance.dataset, 'male-cns:v1.0');
  assert.equal(graph.provenance.serverIdentity.tag, 'v1.0');
  assert.equal(artifactSha256, manifest.sha256);
  assert.equal(graph.graphId, manifest.graphId);
  assert(graph.nodes.every(node => /^[1-9][0-9]*$/.test(node.bodyId)));
  const result = (await createDJFly()).decide(scenarios[0].request);
  assert.equal(result.decision.dataKind, 'malecns');
  assert.equal(result.telemetry.source.mode, 'REAL_MALECNS');
  assert.equal(result.telemetry.artifactSha256, artifactSha256);
});

test('real graph structure and explicit type mappings retain all input-to-readout channels', () => {
  const metrics = graphMetrics(graph);
  assert.equal(metrics.nodes, graph.metrics.nodes);
  assert.equal(metrics.edges, graph.metrics.edges);
  assert.equal(metrics.isolatedNeurons, 0);
  assert.equal(metrics.weakComponents, 1);
  assert.equal(metrics.inputsReachingAnyOutput, metrics.roles.input);
  assert.equal(metrics.outputsReachedFromAnyInput, metrics.roles.output);
  assert.equal(metrics.edgeRolePairs['input->input'], undefined);
  assert.equal(metrics.largestStrongComponent, graph.metrics.largestStrongComponent);
  for (const channels of Object.values(metrics.channelReachability)) {
    for (const value of Object.values(channels)) assert.equal(value.reachableNeurons, value.totalNeurons);
  }
  for (const [feature, members] of Object.entries(graph.inputs)) {
    for (const index of members) assert(graph.selection.inputTypeChannels[graph.nodes[index].type].includes(feature));
  }
});

test('real runs replay exactly, remain bounded, reject unsafe candidates and have correct readouts', async () => {
  const fly = await createDJFly({ debug: true });
  const decisions = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('No network permitted during real runtime validation.'); };
  try {
    for (const scenario of scenarios) {
      const result = fly.decide(scenario.request);
      assert.deepEqual(result, fly.decide(scenario.request));
      assert.equal(result.decision.dataKind, 'malecns');
      assert(result.debug.candidates.some(c => c.id === result.decision.selectedTrackId));
      assert(result.debug.rejected.some(c => c.id === 'development-incompatible'));
      assert(!result.debug.candidates.some(c => c.id === 'development-incompatible'));
      const candidate = result.debug.candidates.find(c => c.id === result.decision.selectedTrackId);
      const state = new LeakyPropagation(graph).run(encodeStimulus(graph, candidate.features, result.decision.seed)).state;
      assert(state.every(x => Number.isFinite(x) && x >= 0 && x <= 1));
      const means = Object.fromEntries(Object.entries(graph.outputs).map(([key, members]) =>
        [key, members.reduce((sum, i) => sum + state[i], 0) / members.length]));
      const average = Object.values(means).reduce((sum, value) => sum + value, 0) / mapping.channels.length;
      for (const key of mapping.channels) {
        assert(Math.abs(candidate.readouts.channels[key] - (0.5 + 0.5 * Math.tanh(mapping.model.readoutGain * (means[key] - average)))) < 1e-12);
      }
      assert(Buffer.byteLength(JSON.stringify(result.telemetry)) < 65536);
      const actualEdges = new Set();
      for (let row = 0; row < graph.nodes.length; row++) for (let e = graph.edges.indptr[row]; e < graph.edges.indptr[row + 1]; e++) {
        actualEdges.add(`${graph.nodes[graph.edges.indices[e]].bodyId}|${graph.nodes[row].bodyId}`);
      }
      for (const edge of result.telemetry.edges) assert(actualEdges.has(`${edge.source}|${edge.target}`));
      for (const path of result.telemetry.paths) for (let i = 1; i < path.length; i++) assert(actualEdges.has(`${path[i - 1]}|${path[i]}`));
      decisions.push(result.decision);
    }
  } finally { globalThis.fetch = originalFetch; }
  assert(Math.max(...decisions.map(d => d.energyDirection)) - Math.min(...decisions.map(d => d.energyDirection)) > 0.01);
  assert(new Set(decisions.map(d => d.selectedStrategyId)).size >= 2);
});

test('real artifact serialization preserves decisions; missing, corrupted and substituted artifacts fail', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'djfly-real-test-'));
  assert(resolve(directory).startsWith(resolve(tmpdir()) + sep) && basename(directory).startsWith('djfly-real-test-'));
  try {
    const bytes = await readFile(resolvedPath), json = gunzipSync(bytes);
    const roundtrip = join(directory, 'roundtrip.json.gz');
    await writeFile(roundtrip, gzipSync(json, { level: 1 }));
    const next = await loadGraph(roundtrip);
    assert.deepEqual(next.graph, graph);
    const original = (await createDJFly()).decide(scenarios[0].request);
    const after = (await createDJFly({ graphPath: roundtrip })).decide(scenarios[0].request);
    assert.deepEqual(after.decision, original.decision);
    await assert.rejects(loadGraph(join(directory, 'missing.json.gz')), /ENOENT/);
    await assert.rejects(loadGraph(fixturePath), /fixture requires explicit/);
    const broken = join(directory, 'broken.json.gz');
    await writeFile(broken, Buffer.from([0x1f, 0x8b, 0x00, 0x00]));
    await assert.rejects(loadGraph(broken));
    const altered = structuredClone(graph); altered.provenance.serverIdentity.tag = 'v0.9';
    assert.throws(() => validateGraph(altered), /server dataset identity/);
    const changed = join(directory, 'changed.json');
    await writeFile(changed, JSON.stringify(altered));
    await assert.rejects(loadGraph(changed, { expectedSha256: artifactSha256 }), /SHA-256 mismatch/);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), artifactSha256);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('fixture mode remains explicit and is rejected in production', async () => {
  const oldNodeEnv = process.env.NODE_ENV, oldSource = process.env.DJFLY_GRAPH_SOURCE;
  try {
    process.env.NODE_ENV = 'development'; process.env.DJFLY_GRAPH_SOURCE = 'DEVELOPMENT_FIXTURE';
    const result = (await createDJFly()).decide(scenarios[0].request);
    assert.equal(result.telemetry.source.mode, 'DEVELOPMENT_FIXTURE');
    process.env.NODE_ENV = 'production';
    await assert.rejects(createDJFly(), /fixture forbidden in production/);
    process.env.DJFLY_GRAPH_SOURCE = 'REAL_MALECNS';
    assert.equal((await createDJFly()).decide(scenarios[0].request).decision.dataKind, 'malecns');
  } finally {
    if (oldNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldNodeEnv;
    if (oldSource === undefined) delete process.env.DJFLY_GRAPH_SOURCE; else process.env.DJFLY_GRAPH_SOURCE = oldSource;
  }
});

test('real HTTP preview uses default real data and exposes compact telemetry without graph/debug endpoints', async () => {
  const server = await createPreview();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/djfly/`;
  try {
    assert.equal((await fetch(base)).status, 200);
    const response = await fetch(base + 'api/telemetry');
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.telemetry.source.mode, 'REAL_MALECNS');
    assert.equal(data.telemetry.decision.dataKind, 'malecns');
    assert.equal(data.debugEnabled, false);
    assert.equal((await fetch(base + 'api/debug')).status, 404);
    assert.equal((await fetch(base + 'generated/malecns-v1.graph.json.gz')).status, 404);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
