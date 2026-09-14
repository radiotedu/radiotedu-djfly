import assert from 'node:assert/strict';
import { writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { loadGraph, mapping } from '../connectome/load.mjs';
import { graphMetrics } from '../connectome/metrics.mjs';
import { FlyDecisionEngine } from '../decision/engine.mjs';
import { LeakyPropagation } from '../decision/activity.mjs';
import { encodeStimulus } from '../decision/stimulus.mjs';
import { readouts } from '../decision/readout.mjs';
import { musicScenarios } from '../examples/scenarios.mjs';

const [path, output = 'generated/real-validation.json'] = process.argv.slice(2);
const { graph, artifactSha256, sourceMode, resolvedPath } = await loadGraph(path);
assert.equal(graph.provenance.kind, 'malecns');
const fly = new FlyDecisionEngine(graph, { debug: true, artifactSha256 });
const cases = [];
const model = new LeakyPropagation(graph);
const scenarios = musicScenarios();
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('Validation runtime attempted an internet request.'); };
try {
  for (const scenario of scenarios) {
    const result = fly.decide(scenario.request), repeated = fly.decide(scenario.request);
    assert(result.decision, `No safe decision in scenario ${scenario.id}`);
    assert.deepEqual(result, repeated);
    const selected = result.debug.candidates.find(c => c.id === result.decision.selectedTrackId);
    assert(selected);
    const stimulus = encodeStimulus(graph, selected.features, result.decision.seed);
    const activity = model.run(stimulus);
    assert(activity.state.every(x => Number.isFinite(x) && x >= 0 && x <= 1));
    const values = [...activity.state].sort((a, b) => a - b);
    const total = values.reduce((sum, value) => sum + value, 0);
    assert(total > 0);
    const ids = new Map(graph.nodes.map((node, i) => [node.bodyId, i]));
    for (const node of result.telemetry.nodes) assert(Math.abs(node.activity - activity.state[ids.get(node.id)]) <= 0.000051);
    const bytes = Buffer.byteLength(JSON.stringify(result.telemetry));
    assert(bytes < 65536);
    const means = Object.values(selected.readouts.means);
    const preferences = result.debug.candidates.map(c => c.readouts.channels.preference);
    const ablations = mapping.features.map(feature => {
      const altered = stimulus.slice();
      for (const index of graph.inputs[feature]) altered[index] = 0;
      const channels = readouts(graph, model.run(altered).state).channels;
      return { feature, totalReadoutChange: mapping.channels.reduce((sum, key) => sum + Math.abs(channels[key] - selected.readouts.channels[key]), 0) };
    });
    const totalInfluence = ablations.reduce((sum, item) => sum + item.totalReadoutChange, 0);
    cases.push({ id: scenario.id, description: scenario.description, decision: result.decision,
      readouts: selected.readouts, normalizedFeatures: selected.features,
      approvedCandidates: result.debug.candidates.map(c => ({ id: c.id, preference: c.readouts.channels.preference })),
      rejectedCandidates: result.debug.rejected, deterministic: true, telemetryBytes: bytes,
      featureAblations: ablations,
      activity: { min: values[0], median: values[Math.floor(values.length / 2)], max: values.at(-1),
        mean: total / values.length, fractionBelow1e6: values.filter(x => x < 1e-6).length / values.length,
        fractionAbove099: values.filter(x => x > 0.99).length / values.length,
        maxNeuronActivityShare: values.at(-1) / total,
        maxReadoutMeanShare: Math.max(...means) / means.reduce((sum, mean) => sum + mean, 0),
        maxInputFeatureImpactShare: Math.max(...ablations.map(item => item.totalReadoutChange)) / totalInfluence,
        residual: activity.residual, preferenceSpread: Math.max(...preferences) - Math.min(...preferences) } });
  }
} finally { globalThis.fetch = originalFetch; }
const tuning = [];
for (const steps of [8, 12, 16, 24, 32, 64]) {
  const custom = new FlyDecisionEngine(graph, { debug: true,
    activityFactory: g => new LeakyPropagation(g, { ...mapping.model, steps }) });
  let maxReadoutDifference = 0, changedSelections = 0, maxResidual = 0;
  const durations = [];
  for (let i = 0; i < scenarios.length; i++) {
    const start = performance.now(), result = custom.decide(scenarios[i].request);
    durations.push(performance.now() - start);
    const baseline = fly.decide(scenarios[i].request);
    if (result.decision.selectedTrackId !== baseline.decision.selectedTrackId) changedSelections++;
    for (const candidate of result.debug.candidates) {
      const reference = baseline.debug.candidates.find(c => c.id === candidate.id);
      for (const key of mapping.channels) maxReadoutDifference = Math.max(maxReadoutDifference,
        Math.abs(candidate.readouts.channels[key] - reference.readouts.channels[key]));
      maxResidual = Math.max(maxResidual, candidate.residual);
    }
  }
  tuning.push({ steps, comparisonSteps: mapping.model.steps, maxReadoutDifference, changedSelections, maxResidual,
    meanScenarioMs: durations.reduce((sum, value) => sum + value, 0) / durations.length });
}
const channelRanges = Object.fromEntries(mapping.channels.map(channel => {
  const values = cases.map(item => item.readouts.channels[channel]);
  return [channel, { min: Math.min(...values), max: Math.max(...values), range: Math.max(...values) - Math.min(...values) }];
}));
const meaningfulVariation = Object.values(channelRanges).some(channel => channel.range > 0.01);
const noDominantInput = cases.every(item => item.activity.maxInputFeatureImpactShare < 0.5);
const swapped = structuredClone(scenarios[0].request);
const winnerId = cases[0].decision.selectedTrackId;
const otherId = cases[0].approvedCandidates.find(candidate => candidate.id !== winnerId).id;
const winnerIndex = swapped.pool.findIndex(track => track.id === winnerId);
const otherIndex = swapped.pool.findIndex(track => track.id === otherId);
const winnerFeatures = swapped.pool[winnerIndex], otherFeatures = swapped.pool[otherIndex];
swapped.pool[winnerIndex] = { ...otherFeatures, id: winnerId };
swapped.pool[otherIndex] = { ...winnerFeatures, id: otherId };
const swappedResult = fly.decide(swapped);
assert.equal(swappedResult.decision.selectedTrackId, otherId, 'Candidate preference must follow features rather than a fixed ID.');
assert(cases.find(item => item.id === 'C').rejectedCandidates.some(c => c.id === 'development-incompatible'));
const report = { dataKind: graph.provenance.kind, dataset: graph.provenance.dataset, graphId: graph.graphId,
  artifactSha256, provenance: graph.provenance, generatedAt: new Date().toISOString(),
  artifactBytes: (await stat(resolvedPath)).size, artifactPath: resolvedPath, sourceMode,
  normalDefaultRuntime: !path, networkDisabledDuringDecisions: true,
  checks: { meaningfulVariation, noDominantInput },
  candidateFeatureSwap: { originalWinner: winnerId, afterFeatureSwap: swappedResult.decision.selectedTrackId,
    sameCandidateIds: true, expectedWinner: otherId, passed: true },
  model: mapping.model, mappingVersion: mapping.version, metrics: graphMetrics(graph),
  cases, channelRanges, stepExperiments: tuning };
await mkdir(dirname(resolve(output)), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(resolve(output));
if (!meaningfulVariation || !noDominantInput) process.exitCode = 2;
