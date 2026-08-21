import { DatasetSnapshot } from '../../../domain/market-data/DatasetSnapshot';
import { MarketDataImportStatus } from '../../../domain/market-data/MarketDataImportBatch';
import { DailyMarketBar } from '../../../domain/market-data/DailyMarketBar';

export interface DatasetSnapshotImportBatchRef {
  id: string;
  sourceVersionId: string;
  batchBusinessKey: string;
  sourceContentHash: string;
  status: MarketDataImportStatus;
  completedAt: Date | null;
}

export interface IDatasetSnapshotImportBatchQuery {
  listCompletedThrough(
    sourceVersionId: string,
    cutoffAt: Date
  ): Promise<DatasetSnapshotImportBatchRef[]>;
}

export interface DatasetSnapshotBarCandidate {
  bar: DailyMarketBar;
  instrumentBusinessKey: string;
}

export interface DatasetSnapshotBarQuery {
  sourceVersionId: string;
  rangeStart: string;
  rangeEnd: string;
  importBatchIds: string[];
}

export interface IDatasetSnapshotDailyBarQuery {
  listCandidates(
    query: DatasetSnapshotBarQuery
  ): Promise<DatasetSnapshotBarCandidate[]>;
}

export interface IDatasetSnapshotQueryRepository {
  findByCreationIdempotencyKey(
    key: string
  ): Promise<DatasetSnapshot | null>;

  findByBusinessKey(
    businessKey: string
  ): Promise<DatasetSnapshot | null>;
}

export interface CreateDatasetSnapshotDraftCommand {
  businessKey: string;
  sourceVersionId: string;
  rangeStart: string;
  rangeEnd: string;
  universeDefinitionJson: string;
  universeHash: string;
  dataCutoffKey: string;
  dataCutoffAt: Date;
  canonicalizationVersion: string;
  rowCount: number;
  manifestHash: string;
  contentHash: string;
  status: 'DRAFT';
  creationIdempotencyKey: string;
  creationRequestHash: string;
}

export interface CreateDatasetSnapshotEntryCommand {
  dailyBarId: string;
  entrySequence: number;
  instrumentBusinessKey: string;
  marketDate: string;
  barCanonicalHash: string;
  entryHash: string;
}

export interface CreateSealedDatasetSnapshotCommand {
  draft: CreateDatasetSnapshotDraftCommand;
  entries: CreateDatasetSnapshotEntryCommand[];
  sealedAt: Date;
}

export interface IDatasetSnapshotWriteRepository {
  createSealed(
    command: CreateSealedDatasetSnapshotCommand
  ): Promise<DatasetSnapshot>;
}

export class DatasetSnapshotUniqueCollisionError extends Error {
  constructor() {
    super('Dataset snapshot unique collision.');
    this.name = 'DatasetSnapshotUniqueCollisionError';
    Object.setPrototypeOf(
      this,
      DatasetSnapshotUniqueCollisionError.prototype
    );
  }
}
