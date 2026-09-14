import { selectCandidates } from './candidates.mjs';
import { transitionOptions } from '../mixer/transitions.mjs';
import { settingsFor } from '../events/domain.mjs';

export function generateCandidates({ current, pool, history, event, now, revision, excludedIds = [] }) {
  const settings = settingsFor(event);
  const recentArtists = new Set((settings.artistCooldownTracks ? history.slice(-settings.artistCooldownTracks) : []).map(h => h.artist?.toLocaleLowerCase('tr-TR')));
  const lastPlayed = new Map(history.map(h => [h.trackId, h.startAt]));
  const showOffCount = history.slice(-8).filter(h => h.showOff >= .65).length;
  const maxShowOff = showOffCount / 8 >= settings.showOffFrequency ? Math.min(settings.maxShowOff, .6) : settings.maxShowOff;
  const effective = { ...settings, maxShowOff };
  const rejected = [];
  const offered = [];
  for (const track of pool.tracks) {
    let reason;
    if (track.weight === 0) reason = 'disabled-in-pool';
    else if (excludedIds.includes(track.id)) reason = 'load-failure';
    else if (!track.analysis?.reviewed || !track.rights?.authorized) reason = 'unreviewed-or-unauthorized';
    else if (track.playbackBpm !== pool.bpm || Math.abs(pool.bpm / track.bpm - 1) > settings.maxTempoCorrection + 1e-8) reason = 'unprepared-tempo';
    else if (track.bpm < settings.bpmRange[0] || track.bpm > settings.bpmRange[1]) reason = 'event-bpm-range';
    else if (track.energy < settings.energyRange[0] || track.energy > settings.energyRange[1] || Math.abs(track.energy - current.energy) > settings.maxEnergyJump) reason = 'event-energy-rule';
    else if (settings.allowedTags.length && !track.tags.some(tag => settings.allowedTags.includes(tag))) reason = 'event-genre-rule';
    else if (track.tags.some(tag => settings.excludedTags.includes(tag))) reason = 'excluded-tag';
    else if (current.tags.length && track.tags.length && !track.tags.some(tag => current.tags.includes(tag))) reason = 'genre-distance';
    else if (recentArtists.has(track.artist.toLocaleLowerCase('tr-TR'))) reason = 'artist-cooldown';
    else if (lastPlayed.has(track.id) && now - lastPlayed.get(track.id) < settings.repeatCooldownMinutes * 60000) reason = 'track-cooldown';
    if (reason) rejected.push({ id: track.id, reason }); else offered.push(track);
  }
  const state = { revision, setEnergy: current.energy, requestedEnergyDirection: settings.requestedEnergyDirection,
    transitionOpportunity: .95, maxShowOff, headroomDb: 6, phraseAligned: true };
  const allowedTransitions = Object.fromEntries(offered.map(track => [track.id, transitionOptions(current, track, effective)]));
  const request = { current, state, pool: offered, capabilities: effective.allowedTransitions, allowedTransitions };
  const selected = selectCandidates(request);
  const candidates = selected.candidates.slice(0, settings.maxCandidates);
  rejected.push(...selected.rejected, ...selected.candidates.slice(settings.maxCandidates).map(c => ({ id: c.track.id, reason: 'candidate-budget' })));
  return { candidates, rejected, settings: effective, request: { ...request, pool: candidates.map(c => c.track),
    allowedTransitions: Object.fromEntries(candidates.map(c => [c.track.id, allowedTransitions[c.track.id]])) } };
}
