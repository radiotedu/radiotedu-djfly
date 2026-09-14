import type { MusicTrack, FlyDecision, Telemetry } from '../index.mjs';

export type EventPhase = 'IDLE' | 'UPCOMING' | 'LIVE' | 'ENDED';
export type DJPhase = 'WAITING' | 'PLAYING' | 'SEARCHING' | 'DECIDING' | 'PREPARING' | 'TRANSITIONING' | 'RECOVERING';
export type DeckPhase = 'EMPTY' | 'LOADING' | 'READY' | 'PLAYING' | 'ARMED' | 'TRANSITIONING' | 'ERROR';
export type DecisionSource = 'REAL_MALECNS' | 'SAFETY_FALLBACK' | 'MANUAL_OVERRIDE' | 'EVENT_START';
export interface DJFlySettings {
  riskCeiling: number; showOffFrequency: number; maxShowOff: number; maxTempoCorrection: number;
  bpmRange: [number, number]; energyRange: [number, number]; maxEnergyJump: number;
  requestedEnergyDirection: number; repeatCooldownMinutes: number; artistCooldownTracks: number;
  allowedTags: string[]; excludedTags: string[]; maxCandidates: number; decisionLeadSeconds: number; allowedTransitions: string[];
}
export interface ScheduledEvent {
  id: string; title: string; description: string; startAt: string; endAt: string;
  timezone: 'Europe/Istanbul'; enabled: boolean; poolId: string; startingTrackId?: string | null;
  artwork?: string | null; visualizerPreset?: 'orbit' | 'wave' | 'network'; replayUrl?: string | null;
  settings?: Partial<DJFlySettings>;
}
export interface PreparedTrack extends MusicTrack {
  title: string; artist: string; artwork?: string | null; audioFile: string; playbackBpm: number;
  duration: number; decodedBytes: number; cueIn: number; intro: { start: number; end: number }; outro: { start: number; end: number };
  grid: { firstDownbeat: number; beatsPerBar: 4; phraseBars: 4 | 8 | 16 }; waveform: number[]; tags: string[]; weight?: number;
  rights: { authorized: boolean; source: string }; analysis: { reviewed: boolean; gridBasis: string; sourceHash?: string };
}
export interface MusicPool { schemaVersion: 1; id: string; title: string; bpm: number; tracks: PreparedTrack[]; developmentAudio?: boolean }
export interface EventRepository { list(): Promise<ScheduledEvent[]> }
export interface PoolRepository { get(id: string): Promise<MusicPool> }
export interface AutomationSegment {
  deck: 'in' | 'out'; param: 'gain' | 'low' | 'mid' | 'high' | 'filter' | 'echo';
  from: number; to: number; start: number; end: number; curve: 'equal-in' | 'equal-out' | 'linear';
}
export interface TransitionPlan {
  schemaVersion: 1; strategyId: string; bars: number; startAt: number; endAt: number; duration: number;
  bpm: number; preparationSeconds: number; automation: AutomationSegment[]; loop: { start: number; end: number } | null;
}
export interface OperatorCommand {
  type: 'pause' | 'resume' | 'skip' | 'force-next' | 'manual-override' | 'emergency-stop';
  eventId: string; expectedRevision: string; actorId: string; trackId?: string; strategyId?: string; reason: string;
}
export interface AuthorizedOperatorGateway { execute(command: OperatorCommand): Promise<{ revision: string; accepted: boolean }> }
export interface DecisionObservation {
  source: DecisionSource; decision: FlyDecision | null; telemetry: Telemetry | null;
  candidates: Array<{ trackId: string; preference: number | null; strategies: string[] }>; rejected: Array<{ id: string; reason: string }>;
}
