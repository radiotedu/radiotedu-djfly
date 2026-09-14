import { mapping } from '../connectome/load.mjs';

export class LeakyPropagation {
  constructor(graph, parameters = mapping.model) {
    this.parameters = { ...parameters };
    const { steps, leak, recurrence, stimulusGain } = this.parameters;
    if (!Number.isInteger(steps) || steps < 1 || steps > 128 || !Number.isFinite(leak) || leak < 0 || leak >= 1
      || !Number.isFinite(recurrence) || recurrence < 0 || recurrence >= 1
      || !Number.isFinite(stimulusGain) || stimulusGain <= 0 || stimulusGain > 4) {
      throw new TypeError('Invalid bounded activity-model parameters.');
    }
    this.size = graph.nodes.length;
    this.offsets = Uint32Array.from(graph.edges.indptr);
    this.sources = Uint32Array.from(graph.edges.indices);
    this.weights = Float64Array.from(graph.edges.synapses, Math.sqrt);
    for (let target = 0; target < this.size; target++) {
      let total = 0;
      for (let e = this.offsets[target]; e < this.offsets[target + 1]; e++) total += this.weights[e];
      for (let e = this.offsets[target]; e < this.offsets[target + 1]; e++) this.weights[e] /= total;
    }
  }

  run(stimulus) {
    if (stimulus.length !== this.size || stimulus.some(value => !Number.isFinite(value) || value < 0 || value > 1.1)) {
      throw new TypeError('Invalid neural stimulus.');
    }
    let state = new Float64Array(this.size);
    let next = new Float64Array(this.size);
    const { steps, leak, recurrence, stimulusGain } = this.parameters;
    const offsets = this.offsets, sources = this.sources, weights = this.weights, size = this.size;
    let residual = 0;
    for (let step = 0; step < steps; step++) {
      residual = 0;
      for (let target = 0; target < size; target++) {
        let propagated = 0;
        for (let e = offsets[target]; e < offsets[target + 1]; e++) {
          propagated += weights[e] * state[sources[e]];
        }
        next[target] = leak * state[target] + (1 - leak) * Math.tanh(recurrence * propagated + stimulusGain * stimulus[target]);
        residual = Math.max(residual, Math.abs(next[target] - state[target]));
      }
      [state, next] = [next, state];
    }
    return { state, residual, steps };
  }
}
