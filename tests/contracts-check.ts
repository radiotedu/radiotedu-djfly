import type { DecisionRequest } from '../index.mjs';
import type { EventRepository, PoolRepository, AuthorizedOperatorGateway, ScheduledEvent, TransitionPlan } from '../events/contracts.js';

export async function erpBoundary(events: EventRepository, pools: PoolRepository, operators: AuthorizedOperatorGateway) {
  const event: ScheduledEvent | undefined = (await events.list())[0];
  if (!event) return;
  const pool = await pools.get(event.poolId);
  return operators.execute({ type: 'force-next', eventId: event.id, actorId: 'authenticated-operator', expectedRevision: 'event:1',
    trackId: pool.tracks[0]?.id, reason: 'Operator-reviewed request' });
}
export function constrainedRequest(request: DecisionRequest, plan: TransitionPlan): DecisionRequest {
  return { ...request, allowedTransitions: { [request.pool[0].id]: [{ id: plan.strategyId, bars: [plan.bars] }] } };
}
