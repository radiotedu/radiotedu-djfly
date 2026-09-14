import { validTrack } from './candidates.mjs';

export function validatePool(pool) {
  if (pool?.schemaVersion !== 1 || !/^[\w-]{1,80}$/.test(pool.id) || !Number.isFinite(pool.bpm) || pool.bpm < 60 || pool.bpm > 200
    || !Array.isArray(pool.tracks) || pool.tracks.length > 10000) throw new TypeError('Invalid music pool manifest.');
  const seen = new Set();
  for (const track of pool.tracks) {
    if (!validTrack(track) || !/^[\w-]{1,100}$/.test(track.id) || seen.has(track.id)
      || typeof track.title !== 'string' || typeof track.artist !== 'string'
      || track.playbackBpm !== pool.bpm || Math.abs(pool.bpm / track.bpm - 1) > 0.06000001
      || !Number.isFinite(track.duration) || track.duration < 20 || track.duration > 600
      || !/^[-\w]+\.(?:wav|mp3|m4a|ogg|flac)$/.test(track.audioFile)
      || !Number.isFinite(track.decodedBytes) || track.decodedBytes <= 0 || track.decodedBytes > 200 * 1024 * 1024
      || !Array.isArray(track.tags) || !track.tags.every(tag => typeof tag === 'string')
      || (track.weight !== undefined && (!Number.isFinite(track.weight) || track.weight < 0 || track.weight > 10))
      || !track.rights?.authorized || !track.analysis?.reviewed
      || !Number.isFinite(track.grid?.firstDownbeat) || track.grid.firstDownbeat < 0
      || track.grid.beatsPerBar !== 4 || ![4, 8, 16].includes(track.grid.phraseBars)) throw new TypeError(`Invalid or unreviewed track: ${track?.id ?? 'unknown'}`);
    for (const region of [track.intro, track.outro]) {
      if (!region || !Number.isFinite(region.start) || !Number.isFinite(region.end) || region.start < 0 || region.end <= region.start || region.end > track.duration + 0.02) throw new TypeError(`Invalid transition region: ${track.id}`);
    }
    if (!Number.isFinite(track.cueIn) || track.cueIn < 0 || track.cueIn >= track.duration || track.outro.start <= track.cueIn) throw new TypeError(`Invalid cue: ${track.id}`);
    const bar = 240 / track.playbackBpm;
    for (const point of [track.cueIn, track.intro.start, track.intro.end, track.outro.start, track.outro.end]) {
      const offset = (point - track.grid.firstDownbeat) / bar;
      if (Math.abs(offset - Math.round(offset)) > .01) throw new TypeError(`Transition region is not on the reviewed bar grid: ${track.id}`);
    }
    if (!Array.isArray(track.waveform) || track.waveform.length > 256 || !track.waveform.every(v => Number.isFinite(v) && v >= 0 && v <= 1)) throw new TypeError('Invalid waveform overview.');
    seen.add(track.id);
  }
  return pool;
}

export function publicTrack(track) {
  if (!track) return null;
  const { id, title, artist, artwork, bpm, playbackBpm, camelotKey, duration, cueIn, intro, outro, grid, waveform, energy, decodedBytes, tags } = track;
  return { id, title, artist, artwork: artwork ?? null, bpm, playbackBpm, camelotKey, duration, cueIn, intro, outro, grid, waveform, energy, decodedBytes, tags,
    audioUrl: `/djfly/media/${encodeURIComponent(track.audioFile)}` };
}
