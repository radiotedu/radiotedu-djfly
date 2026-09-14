import { mapping } from '../connectome/load.mjs';
import { clamp01, validTrack, validateState } from '../music/candidates.mjs';

export function featureVector(current, candidate, state, compatibility) {
  if (!validTrack(current) || !validTrack(candidate)) throw new TypeError('Measured track features are required.');
  validateState(state);
  if (!Number.isFinite(compatibility) || compatibility < 0 || compatibility > 1) throw new TypeError('Invalid compatibility.');
  const normalize = (value, [low, high]) => clamp01((value - low) / (high - low));
  const result = {
    currentBpm: normalize(current.bpm, mapping.ranges.bpm),
    candidateBpmDifference: normalize(Math.abs(candidate.bpm - current.bpm), mapping.ranges.bpmDifference),
    energy: candidate.energy,
    loudness: normalize(candidate.loudnessLufs, mapping.ranges.loudnessLufs),
    bassEnergy: candidate.bassEnergy, midEnergy: candidate.midEnergy, highEnergy: candidate.highEnergy,
    rhythmicDensity: candidate.rhythmicDensity,
    spectralCentroid: normalize(candidate.spectralCentroidHz, mapping.ranges.spectralCentroidHz),
    harmonicCompatibility: compatibility, setEnergy: state.setEnergy,
    requestedEnergyDirection: (state.requestedEnergyDirection + 1) / 2,
    transitionOpportunity: state.transitionOpportunity, spectralFlatness: candidate.spectralFlatness
  };
  return Object.fromEntries(mapping.features.map(key => [key, result[key]]));
}

export function hash32(value, seed = 2166136261) {
  let result = seed >>> 0;
  for (const character of String(value)) result = Math.imul(result ^ character.charCodeAt(0), 16777619) >>> 0;
  return result;
}

export function encodeStimulus(graph, features, seed) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new TypeError('Seed must be a uint32.');
  const stimulus = new Float64Array(graph.nodes.length);
  for (const key of mapping.features) {
    if (!Number.isFinite(features[key]) || features[key] < 0 || features[key] > 1) throw new TypeError(`Invalid normalized ${key}.`);
    for (const index of graph.inputs[key]) {
      // Seeded gain is fixed for all candidates in a decision; it never creates visual activity.
      const gain = 0.9 + 0.2 * (hash32(graph.nodes[index].bodyId, seed) / 0xffffffff);
      stimulus[index] = features[key] * gain;
    }
  }
  return stimulus;
}
