import { simulationRunCommandRepository } from '../../infrastructure/repositories/SimulationRunCommandRepository';
import { runCoreConfigRepository } from '../../infrastructure/repositories/RunCoreConfigRepository';
import { ConfigContentHashCalculator, CreationRequestHashCalculator, EventHashCalculator } from '../../domain/hashing/calculators/OtherCalculators';
import { RunChainAnchorCalculator } from '../../domain/hashing/calculators/RunChainAnchorCalculator';
import { IdempotencyKeyReusedError } from '../../domain/errors/DomainErrors';
import { RunMode } from '../../domain/types/RunMode';
import { RunStatus } from '../../domain/types/RunStatus';
import { ActorType } from '../../domain/types/ActorType';

export class CreateSimulationRunService {
  static async execute(
    dto: { configData: any; mode: RunMode; creationIdempotencyKey: string },
    actor: { type: string; id: string }
  ) {
    const creationRequestHash = CreationRequestHashCalculator.calculate(dto);
    const existingRun = await simulationRunCommandRepository.findCreationByIdempotencyKey(dto.creationIdempotencyKey);
    if (existingRun) {
      if (existingRun.creationRequestHash === creationRequestHash) return existingRun;
      throw new IdempotencyKeyReusedError();
    }

    const configContentHash = ConfigContentHashCalculator.calculate(dto.configData);
    let config = await runCoreConfigRepository.findByContentHash(configContentHash);
    if (!config) config = await runCoreConfigRepository.createSealed(dto.configData, configContentHash);
    if (!config) {
      config = await runCoreConfigRepository.findByContentHash(configContentHash);
      if (!config) throw new Error("Failed to resolve config race");
    }

    const chainAnchor = RunChainAnchorCalculator.calculate(creationRequestHash, dto.creationIdempotencyKey);
    const payloadJson = JSON.stringify({ mode: dto.mode });

    const eventPayload = {
      chainVersion: 'SIMULATION_RUN_EVENT_CHAIN_V1',
      runChainAnchor: chainAnchor,
      eventSequence: 1,
      eventType: 'RUN_CREATED',
      fromStatus: null,
      toStatus: RunStatus.INITIALIZED,
      simulationDateBefore: null,
      simulationDateAfter: null,
      actorType: actor.type,
      actorBusinessKey: actor.id,
      reason: 'User created run',
      idempotencyKey: `init-${dto.creationIdempotencyKey}`,
      requestHash: creationRequestHash,
      payloadJson,
      previousHash: chainAnchor
    };
    
    const eventHash = EventHashCalculator.calculate(eventPayload);

    const { run } = await simulationRunCommandRepository.createRunWithInitialEvent(
      {
        creationIdempotencyKey: dto.creationIdempotencyKey,
        creationRequestHash,
        configVersionId: config.id,
        mode: dto.mode,
      },
      {
        ...eventPayload,
        eventHash,
      }
    );
    return run;
  }
}
