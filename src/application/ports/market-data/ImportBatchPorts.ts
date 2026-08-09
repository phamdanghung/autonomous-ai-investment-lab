import { MarketDataImportBatch } from '../../../domain/market-data/MarketDataImportBatch';
import { MarketImportMode } from '../../../domain/contracts/MarketDataContracts';

export type RegisterImportBatchCommand = {
  creationIdempotencyKey: string;
  creationRequestHash: string;
  batchBusinessKey: string;
  sourceVersionId: string;
  sourceObjectKey: string;
  sourceContentHash: string;
  sourceByteSize: string;
  declaredRowCount: number | null;
  importMode: MarketImportMode;
  startedAt: Date;
};

export interface ImportBatchRepository {
  findByCreationIdempotencyKey(key: string): Promise<MarketDataImportBatch | null>;
  findByBatchBusinessKey(key: string): Promise<MarketDataImportBatch | null>;
  create(command: RegisterImportBatchCommand): Promise<MarketDataImportBatch>;
}
