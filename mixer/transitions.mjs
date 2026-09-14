import { strategyCatalog } from '../music/candidates.mjs';

export const barSeconds = bpm => 240 / bpm;
export const phraseAfter = (position, grid, bpm, phraseBars = grid.phraseBars) =>
  grid.firstDownbeat + Math.ceil(Math.max(0, position - grid.firstDownbeat) / (barSeconds(bpm) * phraseBars) - 1e-8) * barSeconds(bpm) * phraseBars;

export function transitionOptions(current, next, settings) {
  if (!current.analysis?.reviewed || !next.analysis?.reviewed || current.playbackBpm !== next.playbackBpm
    || current.beatGridConfidence < .85 || next.beatGridConfidence < .85) return [];
  const bar = barSeconds(current.playbackBpm);
  const available = Math.min((current.outro.end - current.outro.start) / bar, (next.intro.end - next.cueIn) / bar);
  return strategyCatalog.filter(s => settings.allowedTransitions.includes(s.id) && s.risk <= settings.riskCeiling && s.showOff <= settings.maxShowOff
    && (s.id !== 'short-loop' || current.outro.loopSafe === true))
    .map(s => ({ ...s, bars: s.bars.filter(b => b <= available + .001), preparationSeconds: s.id === 'short-loop' ? 8 : 5,
      requiredMetadata: ['reviewed-beat-grid', 'prepared-tempo', 'intro', 'outro'], idealBars: s.bars[0] }))
    .filter(s => s.bars.length);
}

export function transitionPlan({ current, next, strategyId, bars, startAt, settings }) {
  const valid = transitionOptions(current, next, settings).find(s => s.id === strategyId && s.bars.includes(bars));
  if (!valid || !Number.isFinite(startAt)) throw new Error('Transition plan violates the validated strategy set.');
  const duration = bars ? bars * barSeconds(current.playbackBpm) : .035;
  const automation = [
    { deck: 'out', param: 'gain', from: 1, to: 0, start: 0, end: duration, curve: 'equal-out' },
    { deck: 'in', param: 'gain', from: 0, to: 1, start: 0, end: duration, curve: 'equal-in' }
  ];
  const add = (deck, param, from, to, start, end) => automation.push({ deck, param, from, to, start: start * duration, end: end * duration, curve: 'linear' });
  if (strategyId === 'long-eq-blend') {
    add('out', 'low', 0, -24, .15, .8); add('in', 'low', -24, 0, .5, .95); add('in', 'high', -8, 0, .1, .6);
  } else if (strategyId === 'bass-swap') {
    add('out', 'low', 0, -30, .48, .52); add('in', 'low', -30, 0, .48, .52);
  } else if (strategyId === 'filter-sweep') {
    add('out', 'filter', 20000, 400, .2, 1); add('in', 'filter', 900, 20000, 0, .65);
  } else if (strategyId === 'echo-transition') {
    add('out', 'echo', 0, .3, .1, .35); add('out', 'echo', .3, 0, .65, 1);
    automation[0].end = duration * .65;
  }
  return { schemaVersion: 1, strategyId, bars, startAt, endAt: startAt + duration * 1000,
    duration, bpm: current.playbackBpm, preparationSeconds: valid.preparationSeconds, automation,
    loop: strategyId === 'short-loop' ? { start: current.outro.start, end: current.outro.start + barSeconds(current.playbackBpm) } : null };
}

export function automationValue(segment, seconds) {
  const t = Math.max(0, Math.min(1, (seconds - segment.start) / Math.max(.00001, segment.end - segment.start)));
  if (segment.curve === 'equal-in') return Math.sin(t * Math.PI / 2);
  if (segment.curve === 'equal-out') return Math.cos(t * Math.PI / 2);
  return segment.from + (segment.to - segment.from) * t;
}

export function safeIntent(candidate, revision, reason) {
  const strategy = candidate.strategies.find(s => s.id === 'clean-blend') ?? candidate.strategies.toSorted((a, b) => a.risk - b.risk)[0];
  if (!strategy) throw new Error('No safe fallback transition.');
  return { selectedTrackId: candidate.track.id, selectedStrategyId: strategy.id, preferredBlendBars: strategy.bars[0],
    risk: strategy.risk, energyDirection: .5, transitionAggressiveness: strategy.aggressiveness,
    showOff: strategy.showOff, stateRevision: revision, decisionSource: 'SAFETY_FALLBACK', fallbackReason: reason };
}

export function assertSafeIntent(decision, candidates, revision) {
  const candidate = candidates.find(c => c.track.id === decision?.selectedTrackId);
  if (!candidate || decision.stateRevision !== revision || !candidate.strategies.some(s => s.id === decision.selectedStrategyId && s.bars.includes(decision.preferredBlendBars))
    || !['risk', 'energyDirection', 'transitionAggressiveness', 'showOff'].every(k => Number.isFinite(decision[k]) && decision[k] >= 0 && decision[k] <= 1)) throw new Error('Invalid or stale Fly intent.');
  return candidate;
}
