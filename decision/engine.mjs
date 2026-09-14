import { validateGraph } from '../connectome/load.mjs';
import { selectCandidates, compareIds } from '../music/candidates.mjs';
import { featureVector, encodeStimulus, hash32 } from './stimulus.mjs';
import { LeakyPropagation } from './activity.mjs';
import { readouts, chooseStrategy } from './readout.mjs';
import { visualizationState, publicSource } from '../telemetry/state.mjs';

export class FlyDecisionEngine {
  #graph;
  #activity;
  #debug;
  #artifactSha256;

  constructor(graph, { allowFixture = false, debug = false, artifactSha256 = null, activityFactory = g => new LeakyPropagation(g) } = {}) {
    this.#graph = structuredClone(validateGraph(graph, { allowFixture }));
    this.#activity = activityFactory(this.#graph);
    this.#debug = debug;
    this.#artifactSha256 = artifactSha256;
  }

  decide({ current, state, pool, capabilities, allowedTransitions, seed = 20260913 }) {
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new TypeError('Seed must be a uint32.');
    const { candidates, rejected } = selectCandidates({ current, state, pool, capabilities, allowedTransitions });
    if (!candidates.length) return { decision: null, reason: 'no-safe-candidates',
      telemetry: { source: publicSource(this.#graph), graphId: this.#graph.graphId, artifactSha256: this.#artifactSha256,
        phase: 'awaiting-safe-candidates', nodes: [], edges: [], paths: [], groups: [], readouts: {} },
      ...(this.#debug ? { debug: { seed, rejected, candidates: [] } } : {}) };
    const trials = candidates.map(candidate => {
      const features = featureVector(current, candidate.track, state, candidate.harmonicCompatibility);
      const stimulus = encodeStimulus(this.#graph, features, seed);
      const activity = this.#activity.run(stimulus);
      if (activity.state.length !== this.#graph.nodes.length || activity.state.some(x => !Number.isFinite(x) || x < 0 || x > 1)) {
        throw new Error('Activity engine returned an invalid state.');
      }
      return { candidate, features, stimulus, activity, readout: readouts(this.#graph, activity.state) };
    });
    trials.sort((a, b) => b.readout.channels.preference - a.readout.channels.preference
      || hash32(a.candidate.track.id, seed) - hash32(b.candidate.track.id, seed)
      || compareIds(a.candidate.track.id, b.candidate.track.id));
    const chosen = trials[0];
    const intent = chosen.readout.channels;
    const transition = chooseStrategy(chosen.candidate.strategies, intent);
    const decision = {
      selectedTrackId: chosen.candidate.track.id, selectedStrategyId: transition.strategyId,
      risk: intent.risk, energyDirection: intent.energyDirection,
      transitionAggressiveness: intent.transitionAggressiveness,
      preferredBlendBars: transition.bars, showOff: intent.showOff,
      seed, graphId: this.#graph.graphId, dataKind: this.#graph.provenance.kind, stateRevision: state.revision
    };
    const telemetry = visualizationState(this.#graph, chosen.activity.state, chosen.stimulus, intent);
    telemetry.decision = decision;
    telemetry.phase = 'decision-complete';
    telemetry.selection = { approvedCandidateCount: trials.length, preference: intent.preference,
      runnerUpPreference: trials[1]?.readout.channels.preference ?? null,
      preferenceMargin: trials.length > 1 ? intent.preference - trials[1].readout.channels.preference : null };
    telemetry.artifactSha256 = this.#artifactSha256;
    const result = { decision, telemetry };
    if (this.#debug) {
      result.debug = {
        seed, artifactSha256: this.#artifactSha256, graphId: this.#graph.graphId,
        request: structuredClone({ current, state, pool, capabilities, seed, ...(allowedTransitions ? { allowedTransitions } : {}) }), rejected,
        candidates: trials.map(trial => ({ id: trial.candidate.track.id, features: trial.features,
          validStrategies: trial.candidate.strategies, readouts: trial.readout,
          residual: trial.activity.residual, steps: trial.activity.steps })),
        neuralInput: Array.from(chosen.stimulus, (value, index) => ({ id: this.#graph.nodes[index].bodyId, value })).filter(n => n.value > 0),
        strongestGroups: [...telemetry.groups].sort((a, b) => b.activity - a.activity).slice(0, 10),
        finalDecision: decision
      };
    }
    return result;
  }
}
