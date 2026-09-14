export const clamp01 = value => Math.max(0, Math.min(1, value));
const unit = value => Number.isFinite(value) && value >= 0 && value <= 1;
const positive = value => Number.isFinite(value) && value > 0;

export function harmonicCompatibility(left, right) {
  const a = /^(1[0-2]|[1-9])([AB])$/.exec(left ?? '');
  const b = /^(1[0-2]|[1-9])([AB])$/.exec(right ?? '');
  if (!a || !b) return 0;
  const distance = Math.abs(Number(a[1]) - Number(b[1]));
  if (distance === 0) return a[2] === b[2] ? 1 : 0.9;
  return a[2] === b[2] && (distance === 1 || distance === 11) ? 0.8 : 0;
}

export function validTrack(track) {
  return track && typeof track.id === 'string' && track.id.length > 0 && track.id.length <= 160
    && positive(track.bpm) && track.bpm >= 40 && track.bpm <= 240
    && harmonicCompatibility(track.camelotKey, track.camelotKey) === 1
    && ['energy', 'bassEnergy', 'midEnergy', 'highEnergy', 'rhythmicDensity', 'spectralFlatness', 'beatGridConfidence'].every(k => unit(track[k]))
    && Number.isFinite(track.loudnessLufs) && track.loudnessLufs >= -60 && track.loudnessLufs <= 0
    && Number.isFinite(track.spectralCentroidHz) && track.spectralCentroidHz >= 0 && track.spectralCentroidHz <= 24000
    && Number.isSafeInteger(track.availableBlendBars) && track.availableBlendBars >= 0;
}

export function validateState(state) {
  if (!state || typeof state.revision !== 'string' || !state.revision
    || !unit(state.setEnergy) || !unit(state.transitionOpportunity) || !unit(state.maxShowOff)
    || !Number.isFinite(state.requestedEnergyDirection) || Math.abs(state.requestedEnergyDirection) > 1
    || !Number.isFinite(state.headroomDb) || typeof state.phraseAligned !== 'boolean') {
    throw new TypeError('Invalid DJ state; provide measured features and a mixer revision.');
  }
}

export const strategyCatalog = Object.freeze([
  { id: 'clean-blend', bars: [8, 16, 32], risk: 0.1, aggressiveness: 0.15, showOff: 0, minOpportunity: 0.25, minHeadroom: 3 },
  { id: 'long-eq-blend', bars: [16, 32], risk: 0.15, aggressiveness: 0.1, showOff: 0.05, minOpportunity: 0.3, minHeadroom: 3 },
  { id: 'filter-sweep', bars: [8, 16], risk: 0.4, aggressiveness: 0.5, showOff: 0.3, minOpportunity: 0.5, minHeadroom: 6 },
  { id: 'bass-swap', bars: [4, 8], risk: 0.5, aggressiveness: 0.65, showOff: 0.4, minOpportunity: 0.65, minHeadroom: 6 },
  { id: 'echo-transition', bars: [4, 8], risk: 0.55, aggressiveness: 0.55, showOff: 0.45, minOpportunity: 0.65, minHeadroom: 6 },
  { id: 'short-loop', bars: [4], risk: 0.7, aggressiveness: 0.75, showOff: 0.7, minOpportunity: 0.8, minHeadroom: 6 },
  { id: 'controlled-cut', bars: [0], risk: 0.85, aggressiveness: 1, showOff: 0.8, minOpportunity: 0.9, minHeadroom: 6 }
]);

export function validStrategies(current, candidate, state, capabilities) {
  validateState(state);
  if (!validTrack(current) || !validTrack(candidate) || !state.phraseAligned
    || current.beatGridConfidence < 0.85 || candidate.beatGridConfidence < 0.85) return [];
  const supported = new Set(capabilities ?? []);
  return strategyCatalog.filter(s => supported.has(s.id) && state.headroomDb >= s.minHeadroom
    && state.transitionOpportunity >= s.minOpportunity && state.maxShowOff >= s.showOff)
    .map(s => ({ ...s, bars: s.bars.filter(bars => bars <= Math.min(current.availableBlendBars, candidate.availableBlendBars)) }))
    .filter(s => s.bars.length);
}

export function selectCandidates({ current, state, pool, capabilities = [], allowedTransitions }) {
  validateState(state);
  if (!validTrack(current)) throw new TypeError('Current track has missing/invalid analysis.');
  if (!Array.isArray(pool) || pool.length > 10000) throw new TypeError('Music pool must contain at most 10000 analyzed tracks.');
  const seen = new Set();
  const rejected = [];
  const candidates = [];
  for (const track of pool) {
    let reason;
    const compatible = validTrack(track) ? harmonicCompatibility(current.camelotKey, track.camelotKey) : 0;
    if (!validTrack(track)) reason = 'missing-or-invalid-analysis';
    else if (seen.has(track.id)) throw new TypeError(`Duplicate track ID: ${track.id}`);
    else if (track.id === current.id) reason = 'current-track';
    else if (!track.playable || !track.prepared) reason = 'not-prepared';
    else if (Math.abs(track.bpm / current.bpm - 1) > 0.06) reason = 'tempo-distance';
    else if (compatible === 0) reason = 'harmonic-distance';
    else if (Math.abs(track.energy - current.energy) > 0.3) reason = 'energy-jump';
    else if (Math.abs(track.loudnessLufs - current.loudnessLufs) > 6) reason = 'loudness-jump';
    if (typeof track?.id === 'string') seen.add(track.id);
    let strategies = reason ? [] : validStrategies(current, track, state, capabilities);
    if (allowedTransitions) {
      const allowed = allowedTransitions[track?.id] ?? [];
      strategies = strategies.map(strategy => ({ ...strategy,
        bars: strategy.bars.filter(bars => allowed.some(item => item.id === strategy.id && item.bars.includes(bars)))
      })).filter(strategy => strategy.bars.length);
    }
    if (!reason && !strategies.length) reason = 'no-valid-transition';
    if (reason) rejected.push({ id: track?.id ?? null, reason });
    else candidates.push({ track: structuredClone(track), harmonicCompatibility: compatible, strategies,
      safetyRank: Math.abs(track.bpm / current.bpm - 1) + (1 - compatible)
        + Math.abs(track.energy - clamp01(state.setEnergy + state.requestedEnergyDirection * 0.15)) });
  }
  candidates.sort((a, b) => a.safetyRank - b.safetyRank || compareIds(a.track.id, b.track.id));
  for (const candidate of candidates.slice(8)) rejected.push({ id: candidate.track.id, reason: 'candidate-budget' });
  return { candidates: candidates.slice(0, 8), rejected };
}

export function compareIds(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
