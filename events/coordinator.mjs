import { createHash } from 'node:crypto';
import { eventAt, settingsFor } from './domain.mjs';
import { generateCandidates } from '../music/intelligence.mjs';
import { publicTrack } from '../music/manifest.mjs';
import { assertSafeIntent, safeIntent, transitionPlan, barSeconds } from '../mixer/transitions.mjs';

export class ProgramCoordinator {
  constructor({ events, pools, decisions, journal, store, clock = Date.now, development = false }) {
    Object.assign(this, { events, pools, decisions, journal, store, clock, development });
    this.items = []; this.offset = 0; this.revision = 0; this.busy = null; this.status = 'WAITING';
    this.eventView = { phase: 'IDLE', event: null, next: null, secondsRemaining: 0 };
    this.failure = null; this.paused = false; this.seenPlayback = new Set();
  }
  now() { return this.clock() + this.offset; }
  async tick() {
    if (this.busy) return this.busy;
    this.busy = this.update().catch(() => { this.failure = 'event-or-pool-unavailable'; this.status = 'RECOVERING'; })
      .finally(() => { this.busy = null; });
    return this.busy;
  }
  async update() {
    const now = this.now();
    this.eventView = eventAt(await this.events.list(), now);
    const event = this.eventView.event;
    if (!event) return;
    if (this.event?.id !== event.id) {
      this.pool = await this.pools.get(event.poolId);
      this.event = event; this.items = []; this.failure = null; this.seenPlayback.clear();
      await this.decisions.ready;
      this.fingerprint = createHash('sha256').update(JSON.stringify({ event, pool: this.pool, graph: this.decisions.identity?.artifactSha256 })).digest('hex');
      const restored = await this.store?.load(event.id, this.fingerprint);
      if (restored?.length && restored.every(item => this.pool.tracks.some(t => t.id === item.trackId))) this.items = restored;
      this.journal.record('event-loaded', { eventId: event.id, restored: Boolean(restored?.length), sourceMode: this.decisions.identity?.sourceMode ?? 'UNAVAILABLE' });
    }
    if (this.eventView.phase !== 'LIVE') { this.status = 'WAITING'; return; }
    if (!this.items.length) {
      const settings = settingsFor(event);
      const first = this.pool.tracks.find(t => t.id === event.startingTrackId) ?? this.pool.tracks.find(t => t.bpm >= settings.bpmRange[0] && t.bpm <= settings.bpmRange[1]
        && t.energy >= settings.energyRange[0] && t.energy <= settings.energyRange[1]
        && (!settings.allowedTags.length || t.tags.some(tag => settings.allowedTags.includes(tag))) && !t.tags.some(tag => settings.excludedTags.includes(tag)));
      if (!first) { this.failure = 'no-authorized-starting-track'; this.status = 'RECOVERING'; return; }
      this.items.push({ id: `${event.id}:0`, trackId: first.id, startAt: Date.parse(event.startAt),
        decisionSource: 'EVENT_START', transition: null, thought: null });
      this.journal.record('session-start', { eventId: event.id, trackId: first.id });
    }
    let attempts = 0;
    while (!this.paused && attempts++ < 48) {
      const last = this.items.at(-1);
      const track = this.pool.tracks.find(t => t.id === last.trackId);
      const nominal = last.startAt + (track.outro.start - track.cueIn) * 1000;
      const startAt = Math.max(nominal, last.retryAt ?? 0);
      if (startAt >= Date.parse(event.endAt) || now < startAt - settingsFor(event).decisionLeadSeconds * 1000) break;
      if (!await this.planNext(startAt)) break;
    }
    for (const item of this.items) if (item.startAt <= now && !this.seenPlayback.has(item.id)) {
      this.seenPlayback.add(item.id);
      this.journal.record('track-started', { eventId: event.id, trackId: item.trackId, scheduledAt: item.startAt });
      if (item.transition) this.journal.record('transition-started', { transitionId: item.id, strategy: item.transition.strategyId, scheduledAt: item.startAt });
    }
    for (const item of this.items) if (item.transition?.endAt <= now && !this.seenPlayback.has(item.id + ':complete')) {
      this.seenPlayback.add(item.id + ':complete'); this.journal.record('transition-completed', { transitionId: item.id, scheduledAt: item.transition.endAt });
    }
    const current = this.items.findLast(i => i.startAt <= now);
    this.status = this.failure ? 'RECOVERING' : current?.transition?.endAt > now ? 'TRANSITIONING' : this.items.some(i => i.startAt > now) ? 'PREPARING' : 'PLAYING';
  }
  async planNext(startAt, overrideTrackId, overrideStrategy) {
    const last = this.items.at(-1), current = this.pool.tracks.find(t => t.id === last.trackId);
    const revision = `${this.event.id}:${this.items.length}`;
    this.status = 'SEARCHING';
    this.onChange?.();
    const history = this.items.map(item => ({ trackId: item.trackId, artist: this.pool.tracks.find(t => t.id === item.trackId).artist,
      startAt: item.startAt, showOff: item.thought?.decision?.showOff ?? 0 }));
    const generated = generateCandidates({ current, pool: this.pool, history, event: this.event, now: startAt, revision });
    this.journal.record('candidate-generation', { eventId: this.event.id, revision, candidateIds: generated.candidates.map(c => c.track.id), rejected: generated.rejected });
    if (!generated.candidates.length) {
      last.retryAt = startAt + barSeconds(current.playbackBpm) * current.grid.phraseBars * 1000;
      this.failure = 'no-safe-candidates'; this.journal.record('fallback-used', { revision, reason: this.failure, action: 'hold-current-outro' }); return false;
    }
    this.status = 'DECIDING';
    this.onChange?.();
    let result, decision, source = 'REAL_MALECNS';
    try {
      if (this.simulateDecisionFailure) { this.simulateDecisionFailure = false; throw new Error('development-failure'); }
      const seed = createHash('sha256').update(revision).digest().readUInt32LE(0);
      result = await this.decisions.decide({ ...generated.request, seed });
      decision = result.decision; assertSafeIntent(decision, generated.candidates, revision);
      if (result.telemetry?.source?.mode !== 'REAL_MALECNS') throw new Error('Real MaleCNS required.');
    } catch {
      decision = safeIntent(generated.candidates[0], revision, 'real-decision-unavailable'); source = 'SAFETY_FALLBACK'; result = null;
      this.journal.record('fallback-used', { revision, reason: decision.fallbackReason, selectedTrackId: decision.selectedTrackId });
    }
    if (overrideTrackId || overrideStrategy) {
      const candidate = generated.candidates.find(c => c.track.id === (overrideTrackId ?? decision.selectedTrackId));
      const strategy = candidate?.strategies.find(s => s.id === (overrideStrategy ?? decision.selectedStrategyId));
      if (!strategy) throw new Error('Operator override is outside the current safe set.');
      decision = { ...safeIntent(candidate, revision, 'operator-override'), selectedStrategyId: strategy.id, preferredBlendBars: strategy.bars[0] };
      source = 'MANUAL_OVERRIDE'; result = null;
    }
    const chosen = assertSafeIntent(decision, generated.candidates, revision);
    const transition = transitionPlan({ current, next: chosen.track, strategyId: decision.selectedStrategyId,
      bars: decision.preferredBlendBars, startAt, settings: generated.settings });
    const scores = new Map(result?.debug?.candidates.map(c => [c.id, c.readouts.channels.preference]) ?? []);
    const thought = { source, decision: { ...decision, decisionSource: source }, telemetry: result?.telemetry ?? null,
      candidates: generated.candidates.map(c => ({ track: publicTrack(c.track), preference: scores.get(c.track.id) ?? null,
        state: c.track.id === chosen.track.id ? 'SELECTED' : 'CONSIDERED', strategies: c.strategies.map(s => ({ id: s.id, bars: s.bars })) })),
      rejected: generated.rejected, consideredAt: this.now() };
    const item = { id: revision, trackId: chosen.track.id, startAt, transition, thought, decisionSource: source };
    this.items.push(item); this.revision++; this.failure = null;
    this.journal.record('malecns-decision', { revision, source, decision: thought.decision,
      candidates: result?.debug?.candidates ?? [], graphId: result?.telemetry?.graphId ?? null });
    this.journal.record('transition-selected', { revision, trackId: chosen.track.id, transition });
    try { await this.store?.save(this.event.id, this.fingerprint, this.items); }
    catch { this.journal.record('program-persistence-failed', { eventId: this.event.id }); }
    return true;
  }
  snapshot() {
    const now = this.now(), index = Math.max(0, this.items.findLastIndex(i => i.startAt <= now));
    const current = this.items[index], next = this.items[index + 1];
    const thought = next?.thought ?? current?.thought ?? null;
    const start = current?.transition?.endAt > now ? Math.max(0, index - 1) : index;
    const program = this.items.slice(start, index + 2).map(item => ({ id: item.id, startAt: item.startAt, transition: item.transition,
      decisionSource: item.decisionSource, track: publicTrack(this.pool.tracks.find(t => t.id === item.trackId)) }));
    return { schemaVersion: 1, serverNow: now, revision: `${this.event?.id ?? 'idle'}:${this.revision}:${this.eventView.phase}`,
      event: this.eventView, dj: { phase: this.paused ? 'WAITING' : this.status, failure: this.failure, paused: this.paused },
      development: this.development, developmentAudio: Boolean(this.pool?.developmentAudio),
      graph: { mode: this.decisions.available ? 'REAL_MALECNS' : 'UNAVAILABLE', artifactSha256: this.decisions.identity?.artifactSha256 ?? null },
      program, thought, logHealthy: !this.journal.failed };
  }
  async command(command) {
    if (!this.development) throw new Error('Operator transport is not configured.');
    await this.tick();
    if (command.type === 'phase') {
      const event = this.events.events?.[0]; if (!event) throw new Error('No development event.');
      const now = this.clock(); this.offset = 0;
      const start = command.value === 'UPCOMING' ? now + 60000 : command.value === 'ENDED' ? now - 7200000 : now - 65000;
      event.startAt = new Date(start).toISOString(); event.endAt = new Date(command.value === 'ENDED' ? now - 1000 : start + 3600000).toISOString();
      this.event = null; this.items = []; this.paused = false;
    } else if (command.type === 'decision-failure') this.simulateDecisionFailure = true;
    else if (command.type === 'pause') this.paused = true;
    else if (command.type === 'resume') this.paused = false;
    else if (command.type === 'emergency-stop') { this.events.events[0].endAt = new Date(this.now() - 1).toISOString(); }
    else if (command.type === 'seek-transition') {
      const next = this.items.find(i => i.startAt > this.now());
      if (!next) throw new Error('No prepared transition.'); this.offset = next.startAt - this.clock() - 6000;
    } else if (command.type === 'decide' || command.type === 'force-next') {
      const last = this.items.at(-1); if (!last) throw new Error('No current track.');
      if (last.startAt > this.now()) throw new Error('A transition is already armed.');
      const track = this.pool.tracks.find(t => t.id === last.trackId);
      await this.planNext(Math.max(this.now() + 10000, last.startAt + (track.outro.start - track.cueIn) * 1000), command.trackId, command.strategyId);
    } else throw new Error('Unknown development command.');
    this.journal.record('development-command', { command }); await this.tick(); return this.snapshot();
  }
}
