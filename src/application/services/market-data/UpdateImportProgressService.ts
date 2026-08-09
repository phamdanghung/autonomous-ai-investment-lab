import { MarketDataImportBatch, MarketDataImportBatchDomain, ProgressDelta } from '../../../domain/market-data/MarketDataImportBatch';
import { MarketImportNotFoundError, MarketDataConcurrencyConflictError, MarketDataIntegrityError } from '../../../domain/market-data/MarketDataErrors';
import { ImportBatchMutationRepository } from '../../ports/market-data/ImportBatchMutationPorts';

export interface UpdateImportProgressRequest {
  id: string;
  delta: ProgressDelta;
}

export class UpdateImportProgressService {
  constructor(private readonly repository: ImportBatchMutationRepository) {}

  async execute(request: UpdateImportProgressRequest): Promise<MarketDataImportBatch> {
    MarketDataImportBatchDomain.validateProgressDelta(request.delta);

    const current = await this.repository.findById(request.id);
    if (!current) {
      throw new MarketImportNotFoundError(`ImportBatch ${request.id} not found.`);
    }

    MarketDataImportBatchDomain.validateTransition(current.status, 'PENDING');

    const result = await this.repository.applyProgressDeltaConditional(request.id, request.delta);
    if (result.outcome === 'UPDATED') {
      return result.record;
    }

    const reRead = await this.repository.findById(request.id);
    if (!reRead) {
      throw new MarketImportNotFoundError(`ImportBatch ${request.id} not found after missing update match.`);
    }

    if (reRead.status !== 'PENDING') {
      throw new MarketDataConcurrencyConflictError();
    }

    throw new MarketDataIntegrityError('Unexplained conditional update failure.');
  }
}
