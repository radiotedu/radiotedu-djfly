export const EVENT_PHASES = Object.freeze(['IDLE', 'UPCOMING', 'LIVE', 'ENDED']);
export const DJ_PHASES = Object.freeze(['WAITING', 'PLAYING', 'SEARCHING', 'DECIDING', 'PREPARING', 'TRANSITIONING', 'RECOVERING']);
export const DECK_PHASES = Object.freeze(['EMPTY', 'LOADING', 'READY', 'PLAYING', 'ARMED', 'TRANSITIONING', 'ERROR']);
export const OPERATOR_COMMANDS = Object.freeze(['pause', 'resume', 'skip', 'force-next', 'manual-override', 'emergency-stop']);

export const defaultSettings = Object.freeze({
  riskCeiling: 0.85, showOffFrequency: 0.25, maxShowOff: 0.8, maxTempoCorrection: 0.06,
  bpmRange: [90, 140], energyRange: [0.15, 0.95], maxEnergyJump: 0.25,
  requestedEnergyDirection: 0, repeatCooldownMinutes: 20, artistCooldownTracks: 2,
  allowedTags: [], excludedTags: [], maxCandidates: 6, decisionLeadSeconds: 35,
  allowedTransitions: ['clean-blend', 'long-eq-blend', 'bass-swap', 'filter-sweep', 'echo-transition', 'short-loop', 'controlled-cut']
});

export function settingsFor(event) {
  const settings = { ...defaultSettings, ...event?.settings };
  for (const key of ['riskCeiling', 'showOffFrequency', 'maxShowOff', 'maxTempoCorrection', 'maxEnergyJump']) {
    if (!Number.isFinite(settings[key]) || settings[key] < 0 || settings[key] > 1) throw new TypeError(`Invalid setting: ${key}`);
  }
  if (settings.maxTempoCorrection > 0.06 || !Number.isInteger(settings.maxCandidates) || settings.maxCandidates < 1 || settings.maxCandidates > 6
    || !Number.isInteger(settings.artistCooldownTracks) || settings.artistCooldownTracks < 0
    || !Number.isFinite(settings.repeatCooldownMinutes) || settings.repeatCooldownMinutes < 0
    || !Number.isFinite(settings.decisionLeadSeconds) || settings.decisionLeadSeconds < 10 || settings.decisionLeadSeconds > 120
    || !Number.isFinite(settings.requestedEnergyDirection) || Math.abs(settings.requestedEnergyDirection) > 1) throw new TypeError('Invalid event safety settings.');
  for (const key of ['bpmRange', 'energyRange']) {
    if (!Array.isArray(settings[key]) || settings[key].length !== 2 || !settings[key].every(Number.isFinite) || settings[key][0] > settings[key][1]) throw new TypeError(`Invalid ${key}.`);
  }
  for (const key of ['allowedTags', 'excludedTags', 'allowedTransitions']) if (!Array.isArray(settings[key]) || !settings[key].every(x => typeof x === 'string')) throw new TypeError(`Invalid ${key}.`);
  return settings;
}

export function validateEvents(events) {
  if (!Array.isArray(events) || events.length > 1000) throw new TypeError('Expected an event list.');
  const ids = new Set();
  for (const event of events) {
    if (!event || !/^[\w-]{1,80}$/.test(event.id) || ids.has(event.id) || typeof event.title !== 'string' || !event.title.trim()
      || typeof event.enabled !== 'boolean' || event.timezone !== 'Europe/Istanbul' || !/^[\w-]{1,80}$/.test(event.poolId)
      || ![event.startAt, event.endAt].every(t => typeof t === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(t) && Number.isFinite(Date.parse(t)))
      || Date.parse(event.endAt) <= Date.parse(event.startAt)) throw new TypeError('Invalid event definition. Use explicit-offset ISO timestamps.');
    ids.add(event.id); settingsFor(event);
  }
  const enabled = events.filter(e => e.enabled).toSorted((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  for (let i = 1; i < enabled.length; i++) if (Date.parse(enabled[i].startAt) < Date.parse(enabled[i - 1].endAt)) throw new TypeError('Enabled DJ Fly events overlap.');
  return events;
}

export function eventAt(events, now = Date.now()) {
  if (!Number.isFinite(now)) throw new TypeError('Invalid clock.');
  const enabled = events.filter(e => e.enabled).toSorted((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  const current = enabled.find(e => Date.parse(e.startAt) <= now && now < Date.parse(e.endAt));
  const next = enabled.find(e => Date.parse(e.startAt) > now) ?? null;
  if (current) return { phase: 'LIVE', event: current, next, secondsRemaining: (Date.parse(current.endAt) - now) / 1000 };
  if (next) return { phase: 'UPCOMING', event: next, next, secondsRemaining: (Date.parse(next.startAt) - now) / 1000 };
  const ended = enabled.at(-1) ?? null;
  return { phase: ended ? 'ENDED' : 'IDLE', event: ended, next: null, secondsRemaining: 0 };
}

export function istanbulTime(iso) {
  return new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export class StateMachine {
  constructor(initial, transitions) { this.value = initial; this.transitions = transitions; }
  move(next) {
    if (next === this.value) return this.value;
    if (!this.transitions[this.value]?.includes(next)) throw new Error(`Invalid state transition ${this.value} -> ${next}`);
    this.value = next; return next;
  }
}
