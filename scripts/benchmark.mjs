import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createDJFly } from '../index.mjs';
import { fixturePath } from '../connectome/load.mjs';

const args = process.argv.slice(2);
const allowFixture = args.includes('--fixture');
const path = args.find(arg => !arg.startsWith('--')) ?? (allowFixture ? fixturePath : undefined);
const fly = await createDJFly({ graphPath: path, allowFixture });
const debugFly = await createDJFly({ graphPath: path, allowFixture, debug: true });
const request = JSON.parse(await readFile(new URL('../examples/request.json', import.meta.url), 'utf8'));
const variants = [-0.6, 0, 0.8].map(direction => ({ ...structuredClone(request),
  state: { ...request.state, requestedEnergyDirection: direction, setEnergy: 0.55 + direction * 0.1 } }));
for (let i = 0; i < 3; i++) fly.decide(variants[i]);
const times = [];
for (let i = 0; i < 30; i++) {
  const start = performance.now();
  const result = fly.decide(variants[i % variants.length]);
  if (!result.decision) throw new Error('Benchmark requires eight safe candidates.');
  times.push(performance.now() - start);
}
times.sort((a, b) => a - b);
const diagnostics = variants.map(variant => debugFly.decide(variant));
const spreads = diagnostics.map(result => {
  if (result.debug.candidates.length !== 8) throw new Error('Benchmark lost safe candidates.');
  const preferences = result.debug.candidates.map(c => c.readouts.channels.preference);
  return Math.max(...preferences) - Math.min(...preferences);
});
console.log(JSON.stringify({ dataKind: diagnostics[0].decision.dataKind, samples: times.length,
  candidatesPerDecision: 8, medianMs: times[15], p95Ms: times[Math.ceil(times.length * 0.95) - 1],
  maxMs: times.at(-1), maxCandidatePreferenceSpread: Math.max(...spreads),
  maxTelemetryBytes: Math.max(...diagnostics.map(result => Buffer.byteLength(JSON.stringify(result.telemetry)))),
  nodeVersion: process.version, platform: process.platform, graphId: diagnostics[0].decision.graphId }));
