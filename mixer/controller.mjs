import { selectCandidates } from '../music/candidates.mjs';

export class DJEngine {
  #fly;
  #adapter;
  #busy = false;

  constructor(fly, adapter) {
    if (!adapter || !['prepare', 'snapshot', 'executeTransition'].every(key => typeof adapter[key] === 'function')
      || !Array.isArray(adapter.capabilities)) throw new TypeError('A mixer execution adapter is required.');
    this.#fly = fly;
    this.#adapter = adapter;
  }

  async perform({ seed = 20260913 } = {}) {
    if (this.#busy) throw new Error('A DJ transition is already being planned/executed.');
    this.#busy = true;
    try {
      const before = await this.#adapter.snapshot();
      const result = this.#fly.decide({ ...before, capabilities: this.#adapter.capabilities, seed });
      if (!result.decision) return { ...result, executed: false };
      const decision = result.decision;
      const initialCandidate = selectCandidates({ ...before, capabilities: this.#adapter.capabilities })
        .candidates.find(c => c.track.id === decision.selectedTrackId);
      const initialStrategy = initialCandidate?.strategies.find(s => s.id === decision.selectedStrategyId);
      if (decision.stateRevision !== before.state.revision
        || !initialStrategy?.bars.includes(decision.preferredBlendBars)) {
        throw new Error('Selected track or transition is no longer safe.');
      }
      await this.#adapter.prepare(decision.selectedTrackId);
      const now = await this.#adapter.snapshot();
      if (now.state.revision !== decision.stateRevision || now.current.id !== before.current.id) {
        throw new Error('Mixer state changed during preparation. Recompute the decision.');
      }
      const { candidates } = selectCandidates({ ...now, capabilities: this.#adapter.capabilities });
      const candidate = candidates.find(c => c.track.id === decision.selectedTrackId);
      const strategy = candidate?.strategies.find(s => s.id === decision.selectedStrategyId);
      if (!strategy || !strategy.bars.includes(decision.preferredBlendBars)) {
        throw new Error('Selected track or transition is no longer safe.');
      }
      // The adapter must atomically reject a stale revision before it schedules audio operations.
      await this.#adapter.executeTransition({ trackId: decision.selectedTrackId,
        strategyId: decision.selectedStrategyId, blendBars: decision.preferredBlendBars,
        expectedRevision: decision.stateRevision, intent: structuredClone(decision) });
      return { ...result, executed: true };
    } finally {
      this.#busy = false;
    }
  }
}
