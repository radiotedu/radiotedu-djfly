export interface MusicTrack {
  id: string;
  bpm: number;
  camelotKey: string;
  energy: number;
  loudnessLufs: number;
  bassEnergy: number;
  midEnergy: number;
  highEnergy: number;
  rhythmicDensity: number;
  spectralCentroidHz: number;
  spectralFlatness: number;
  beatGridConfidence: number;
  playable: boolean;
  prepared: boolean;
  availableBlendBars: number;
}
export interface DJState {
  revision: string;
  setEnergy: number;
  requestedEnergyDirection: number; // -1..1
  transitionOpportunity: number;
  phraseAligned: boolean;
  headroomDb: number;
  maxShowOff: number;
}
export interface FlyDecision {
  selectedTrackId: string;
  selectedStrategyId: string;
  risk: number;
  energyDirection: number; // 0 = down, 0.5 = hold, 1 = up
  transitionAggressiveness: number;
  preferredBlendBars: number;
  showOff: number;
  seed: number;
  graphId: string;
  dataKind: 'malecns' | 'development-fixture';
  stateRevision: string;
}
export interface MixerAdapter {
  capabilities: string[];
  prepare(trackId: string): Promise<void>;
  snapshot(): Promise<{current: MusicTrack; state: DJState; pool: MusicTrack[]}>;
  /** Must compare revision atomically before scheduling DSP, and reject stale state. */
  executeTransition(plan: {
    trackId: string; strategyId: string; blendBars: number; expectedRevision: string;
    intent: FlyDecision;
  }): Promise<unknown>;
}
