import { AudioDeck } from './deck.mjs';

export class WebAudioMixer {
  constructor({ contextFactory = () => new AudioContext({ latencyHint: 'playback', sampleRate: 44100 }), emit = () => {}, fetcher = fetch } = {}) {
    this.contextFactory = contextFactory; this.emit = emit; this.fetcher = fetcher;
    this.enabled = false; this.decks = []; this.clockOffset = 0; this.armed = new Set(); this.failures = new Map();
    this.phase = 'WAITING'; this.error = null; this.volume = .8; this.seen = new Set(); this.maxDecodedBytes = 192 * 1024 * 1024; this.epoch = 0;
  }
  async start(snapshot) {
    if (snapshot?.event.phase !== 'LIVE') throw new Error('This event is not live.');
    if (!this.context) {
      this.context = this.contextFactory();
      this.compressor = this.context.createDynamicsCompressor();
      this.compressor.threshold.value = -6; this.compressor.knee.value = 0; this.compressor.ratio.value = 20;
      this.compressor.attack.value = .003; this.compressor.release.value = .15;
      this.trim = this.context.createGain(); this.trim.gain.value = .7;
      this.master = this.context.createGain(); this.master.gain.value = 0;
      this.analyser = this.context.createAnalyser(); this.analyser.fftSize = 1024; this.analyser.smoothingTimeConstant = .75;
      this.compressor.connect(this.trim).connect(this.master).connect(this.context.destination);
      this.master.connect(this.analyser);
      this.decks = ['A', 'B'].map(id => new AudioDeck(this.context, id, this.compressor, this.emit));
      this.context.onstatechange = () => {
        if (this.enabled && this.context.state !== 'running') { this.phase = 'RECOVERING'; this.emit('playback-interruption', { reason: this.context.state }); }
      };
      this.timer = setInterval(() => { this.observe(); if (this.enabled && !this.starting) void this.reconcile(); }, 250);
    }
    await this.context.resume();
    if (this.context.state !== 'running') throw new Error('Audio needs another listening gesture.');
    this.enabled = true; this.error = null; this.starting = true;
    this.master.gain.setValueAtTime(0, this.context.currentTime);
    this.resetVoices(); this.emit('listening-started');
    try { await this.accept(snapshot, true); }
    finally { this.starting = false; this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, .08); }
  }
  async accept(snapshot, force = false) {
    const measuredOffset = snapshot.serverNow - Date.now();
    const jump = Math.abs(measuredOffset - this.clockOffset) > 1500;
    const eventChanged = this.latest && (this.latest.event.event?.id !== snapshot.event.event?.id || this.latest.event.event?.startAt !== snapshot.event.event?.startAt);
    this.clockOffset = force || jump || !this.latest ? measuredOffset : this.clockOffset * .8 + measuredOffset * .2;
    this.latest = snapshot;
    if (!this.enabled) return;
    if (snapshot.event.phase !== 'LIVE') { this.resetVoices(); this.enabled = false; this.phase = 'WAITING'; return; }
    if ((jump || eventChanged) && !force) this.resetVoices();
    return this.reconcile();
  }
  serverNow() { return Date.now() + this.clockOffset; }
  contextTime(wallTime) { return this.context.currentTime + (wallTime - this.serverNow()) / 1000; }
  resetVoices() { this.epoch++; for (const deck of this.decks) deck.stop(); this.armed.clear(); this.failures.clear(); this.seen.clear(); }
  async reconcile() {
    if (this.syncing || !this.enabled || this.context?.state !== 'running' || !this.latest?.program.length) return;
    this.syncing = true;
    const epoch = this.epoch;
    try {
      const now = this.serverNow();
      const program = this.latest.program;
      const active = program.filter(item => item.startAt <= now);
      const current = active.at(-1);
      const ongoing = current?.transition && current.transition.endAt > now;
      const desired = [...(ongoing ? active.slice(-2) : current ? [current] : []), ...program.filter(i => i.startAt > now).slice(0, 1)];
      for (const entry of desired) {
        let deck = this.decks.find(d => d.entry?.id === entry.id);
        if (deck?.source) continue;
        if ((this.failures.get(entry.id) ?? 0) > Date.now()) continue;
        deck ??= this.decks.find(d => !d.source && d.machine.value !== 'LOADING');
        if (!deck) continue;
        try {
          const used = this.decks.filter(d => d !== deck).reduce((n, d) => n + (d.buffer ? d.buffer.length * d.buffer.numberOfChannels * 4 : 0), 0);
          if (this.failNextLoad) { this.failNextLoad = false; throw new Error('Development audio load failure.'); }
          await deck.load(entry.track, { fetcher: this.fetcher, maxDecodedBytes: this.maxDecodedBytes - used });
          if (!this.enabled || this.latest.event.phase !== 'LIVE' || epoch !== this.epoch) { deck.stop(); break; }
          const late = this.serverNow() > entry.startAt;
          const anotherPlaying = this.decks.find(d => d !== deck && d.source && d.startedAt <= this.context.currentTime);
          if (late && anotherPlaying && !this.starting && entry.startAt > anotherPlaying.entry.startAt) {
            this.emit('missed-deadline', { trackId: entry.track.id, reason: 'preparation-late' });
            this.recoveryFade(anotherPlaying, deck, entry); continue;
          }
          const at = Math.max(this.context.currentTime + .12, this.contextTime(entry.startAt));
          const offset = entry.track.cueIn + Math.max(0, (this.serverNow() - entry.startAt) / 1000) + (late ? .12 : 0);
          deck.start(entry, at, offset, { gain: entry.transition && entry.startAt > this.serverNow() ? 0 : 1,
            stopAt: this.contextTime(Date.parse(this.latest.event.event.endAt)) });
          this.phase = 'PLAYING'; this.error = null;
        } catch (error) {
          this.failures.set(entry.id, Date.now() + 8000); this.phase = 'RECOVERING';
          this.error = 'Sıradaki kayıt yüklenemedi. Çalan parçanın güvenli çıkış bölümü korunuyor.';
          this.emit('fallback-used', { trackId: entry.track.id, reason: 'hold-current-outro' });
          this.emit('audio-error', { reason: error.message });
        }
      }
      for (const entry of desired.filter(i => i.transition)) {
        if (this.armed.has(entry.id)) continue;
        const incoming = this.decks.find(d => d.entry?.id === entry.id && d.source);
        const outgoing = this.decks.find(d => d !== incoming && d.source && d.entry.startAt < entry.startAt);
        if (!incoming) continue;
        if (!outgoing && entry.startAt > this.serverNow()) continue;
        const plan = entry.transition, start = this.contextTime(plan.startAt);
        if (outgoing && this.serverNow() > plan.endAt) continue;
        incoming.automate(plan, 'in', start);
        outgoing?.automate(plan, 'out', start);
        this.armed.add(entry.id);
        this.emit('transition-armed', { strategyId: plan.strategyId, trackId: entry.track.id });
      }
    } finally { this.syncing = false; }
  }
  recoveryFade(outgoing, incoming, entry) {
    const now = this.context.currentTime;
    outgoing.gain.gain.cancelScheduledValues(now); outgoing.gain.gain.setValueAtTime(outgoing.gain.gain.value, now);
    outgoing.gain.gain.linearRampToValueAtTime(0, now + 1); outgoing.echo.gain.setValueAtTime(0, now);
    outgoing.source.stop(now + 1.01);
    incoming.start(entry, now + 1.05, entry.track.cueIn + Math.max(0, (this.serverNow() - entry.startAt) / 1000) + 1.05,
      { gain: 0, stopAt: this.contextTime(Date.parse(this.latest.event.event.endAt)) });
    incoming.gain.gain.setValueAtTime(0, now + 1.05); incoming.gain.gain.linearRampToValueAtTime(1, now + 2.05);
    this.armed.add(entry.id); this.phase = 'RECOVERING';
    this.emit('fallback-used', { trackId: entry.track.id, reason: 'fade-and-rejoin-shared-program' });
  }
  observe() {
    if (!this.context || !this.enabled) return;
    for (const deck of this.decks) {
      const state = deck.snapshot();
      if (state.phase === 'TRANSITIONING') {
        this.phase = 'TRANSITIONING';
        if (!this.seen.has(state.entryId + ':transition')) { this.seen.add(state.entryId + ':transition'); this.emit('transition-started', { deck: state.id, strategyId: state.transition.strategyId }); }
      }
      if (state.transition && this.context.currentTime >= state.transition.contextEnd && !this.seen.has(state.entryId + ':complete')) {
        this.seen.add(state.entryId + ':complete'); this.emit('transition-completed', { deck: state.id, strategyId: state.transition.strategyId });
        if (!this.error) this.phase = 'PLAYING';
      }
    }
  }
  setVolume(value) {
    if (!Number.isFinite(value)) return;
    this.volume = Math.max(0, Math.min(1, value));
    this.master?.gain.setTargetAtTime(this.volume, this.context.currentTime, .02);
  }
  async pause() { this.enabled = false; this.phase = 'WAITING'; await this.context?.suspend(); }
  snapshot() { return { phase: this.phase, enabled: this.enabled, contextState: this.context?.state ?? 'uninitialized',
    decks: this.decks.map(d => d.snapshot()), error: this.error, volume: this.volume,
    decodedBytes: this.decks.reduce((n, d) => n + (d.buffer ? d.buffer.length * d.buffer.numberOfChannels * 4 : 0), 0) }; }
  async close() { clearInterval(this.timer); this.enabled = false; for (const deck of this.decks) deck.dispose(); await this.context?.close(); }
}
