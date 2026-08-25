import { 
  ISimulationRunDataOriginBinder, 
  BindSimulationRunDataOriginCommand,
  BoundSimulationRunDataOrigin 
} from '../../../application/ports/run-data-origin/RunDataOriginPorts';
import { MarketDataDomainError } from '../../../domain/market-data/MarketDataErrors';
import { MarketDataValidation } from '../../../domain/market-data/MarketDataValidation';

export interface LegacyBindDataOriginExecutor {
  execute(
    runId: string,
    version: number,
    dto: {
      dataOriginHash: string;
      canonicalStartDate: string;
      idempotencyKey: string;
    },
    actor: {
      type: string;
      id: string;
    }
  ): Promise<unknown>;
}

const defaultLegacyBindDataOriginExecutor: LegacyBindDataOriginExecutor = {
  async execute(runId, version, dto, actor) {
    const { BindDataOriginService } = await import(
      '../../../application/services/BindDataOriginService'
    );
    return BindDataOriginService.execute(runId, version, dto, actor);
  }
};

export class LegacySimulationRunDataOriginBinderIntegrityError extends MarketDataDomainError {
  constructor(message: string = 'Legacy simulation run data-origin binding result is invalid.') {
    super(
      message,
      'LEGACY_SIMULATION_RUN_DATA_ORIGIN_BINDER_INTEGRITY',
      'The simulation run data-origin binding result is invalid.',
      'SYSTEM_INTEGRITY',
      false
    );
  }
}

export class LegacySimulationRunDataOriginBinder implements ISimulationRunDataOriginBinder {
  constructor(
    private readonly executor: LegacyBindDataOriginExecutor = defaultLegacyBindDataOriginExecutor
  ) {}

  async bind(command: BindSimulationRunDataOriginCommand): Promise<BoundSimulationRunDataOrigin> {
    const rawResult = await this.executor.execute(
      command.runId,
      command.expectedVersion,
      {
        dataOriginHash: command.dataOriginHash,
        canonicalStartDate: command.canonicalStartDate,
        idempotencyKey: command.idempotencyKey
      },
      {
        type: command.actor.type,
        id: command.actor.id
      }
    );

    if (rawResult === null || typeof rawResult !== 'object' || Array.isArray(rawResult)) {
      throw new LegacySimulationRunDataOriginBinderIntegrityError();
    }

    const result = rawResult as Record<string, unknown>;

    const { id, version, status, dataOriginHash, canonicalStartDate, runBusinessKey } = result;

    if (typeof id !== 'string' || id !== command.runId) {
      throw new LegacySimulationRunDataOriginBinderIntegrityError();
    }

    if (typeof version !== 'number' || !Number.isInteger(version) || version !== command.expectedVersion + 1) {
      throw new LegacySimulationRunDataOriginBinderIntegrityError();
    }

    if (status !== 'CONFIGURED') {
      throw new LegacySimulationRunDataOriginBinderIntegrityError();
    }

    if (typeof dataOriginHash !== 'string' || dataOriginHash !== command.dataOriginHash) {
      throw new LegacySimulationRunDataOriginBinderIntegrityError();
    }

    let parsedCanonicalStart: string;
    if (canonicalStartDate instanceof Date) {
      if (isNaN(canonicalStartDate.getTime())) {
        throw new LegacySimulationRunDataOriginBinderIntegrityError();
      }
      parsedCanonicalStart = canonicalStartDate.toISOString().substring(0, 10);
    } else if (typeof canonicalStartDate === 'string') {
      let normalizedDate: string;
      try {
        normalizedDate = MarketDataValidation.normalizeDateOnly(canonicalStartDate);
      } catch {
        throw new LegacySimulationRunDataOriginBinderIntegrityError();
      }
      if (normalizedDate !== canonicalStartDate) {
        throw new LegacySimulationRunDataOriginBinderIntegrityError();
      }
      parsedCanonicalStart = canonicalStartDate;
    } else {
      throw new LegacySimulationRunDataOriginBinderIntegrityError();
    }

    if (parsedCanonicalStart !== command.canonicalStartDate) {
      throw new LegacySimulationRunDataOriginBinderIntegrityError();
    }

    if (typeof runBusinessKey !== 'string' || !/^[a-f0-9]{64}$/.test(runBusinessKey)) {
      throw new LegacySimulationRunDataOriginBinderIntegrityError();
    }

    return {
      runId: id,
      version,
      status,
      dataOriginHash,
      canonicalStartDate: parsedCanonicalStart,
      runBusinessKey
    };
  }
}
