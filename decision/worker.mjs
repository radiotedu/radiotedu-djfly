import { parentPort } from 'node:worker_threads';
import { FlyDecisionEngine } from './engine.mjs';
import { loadGraph } from '../connectome/load.mjs';
let fly;
try {
  const { graph, artifactSha256, sourceMode } = await loadGraph();
  if (sourceMode !== 'REAL_MALECNS') throw new Error('Phase 2 requires the real artifact.');
  fly = new FlyDecisionEngine(graph, { debug: true, artifactSha256 });
  parentPort.postMessage({ type: 'ready', available: true, artifactSha256, graphId: graph.graphId, sourceMode });
}
catch { parentPort.postMessage({ type: 'ready', available: false, reason: 'real-graph-unavailable' }); }
parentPort.on('message', message => {
  try {
    if (!fly) throw new Error('Real graph unavailable.');
    const result = fly.decide(message.request);
    const debug = result.debug;
    parentPort.postMessage({ id: message.id, result: { ...result, debug: debug ? {
      seed: debug.seed, candidates: debug.candidates, rejected: debug.rejected, artifactSha256: debug.artifactSha256
    } : null } });
  } catch { parentPort.postMessage({ id: message.id, error: 'real-decision-unavailable' }); }
});
