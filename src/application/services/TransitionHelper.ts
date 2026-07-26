import { simulationRunCommandRepository } from '../../infrastructure/repositories/SimulationRunCommandRepository';
import { simulationRunQueryRepository } from '../../infrastructure/repositories/SimulationRunQueryRepository';
import { TransitionRequestHashCalculator, EventHashCalculator } from '../../domain/hashing/calculators/OtherCalculators';
import { RunChainAnchorCalculator } from '../../domain/hashing/calculators/RunChainAnchorCalculator';
import { IdempotencyKeyReusedError, InvalidOperationError } from '../../domain/errors/DomainErrors';
import { RunMode } from '../../domain/types/RunMode';
import { RunStatus } from '../../domain/types/RunStatus';
import { TransitionGuards } from '../../domain/guards/TransitionGuards';

export class TransitionHelper {
  static async transition(
    runId: string,
    version: number,
    expectedStatus: RunStatus,
    nextStatus: RunStatus,
    dto: { payload: any; idempotencyKey: string; eventType: string; reason?: string },
    actor: { type: string; id: string }
  ) {
    const requestHash = TransitionRequestHashCalculator.calculate(dto);
    const existingEvent = await simulationRunCommandRepository.findEventByIdempotencyKey(dto.idempotencyKey);
    if (existingEvent) {
      if (existingEvent.requestHash === requestHash) return existingEvent;
      throw new IdempotencyKeyReusedError();
    }

    const run = await simulationRunQueryRepository.findDetailById(runId);
    if (!run) throw new InvalidOperationError("Run not found");
    if (run.status !== expectedStatus) throw new InvalidOperationError("Status mismatch");

    TransitionGuards.validate(run.status as RunStatus, nextStatus, run.mode as RunMode);

    const extraUpdate: any = {};
    if (nextStatus === RunStatus.TERMINATED) extraUpdate.terminatedAt = new Date();
    if (nextStatus === RunStatus.SEALED) extraUpdate.sealedAt = new Date();
    if (nextStatus === RunStatus.RUNNING && run.startedAt == null) extraUpdate.startedAt = new Date();

    const payloadJson = JSON.stringify(dto.payload);
    const chainAnchor = RunChainAnchorCalculator.calculate(run.creationRequestHash, run.creationIdempotencyKey);
    
    const events = await simulationRunQueryRepository.listEvents(runId);
    const lastEvent = events[events.length - 1];
    if (!lastEvent) throw new Error("No previous event found");

    const eventPayload = {
      chainVersion: 'SIMULATION_RUN_EVENT_CHAIN_V1',
      runChainAnchor: chainAnchor,
      eventSequence: run.version + 1,
      eventType: dto.eventType,
      fromStatus: run.status as any,
      toStatus: nextStatus,
      simulationDateBefore: run.simulationDate ? run.simulationDate.toISOString().split('T')[0] : null,
      simulationDateAfter: run.simulationDate ? run.simulationDate.toISOString().split('T')[0] : null,
      actorType: actor.type,
      actorBusinessKey: actor.id,
      reason: dto.reason || null,
      idempotencyKey: dto.idempotencyKey,
      requestHash,
      payloadJson,
      previousHash: lastEvent.eventHash
    };

    const eventHash = EventHashCalculator.calculate(eventPayload);

    const result = await simulationRunCommandRepository.transitionWithEvent(
      runId,
      version,
      expectedStatus,
      nextStatus,
      extraUpdate,
      {
        ...eventPayload,
        eventHash,
      }
    );

    return result.run;
  }
}
