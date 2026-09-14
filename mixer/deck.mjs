import { StateMachine } from '../events/domain.mjs';
import { automationValue } from './transitions.mjs';

const transitions = {
  EMPTY: ['LOADING'], LOADING: ['READY', 'ERROR', 'EMPTY'], READY: ['ARMED', 'PLAYING', 'LOADING', 'EMPTY'],
  ARMED: ['PLAYING', 'TRANSITIONING', 'READY', 'EMPTY'], PLAYING: ['TRANSITIONING', 'READY', 'EMPTY'],
  TRANSITIONING: ['PLAYING', 'READY', 'EMPTY'], ERROR: ['LOADING', 'EMPTY']
};

export class AudioDeck {
  constructor(context, id, destination, emit = () => {}) {
    this.context = context; this.id = id; this.emit = emit; this.machine = new StateMachine('EMPTY', transitions);
    this.buffer = null; this.source = null; this.entry = null; this.generation = 0;
    this.low = context.createBiquadFilter(); this.low.type = 'lowshelf'; this.low.frequency.value = 250;
    this.mid = context.createBiquadFilter(); this.mid.type = 'peaking'; this.mid.frequency.value = 1000; this.mid.Q.value = .7;
    this.high = context.createBiquadFilter(); this.high.type = 'highshelf'; this.high.frequency.value = 3500;
    this.filter = context.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 20000; this.filter.Q.value = .7;
    this.gain = context.createGain(); this.gain.gain.value = 0;
    this.echo = context.createGain(); this.echo.gain.value = 0;
    this.delay = context.createDelay(2); this.feedback = context.createGain(); this.feedback.gain.value = .28;
    this.wet = context.createGain(); this.wet.gain.value = .22;
    this.output = context.createGain();
    this.low.connect(this.mid).connect(this.high).connect(this.filter);
    this.filter.connect(this.gain).connect(this.output);
    this.filter.connect(this.echo).connect(this.delay).connect(this.wet).connect(this.output);
    this.delay.connect(this.feedback).connect(this.delay); this.output.connect(destination);
  }
  async load(track, { fetcher = fetch, maxDecodedBytes = 192 * 1024 * 1024 } = {}) {
    if (this.buffer && this.track?.id === track.id) return;
    if (this.source) throw new Error('Cannot replace an active deck.');
    if (track.decodedBytes > maxDecodedBytes) throw new Error('Audio exceeds the device memory budget.');
    const generation = ++this.generation;
    this.abort?.abort(); this.abort = new AbortController();
    this.machine.move('LOADING'); this.track = track; this.buffer = null;
    const timeout = setTimeout(() => this.abort.abort(), 15000);
    try {
      const response = await fetcher(track.audioUrl, { signal: this.abort.signal });
      if (!response.ok) throw new Error('Authorized audio could not be loaded.');
      const encoded = await response.arrayBuffer();
      if (encoded.byteLength > maxDecodedBytes) throw new Error('Encoded audio exceeds the device budget.');
      const buffer = await this.context.decodeAudioData(encoded);
      if (generation !== this.generation) return;
      if (buffer.length * buffer.numberOfChannels * 4 > maxDecodedBytes || Math.abs(buffer.duration - track.duration) > .25) throw new Error('Decoded audio does not match the prepared manifest.');
      this.buffer = buffer; this.machine.move('READY');
    } catch (error) {
      if (generation === this.generation) { this.machine.move('ERROR'); this.emit('deck-load-failure', { deck: this.id, trackId: track.id, reason: error.message }); }
      throw error;
    } finally { clearTimeout(timeout); }
  }
  setBuffer(buffer, track) {
    this.machine.move('LOADING'); this.buffer = buffer; this.track = track; this.machine.move('READY');
  }
  start(entry, at, offset, { gain = 1, stopAt, loop = null } = {}) {
    if (!this.buffer || this.source) throw new Error('Deck must be ready before starting.');
    this.resetParameters(); this.entry = entry; this.startedAt = at; this.offset = offset;
    this.loop = loop ?? this.track.outro;
    if (offset >= this.loop.end) offset = this.loop.start + (offset - this.loop.start) % (this.loop.end - this.loop.start);
    this.offset = offset;
    const source = this.context.createBufferSource(); source.buffer = this.buffer;
    source.playbackRate.value = 1; source.loop = true; source.loopStart = this.loop.start; source.loopEnd = this.loop.end;
    source.connect(this.low); this.source = source;
    this.gain.gain.setValueAtTime(gain, this.context.currentTime);
    this.delay.delayTime.value = 60 / this.track.playbackBpm;
    source.onended = () => { source.disconnect(); if (this.source === source) { this.source = null; this.machine.move('READY'); } };
    source.start(at, offset);
    if (Number.isFinite(stopAt)) source.stop(Math.max(at + .05, stopAt));
    this.machine.move(at > this.context.currentTime ? 'ARMED' : 'PLAYING');
    this.emit('track-started', { deck: this.id, trackId: this.track.id });
  }
  resetParameters() {
    const now = this.context.currentTime;
    for (const [param, value] of [[this.gain.gain, 0], [this.low.gain, 0], [this.mid.gain, 0], [this.high.gain, 0], [this.filter.frequency, 20000], [this.echo.gain, 0]]) {
      param.cancelScheduledValues(now); param.setValueAtTime(value, now);
    }
    this.transition = null;
  }
  automate(plan, role, contextStart) {
    this.transition = { ...plan, contextStart, contextEnd: contextStart + plan.duration };
    const now = this.context.currentTime, elapsed = now - contextStart;
    const groups = new Map();
    for (const segment of plan.automation.filter(s => s.deck === role)) {
      if (!groups.has(segment.param)) groups.set(segment.param, []);
      groups.get(segment.param).push(segment);
    }
    for (const [name, segments] of groups) {
      const param = name === 'filter' ? this.filter.frequency : name === 'gain' || name === 'echo' ? this[name].gain : this[name].gain;
      const sorted = segments.toSorted((a, b) => a.start - b.start);
      let value = sorted[0].from;
      for (const segment of sorted) if (elapsed >= segment.start) value = automationValue(segment, elapsed);
      param.cancelScheduledValues(now); param.setValueAtTime(value, now);
      for (const segment of sorted) {
        if (segment.end <= elapsed) continue;
        const begin = Math.max(segment.start, elapsed + .0001);
        const time = Math.max(now + .0001, contextStart + begin);
        const duration = segment.end - begin;
        if (duration <= 0) continue;
        if (segment.curve.startsWith('equal')) {
          const curve = Float32Array.from({ length: 129 }, (_, i) => automationValue(segment, begin + i / 128 * duration));
          param.setValueCurveAtTime(curve, time, duration);
        } else {
          param.setValueAtTime(automationValue(segment, begin), time);
          param.linearRampToValueAtTime(segment.to, contextStart + segment.end);
        }
      }
    }
    if (role === 'out' && this.source) {
      if (plan.loop) { this.loop = plan.loop; this.source.loopStart = plan.loop.start; this.source.loopEnd = plan.loop.end; }
      this.source.stop(Math.max(now + .05, contextStart + plan.duration + .025));
    }
  }
  snapshot() {
    const now = this.context.currentTime;
    if (this.source && now >= this.startedAt) {
      const phase = this.transition && now >= this.transition.contextStart && now < this.transition.contextEnd ? 'TRANSITIONING' : 'PLAYING';
      this.machine.move(phase);
    }
    let position = this.offset + Math.max(0, now - this.startedAt);
    if (this.loop && position >= this.loop.end) position = this.loop.start + (position - this.loop.start) % (this.loop.end - this.loop.start);
    return { id: this.id, phase: this.machine.value, track: this.track ?? null, entryId: this.entry?.id ?? null,
      position: Number.isFinite(position) ? position : 0, gain: this.gain.gain.value, hasAudio: Boolean(this.source),
      transition: this.transition, loaded: Boolean(this.buffer) };
  }
  stop() {
    ++this.generation; this.abort?.abort();
    if (this.source) { this.source.onended = null; try { this.source.stop(); } catch { /* Already ended by its scheduled stop. */ } this.source.disconnect(); this.source = null; }
    this.resetParameters();
    if (this.machine.value !== 'EMPTY') this.machine.move('EMPTY');
    this.entry = null; this.buffer = null; this.track = null;
  }
  dispose() { this.stop(); for (const node of [this.low, this.mid, this.high, this.filter, this.gain, this.echo, this.delay, this.feedback, this.wet, this.output]) node.disconnect(); }
}
