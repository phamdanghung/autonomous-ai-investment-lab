import { DailyMarketBar } from '../../../domain/market-data/DailyMarketBar';
import { MarketBarKind, MarketQualityDecision } from '../../../domain/contracts/MarketDataContracts';
import { MarketDataImportStatus } from '../../../domain/market-data/MarketDataImportBatch';

export interface DailyMarketBarImportBatchRef {
  id: string;
  sourceVersionId: string;
  status: MarketDataImportStatus;
}

export interface IDailyMarketBarImportBatchLookup {
  findById(id: string): Promise<DailyMarketBarImportBatchRef | null>;
}

export interface IDailyMarketBarQueryRepository {
  findByCanonicalHash(canonicalHash: string): Promise<DailyMarketBar | null>;

  findBySourceInstrumentDateVersion(
    sourceVersionId: string,
    instrumentId: string,
    marketDate: string,
    correctionVersion: number
  ): Promise<DailyMarketBar | null>;

  findBySourceRecordVersion(
    sourceVersionId: string,
    sourceRecordKey: string,
    correctionVersion: number
  ): Promise<DailyMarketBar | null>;

  findBySupersedesBarId(supersedesBarId: string): Promise<DailyMarketBar | null>;
}

export interface AppendDailyMarketBarCommand {
  sourceVersionId: string;
  importBatchId: string;
  sourceRecordKey: string;
  instrumentId: string;
  marketDate: string;
  barKind: MarketBarKind;
  open: string | null;
  high: string | null;
  low: string | null;
  close: string | null;
  volume: string;
  tradingValue: string | null;
  correctionVersion: number;
  supersedesBarId: string | null;
  qualityDecision: MarketQualityDecision;
  qualityFlags: string | null;
  sourceRowHash: string;
  canonicalHash: string;
}

export interface IDailyMarketBarAppendRepository {
  insert(command: AppendDailyMarketBarCommand): Promise<DailyMarketBar>;
}

export class DailyMarketBarUniqueCollisionError extends Error {
  constructor() {
    super('Daily market bar unique collision.');
    this.name = 'DailyMarketBarUniqueCollisionError';
    Object.setPrototypeOf(this, DailyMarketBarUniqueCollisionError.prototype);
  }
}
