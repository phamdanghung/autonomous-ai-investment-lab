export type MarketExchange = 'HOSE' | 'HNX' | 'UPCOM';
export type SecurityType = 'EQUITY';
export type MarketImportMode = 'INITIAL' | 'CORRECTION';
export type MarketBarKind = 'TRADED' | 'NO_TRADE' | 'SUSPENDED';
export type MarketQualityDecision = 'ACCEPTED' | 'ACCEPTED_WITH_FLAGS' | 'QUARANTINED';

export const MARKET_DATA_CONTRACT_VERSIONS = {
  INSTRUMENT_BUSINESS_KEY: '1.0',
  SOURCE_CONTRACT: '1.0',
  BATCH_BUSINESS_KEY: '1.0',
  IMPORT_REQUEST: '1.0',
  DAILY_BAR: '1.0',
  DATA_CUTOFF: '1.0',
  UNIVERSE: '1.0',
  SNAPSHOT_BUSINESS_KEY: '1.0',
  SNAPSHOT_ENTRY: '1.0',
  SNAPSHOT_MANIFEST: '1.0',
  SNAPSHOT_CONTENT: '1.0',
} as const;

export type CanonicalInstrumentBusinessKeyPayload = {
  exchange: MarketExchange;
  canonicalSymbol: string;
  securityType: SecurityType;
  effectiveFrom: string; // YYYY-MM-DD
};

export type MarketDatasetKind = "EOD_MARKET_DATA";
export type MarketAdapterKind = "REPOSITORY_CSV_FIXTURE";
export type MarketPriceUnit = "VND_PER_SHARE";
export type SourceEncoding = "UTF8";

export type CanonicalSourceContractPayload = {
  sourceContractVersion: string;
  providerCode: string;
  datasetKind: "EOD_MARKET_DATA";
  adapterKind: "REPOSITORY_CSV_FIXTURE";
  adapterVersion: string;
  schemaVersion: string;
  canonicalizationVersion: string;
  priceUnit: "VND_PER_SHARE";
  encoding: "UTF8";
};

export type CanonicalBatchBusinessKeyPayload = {
  batchContractVersion: string;
  sourceVersionKey: string;
  sourceContentHash: string;
  importMode: MarketImportMode;
  canonicalizationVersion: string;
};

export type CanonicalImportRequestPayload = {
  importContractVersion: string;
  sourceVersionKey: string;
  fixtureKey: string;
  sourceObjectKey: string;
  sourceContentHash: string;
  sourceByteSize: string;
  importMode: MarketImportMode;
  adapterVersion: string;
  schemaVersion: string;
  canonicalizationVersion: string;
};

export type CanonicalDailyBarPayload = {
  barContractVersion: string;
  sourceVersionKey: string;
  sourceRecordKey: string;
  instrumentBusinessKey: string;
  marketDate: string; // YYYY-MM-DD
  barKind: MarketBarKind;
  open: string | null; // BigInt decimal string
  high: string | null;
  low: string | null;
  close: string | null;
  volume: string; // BigInt decimal string
  tradingValue: string | null; // BigInt decimal string
  correctionVersion: number;
  qualityDecision: MarketQualityDecision;
  qualityFlags: string;
  sourceRowHash: string;
  supersedesBarHash: string | null;
};

export type CanonicalDataCutoffPayload = {
  cutoffContractVersion: string;
  // Normalize and sort batches by:
  // 1. batchBusinessKey ASC
  // 2. sourceContentHash ASC
  batches: Array<{
    batchBusinessKey: string;
    sourceContentHash: string;
  }>;
};

export type CanonicalUniversePayload = {
  universeContractVersion: string;
  securityTypes: SecurityType[];
  exchanges: MarketExchange[];
  instrumentBusinessKeys: string[];
  qualityFlagAllowlist: string[];
};

export type CanonicalSnapshotBusinessKeyPayload = {
  snapshotContractVersion: string;
  sourceVersionKey: string;
  rangeStart: string; // YYYY-MM-DD
  rangeEnd: string; // YYYY-MM-DD
  universeHash: string;
  dataCutoffKey: string;
  canonicalizationVersion: string;
};

export type CanonicalSnapshotEntryPayload = {
  entryContractVersion: string;
  entrySequence: number;
  instrumentBusinessKey: string;
  marketDate: string; // YYYY-MM-DD
  barCanonicalHash: string;
};

export type CanonicalSnapshotManifestPayload = {
  manifestContractVersion: string;
  entries: string[]; // Ordered entryHash values
};

export type CanonicalSnapshotContentPayload = {
  snapshotContractVersion: string;
  businessKey: string;
  rowCount: number;
  manifestHash: string;
};
