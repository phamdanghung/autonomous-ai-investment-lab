import { MarketDataImportBatch, ProgressDelta } from '../../../domain/market-data/MarketDataImportBatch';

export type ImportBatchConditionalMutationResult =
  | {
      outcome: 'UPDATED';
      record: MarketDataImportBatch;
    }
  | {
      outcome: 'NO_MATCH';
    };

export type TransitionImportBatchCommand =
  | {
      id: string;
      targetStatus: 'PENDING';
      completedAt: null;
      failedAt: null;
      failureCode: null;
    }
  | {
      id: string;
      targetStatus: 'COMPLETED' | 'COMPLETED_WITH_QUARANTINE';
      completedAt: Date;
      failedAt: null;
      failureCode: null;
    }
  | {
      id: string;
      targetStatus: 'FAILED';
      completedAt: null;
      failedAt: Date;
      failureCode: string;
    };

export interface ImportBatchMutationRepository {
  findById(id: string): Promise<MarketDataImportBatch | null>;
  applyProgressDeltaConditional(id: string, delta: ProgressDelta): Promise<ImportBatchConditionalMutationResult>;
  transitionConditional(command: TransitionImportBatchCommand): Promise<ImportBatchConditionalMutationResult>;
}
