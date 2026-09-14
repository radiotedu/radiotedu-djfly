import type { MusicTrack, DJState, FlyDecision, MixerAdapter } from './decision/contracts.js';
export type { MusicTrack, DJState, FlyDecision, MixerAdapter } from './decision/contracts.js';

export interface DecisionRequest {
  current: MusicTrack;
  state: DJState;
  pool: MusicTrack[];
  capabilities: string[];
  allowedTransitions?: Record<string, Array<{ id: string; bars: number[] }>>;
  seed?: number;
}
export interface Telemetry {
  source: { kind: 'malecns' | 'development-fixture'; dataset: string | null;
    mode: 'REAL_MALECNS' | 'DEVELOPMENT_FIXTURE';
    label: string; explanation: string; attribution: string; projectUrl: string; licenseUrl: string };
  nodes: Array<{ id: string; type: string | null; role: string; activity: number; stimulus: number; x: number; y: number }>;
  edges: Array<{ source: string; target: string; activity: number; synapses: number }>;
  paths: string[][];
  groups: Array<{ name: string; count: number; activity: number; stimulus: number }>;
  readouts: Record<string, number>;
  decision?: FlyDecision;
  phase: 'decision-complete' | 'awaiting-safe-candidates';
  artifactSha256: string | null;
  selection?: { approvedCandidateCount: number; preference: number; runnerUpPreference: number | null; preferenceMargin: number | null };
}
export interface DecisionResult {
  decision: FlyDecision | null;
  telemetry: Telemetry;
  reason?: 'no-safe-candidates';
  debug?: Record<string, unknown>;
}
export class FlyDecisionEngine {
  constructor(graph: unknown, options?: { allowFixture?: boolean; debug?: boolean; artifactSha256?: string | null;
    activityFactory?: (graph: unknown) => { run(stimulus: Float64Array): { state: Float64Array; residual: number; steps: number } } });
  decide(request: DecisionRequest): DecisionResult;
}
export class DJEngine {
  constructor(fly: Pick<FlyDecisionEngine, 'decide'>, adapter: MixerAdapter);
  perform(options?: { seed?: number }): Promise<DecisionResult & { executed: boolean }>;
}
export function createDJFly(options?: { graphPath?: string; allowFixture?: boolean; debug?: boolean }): Promise<FlyDecisionEngine>;
