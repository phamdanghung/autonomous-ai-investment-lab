import { IDatasetSnapshotQueryRepository } from '../../ports/market-data/DatasetSnapshotPorts';
import { 
  ISimulationRunDataOriginBinder,
  BoundSimulationRunDataOrigin 
} from '../../ports/run-data-origin/RunDataOriginPorts';
import { 
  DatasetSnapshotRunOriginDomain,
  DatasetSnapshotRunOrigin,
  DatasetSnapshotRunOriginInvalidError
} from '../../../domain/run-data-origin/DatasetSnapshotRunOrigin';
import { MarketDataDomainError } from '../../../domain/market-data/MarketDataErrors';
import { MarketDataValidation } from '../../../domain/market-data/MarketDataValidation';

export interface BindDatasetSnapshotRunOriginRequest {
  runId: string;
  expectedVersion: number;
  snapshotBusinessKey: string;
  canonicalStartDate: string;
  idempotencyKey: string;
  actor: {
    type: string;
    id: string;
  };
}

export interface BindDatasetSnapshotRunOriginResult {
  origin: DatasetSnapshotRunOrigin;
  binding: BoundSimulationRunDataOrigin;
}

export class DatasetSnapshotRunOriginNotFoundError extends MarketDataDomainError {
  constructor(message: string = 'Dataset snapshot for simulation run origin was not found.') {
    super(
      message,
      'DATASET_SNAPSHOT_RUN_ORIGIN_NOT_FOUND',
      'The selected dataset snapshot could not be found.',
      'NOT_FOUND',
      false
    );
  }
}

export class DatasetSnapshotRunOriginBindingIntegrityError extends MarketDataDomainError {
  constructor(message: string = 'Simulation run data-origin binding result is inconsistent.') {
    super(
      message,
      'DATASET_SNAPSHOT_RUN_ORIGIN_BINDING_INTEGRITY',
      'The simulation run data-origin binding result is inconsistent.',
      'SYSTEM_INTEGRITY',
      false
    );
  }
}

export class BindDatasetSnapshotRunOriginService {
  constructor(
    private readonly snapshotQuery: IDatasetSnapshotQueryRepository,
    private readonly runBinder: ISimulationRunDataOriginBinder
  ) {}

  async execute(request: BindDatasetSnapshotRunOriginRequest): Promise<BindDatasetSnapshotRunOriginResult> {
    // 1. Request Validation

    if (!request.runId || typeof request.runId !== 'string' || request.runId.trim() !== request.runId || /[\x00-\x1F\x7F]/.test(request.runId)) {
      throw new DatasetSnapshotRunOriginInvalidError();
    }

    if (typeof request.expectedVersion !== 'number' || !Number.isInteger(request.expectedVersion) || request.expectedVersion < 1) {
      throw new DatasetSnapshotRunOriginInvalidError();
    }

    if (!request.snapshotBusinessKey || !/^[a-f0-9]{64}$/.test(request.snapshotBusinessKey)) {
      throw new DatasetSnapshotRunOriginInvalidError();
    }

    let validCanonicalStartDate: string;
    try {
      validCanonicalStartDate = MarketDataValidation.normalizeDateOnly(request.canonicalStartDate);
      if (validCanonicalStartDate !== request.canonicalStartDate) {
        throw new DatasetSnapshotRunOriginInvalidError();
      }
    } catch (e) {
      throw new DatasetSnapshotRunOriginInvalidError();
    }

    if (!request.idempotencyKey || typeof request.idempotencyKey !== 'string' || request.idempotencyKey.trim() !== request.idempotencyKey || /[\x00-\x1F\x7F]/.test(request.idempotencyKey)) {
      throw new DatasetSnapshotRunOriginInvalidError();
    }

    if (!request.actor || typeof request.actor !== 'object') {
      throw new DatasetSnapshotRunOriginInvalidError();
    }

    if (!request.actor.type || typeof request.actor.type !== 'string' || request.actor.type.trim() !== request.actor.type || /[\x00-\x1F\x7F]/.test(request.actor.type)) {
      throw new DatasetSnapshotRunOriginInvalidError();
    }

    if (!request.actor.id || typeof request.actor.id !== 'string' || request.actor.id.trim() !== request.actor.id || /[\x00-\x1F\x7F]/.test(request.actor.id)) {
      throw new DatasetSnapshotRunOriginInvalidError();
    }

    // 2. Lookup Snapshot
    const snapshot = await this.snapshotQuery.findByBusinessKey(request.snapshotBusinessKey);
    if (!snapshot) {
      throw new DatasetSnapshotRunOriginNotFoundError();
    }

    // 3. Build frozen domain origin
    const origin = DatasetSnapshotRunOriginDomain.build(snapshot, request.canonicalStartDate);

    // 4. Binder Command
    const binding = await this.runBinder.bind({
      runId: request.runId,
      expectedVersion: request.expectedVersion,
      dataOriginHash: origin.dataOriginHash,
      canonicalStartDate: origin.canonicalStartDate,
      idempotencyKey: request.idempotencyKey,
      actor: {
        type: request.actor.type,
        id: request.actor.id
      }
    });

    // 5. Binding Integrity Verification
    if (!binding || typeof binding !== 'object') {
      throw new DatasetSnapshotRunOriginBindingIntegrityError();
    }

    if (binding.runId !== request.runId) {
      throw new DatasetSnapshotRunOriginBindingIntegrityError();
    }

    if (binding.status !== 'CONFIGURED') {
      throw new DatasetSnapshotRunOriginBindingIntegrityError();
    }

    if (binding.version !== request.expectedVersion + 1) {
      throw new DatasetSnapshotRunOriginBindingIntegrityError();
    }

    if (binding.dataOriginHash !== origin.dataOriginHash) {
      throw new DatasetSnapshotRunOriginBindingIntegrityError();
    }

    if (binding.canonicalStartDate !== origin.canonicalStartDate) {
      throw new DatasetSnapshotRunOriginBindingIntegrityError();
    }

    if (!binding.runBusinessKey || !/^[a-f0-9]{64}$/.test(binding.runBusinessKey)) {
      throw new DatasetSnapshotRunOriginBindingIntegrityError();
    }

    // 6. Return
    return {
      origin,
      binding
    };
  }
}
