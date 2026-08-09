import { MarketDataImportBatch, MarketDataImportBatchDomain } from '../../../domain/market-data/MarketDataImportBatch';
import { MarketImportNotFoundError, MarketDataConcurrencyConflictError, MarketDataIntegrityError } from '../../../domain/market-data/MarketDataErrors';
import { ImportBatchMutationRepository, TransitionImportBatchCommand } from '../../ports/market-data/ImportBatchMutationPorts';
import { IClock } from '../../ports/IClock';

export type TransitionImportBatchRequest =
  | {
      id: string;
      targetStatus: 'PENDING';
    }
  | {
      id: string;
      targetStatus: 'COMPLETED';
    }
  | {
      id: string;
      targetStatus: 'COMPLETED_WITH_QUARANTINE';
    }
  | {
      id: string;
      targetStatus: 'FAILED';
      failureCode: string;
    };

export class TransitionImportBatchService {
  constructor(
    private readonly repository: ImportBatchMutationRepository,
    private readonly clock: IClock
  ) {}

  async execute(request: TransitionImportBatchRequest): Promise<MarketDataImportBatch> {
    const current = await this.repository.findById(request.id);
    if (!current) {
      throw new MarketImportNotFoundError(`ImportBatch ${request.id} not found.`);
    }

    MarketDataImportBatchDomain.validateTransition(current.status, request.targetStatus);

    let command: TransitionImportBatchCommand;

    if (request.targetStatus === 'PENDING') {
      command = {
        id: request.id,
        targetStatus: 'PENDING',
        completedAt: null,
        failedAt: null,
        failureCode: null
      };
    } else if (request.targetStatus === 'FAILED') {
      command = {
        id: request.id,
        targetStatus: 'FAILED',
        completedAt: null,
        failedAt: this.clock.now(),
        failureCode: request.failureCode
      };
    } else {
      command = {
        id: request.id,
        targetStatus: request.targetStatus,
        completedAt: this.clock.now(),
        failedAt: null,
        failureCode: null
      };
    }

    const result = await this.repository.transitionConditional(command);
    if (result.outcome === 'UPDATED') {
      return result.record;
    }

    const reRead = await this.repository.findById(request.id);
    if (!reRead) {
      throw new MarketImportNotFoundError(`ImportBatch ${request.id} not found after missing transition match.`);
    }

    if (reRead.status !== 'PENDING') {
      throw new MarketDataConcurrencyConflictError();
    }

    throw new MarketDataIntegrityError('Unexplained conditional transition failure.');
  }
}
