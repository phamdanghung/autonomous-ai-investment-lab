import { RunMode } from '../../../domain/types/RunMode';
import { RunStatus } from '../../../domain/types/RunStatus';
import { ActorType } from '../../../domain/types/ActorType';

export interface ISimulationRunCommandRepository {
  findCreationByIdempotencyKey(key: string): Promise<any | null>;
  findEventByIdempotencyKey(key: string): Promise<any | null>;
  createRunWithInitialEvent(
    data: { creationIdempotencyKey: string; creationRequestHash: string; configVersionId: string; mode: RunMode },
    eventData: { idempotencyKey: string; requestHash: string; actorType: string; actorBusinessKey: string; eventType: string; payloadJson: string; eventHash: string; previousHash: string; fromStatus: RunStatus | null; toStatus: RunStatus; simulationDateBefore: string | null; simulationDateAfter: string | null; reason: string | null; }
  ): Promise<{ run: any; event: any }>;
  bindDataOriginWithEvent(
    runId: string, version: number, expectedStatus: RunStatus,
    updateData: { dataOriginHash: string; canonicalStartDate: Date; simulationDate: Date; runBusinessKey: string },
    eventData: { idempotencyKey: string; requestHash: string; actorType: string; actorBusinessKey: string; eventType: string; payloadJson: string; eventHash: string; previousHash: string; fromStatus: RunStatus | null; toStatus: RunStatus; simulationDateBefore: string | null; simulationDateAfter: string | null; reason: string | null; }
  ): Promise<{ run: any; event: any }>;
  transitionWithEvent(
    runId: string, version: number, expectedStatus: RunStatus, nextStatus: RunStatus, additionalUpdateData: any,
    eventData: { idempotencyKey: string; requestHash: string; actorType: string; actorBusinessKey: string; eventType: string; payloadJson: string; eventHash: string; previousHash: string; fromStatus: RunStatus | null; toStatus: RunStatus; simulationDateBefore: string | null; simulationDateAfter: string | null; reason: string | null; }
  ): Promise<{ run: any; event: any }>;
}
