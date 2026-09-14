import { loadGraph } from './connectome/load.mjs';
import { FlyDecisionEngine } from './decision/engine.mjs';
export { FlyDecisionEngine } from './decision/engine.mjs';
export { DJEngine } from './mixer/controller.mjs';

export async function createDJFly({ graphPath, allowFixture = false, debug = false } = {}) {
  const { graph, artifactSha256, sourceMode } = await loadGraph(graphPath, { allowFixture });
  return new FlyDecisionEngine(graph, { allowFixture: sourceMode === 'DEVELOPMENT_FIXTURE', debug, artifactSha256 });
}
