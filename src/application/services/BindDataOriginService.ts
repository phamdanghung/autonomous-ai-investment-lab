import { simulationRunCommandRepository } from '../../infrastructure/repositories/SimulationRunCommandRepository';
import { simulationRunQueryRepository } from '../../infrastructure/repositories/SimulationRunQueryRepository';
import { TransitionRequestHashCalculator, EventHashCalculator } from '../../domain/hashing/calculators/OtherCalculators';
import { RunBusinessKeyCalculator } from '../../domain/hashing/calculators/RunBusinessKeyCalculator';
import { IdempotencyKeyReusedError, InvalidOperationError } from '../../domain/errors/DomainErrors';
import { RunMode } from '../../domain/types/RunMode';
import { RunStatus } from '../../domain/types/RunStatus';
import { CanonicalDate } from '../../domain/models/CanonicalDate';
import { TransitionGuards } from '../../domain/guards/TransitionGuards';
import { RunChainAnchorCalculator } from '../../domain/hashing/calculators/RunChainAnchorCalculator';

export class BindDataOriginService {
  static async execute(
    runId: string,
    version: number,
    dto: { dataOriginHash: string; canonicalStartDate: string; idempotencyKey: string },
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
    
    TransitionGuards.validate(run.status as RunStatus, RunStatus.CONFIGURED, run.mode as RunMode);

    const cDate = new CanonicalDate(dto.canonicalStartDate);
    const runBusinessKey = RunBusinessKeyCalculator.calculate(
      run.mode as RunMode,
      run.configVersion.contentHash,
      dto.dataOriginHash,
      run.configVersion.codeVersion,
      run.configVersion.rngSeed,
      cDate
    );

    const payloadJson = JSON.stringify({ dataOriginHash: dto.dataOriginHash, canonicalStartDate: dto.canonicalStartDate });
    const chainAnchor = RunChainAnchorCalculator.calculate(run.creationRequestHash, run.creationIdempotencyKey);
    
    // previousHash will be fetched internally inside the transaction by the repo, but we need it for the eventHash...
    // WAIT! The EventHash MUST include the previousHash. So we MUST fetch the previous event hash BEFORE transaction, 
    // OR the repository must calculate the event hash inside the transaction!
    // Since the instruction says CAS resolves concurrency, we can fetch the last event hash first, then hash it.
    // If it's a CAS failure, it throws anyway.
    
    const events = await simulationRunQueryRepository.listEvents(runId);
    const lastEvent = events[events.length - 1];
    if (!lastEvent) throw new Error("No previous event found");
    
    const eventPayload = {
      chainVersion: 'SIMULATION_RUN_EVENT_CHAIN_V1',
      runChainAnchor: chainAnchor,
      eventSequence: run.version + 1,
      eventType: 'DATA_BOUND',
      fromStatus: run.status as any,
      toStatus: RunStatus.CONFIGURED,
      simulationDateBefore: null,
      simulationDateAfter: cDate.value,
      actorType: actor.type,
      actorBusinessKey: actor.id,
      reason: 'Data origin bound',
      idempotencyKey: dto.idempotencyKey,
      requestHash,
      payloadJson,
      previousHash: lastEvent.eventHash
    };

    const eventHash = EventHashCalculator.calculate(eventPayload);

    const result = await simulationRunCommandRepository.bindDataOriginWithEvent(
      runId,
      version,
      RunStatus.INITIALIZED,
      {
        dataOriginHash: dto.dataOriginHash,
        canonicalStartDate: new Date(cDate.value),
        simulationDate: new Date(cDate.value),
        runBusinessKey,
      },
      {
        ...eventPayload,
        eventHash,
      }
    );
    return result.run;
  }
}
