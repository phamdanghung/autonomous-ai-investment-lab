import {
  CanonicalDataCutoffPayload,
  CanonicalSnapshotBusinessKeyPayload,
  CanonicalSnapshotContentPayload,
  CanonicalSnapshotEntryPayload,
  CanonicalSnapshotManifestPayload,
  CanonicalUniversePayload,
  MARKET_DATA_CONTRACT_VERSIONS,
  MarketExchange,
  SecurityType
} from '../contracts/MarketDataContracts';
import { MarketDataCanonicalization } from './MarketDataCanonicalization';
import { DatasetSnapshotInvalidError, DatasetSnapshotInvalidTransitionError } from './MarketDataErrors';
import { MarketDataValidation } from './MarketDataValidation';

export type DatasetSnapshotStatus = 'DRAFT' | 'SEALED';

export interface DatasetSnapshot {
  id: string;
  businessKey: string;
  sourceVersionId: string;
  rangeStart: string;
  rangeEnd: string;
  universeDefinitionJson: string;
  universeHash: string;
  dataCutoffKey: string;
  dataCutoffAt: Date | null;
  canonicalizationVersion: string;
  rowCount: number;
  manifestHash: string;
  contentHash: string;
  status: DatasetSnapshotStatus;
  creationIdempotencyKey: string;
  creationRequestHash: string;
  sealedAt: Date | null;
}

export interface DatasetSnapshotEntry {
  id: string;
  snapshotId: string;
  dailyBarId: string;
  entrySequence: number;
  instrumentBusinessKey: string;
  marketDate: string;
  barCanonicalHash: string;
  entryHash: string;
}

export class DatasetSnapshotDomain {
  private static validateDate(dateStr: string): string {
    try {
      const normalized = MarketDataValidation.normalizeDateOnly(dateStr);
      if (normalized !== dateStr) {
        throw new DatasetSnapshotInvalidError(`Date must be exactly canonical YYYY-MM-DD: ${dateStr}`);
      }
      return normalized;
    } catch (e: any) {
      if (e instanceof DatasetSnapshotInvalidError) throw e;
      throw new DatasetSnapshotInvalidError(`Invalid date format: ${dateStr}`);
    }
  }

  private static validateSha256(hash: string, fieldName: string): void {
    if (!/^[a-f0-9]{64}$/.test(hash)) {
      throw new DatasetSnapshotInvalidError(`Invalid ${fieldName}: must be 64 lowercase hex characters`);
    }
  }

  private static validateInstrumentBusinessKey(key: string): void {
    // VN|EXCHANGE|CANONICAL_SYMBOL|SECURITY_TYPE|YYYY-MM-DD
    const parts = key.split('|');
    if (parts.length !== 5) {
      throw new DatasetSnapshotInvalidError(`Invalid instrument business key format: ${key}`);
    }
    const [prefix, exchange, symbol, type, date] = parts;
    if (prefix !== 'VN') {
      throw new DatasetSnapshotInvalidError(`Invalid instrument business key prefix: ${prefix}`);
    }
    if (!['HOSE', 'HNX', 'UPCOM'].includes(exchange)) {
      throw new DatasetSnapshotInvalidError(`Invalid instrument business key exchange: ${exchange}`);
    }
    if (type !== 'EQUITY') {
      throw new DatasetSnapshotInvalidError(`Invalid instrument business key security type: ${type}`);
    }
    if (!symbol || !/^[A-Z0-9]+$/.test(symbol)) {
      throw new DatasetSnapshotInvalidError(`Invalid instrument business key symbol: ${symbol}`);
    }
    this.validateDate(date);
  }

  static buildUniverse(
    input: Omit<CanonicalUniversePayload, 'universeContractVersion'>
  ): { payload: CanonicalUniversePayload; json: string; hash: string } {
    if (!Array.isArray(input.securityTypes)) {
      throw new DatasetSnapshotInvalidError('securityTypes must be an array');
    }
    if (!input.securityTypes.includes('EQUITY')) {
      throw new DatasetSnapshotInvalidError('securityTypes must include EQUITY');
    }
    if (input.securityTypes.some(t => t !== 'EQUITY')) {
      throw new DatasetSnapshotInvalidError('Only EQUITY security type is valid');
    }
    const securityTypes = ['EQUITY'] as SecurityType[];

    if (!Array.isArray(input.exchanges)) {
      throw new DatasetSnapshotInvalidError('exchanges must be an array');
    }
    const exchangesSet = new Set(input.exchanges);
    exchangesSet.forEach(ex => {
      if (!['HOSE', 'HNX', 'UPCOM'].includes(ex)) {
        throw new DatasetSnapshotInvalidError(`Invalid exchange in universe: ${ex}`);
      }
    });
    // Canonical order MUST follow MARKET_EXCHANGES: HOSE, HNX, UPCOM
    const exchangesOrder = ['HOSE', 'HNX', 'UPCOM'] as MarketExchange[];
    const exchanges = exchangesOrder.filter(ex => exchangesSet.has(ex));

    if (!Array.isArray(input.instrumentBusinessKeys)) {
      throw new DatasetSnapshotInvalidError('instrumentBusinessKeys must be an array');
    }
    const instrumentKeysSet = new Set(input.instrumentBusinessKeys);
    instrumentKeysSet.forEach(k => this.validateInstrumentBusinessKey(k));
    const instrumentBusinessKeys = Array.from(instrumentKeysSet).sort();

    if (!Array.isArray(input.qualityFlagAllowlist)) {
      throw new DatasetSnapshotInvalidError('qualityFlagAllowlist must be an array');
    }
    const qualityFlagsSet = new Set<string>();
    input.qualityFlagAllowlist.forEach(flag => {
      if (typeof flag !== 'string' || flag.length === 0 || flag.trim() !== flag || /[\x00-\x1F\x7F]/.test(flag)) {
        throw new DatasetSnapshotInvalidError(`Invalid quality flag: ${flag}`);
      }
      qualityFlagsSet.add(flag);
    });
    const qualityFlagAllowlist = Array.from(qualityFlagsSet).sort();

    const payload: CanonicalUniversePayload = {
      universeContractVersion: MARKET_DATA_CONTRACT_VERSIONS.UNIVERSE,
      securityTypes,
      exchanges,
      instrumentBusinessKeys,
      qualityFlagAllowlist
    };

    const json = MarketDataCanonicalization.serialize(payload);
    const hash = MarketDataCanonicalization.hashPayload(payload);

    return { payload, json, hash };
  }

  static buildDataCutoff(
    input: Omit<CanonicalDataCutoffPayload, 'cutoffContractVersion'>
  ): { payload: CanonicalDataCutoffPayload; key: string } {
    if (!Array.isArray(input.batches)) {
      throw new DatasetSnapshotInvalidError('batches must be an array');
    }

    const seenBatchKeys = new Set<string>();
    const batches = input.batches.map(b => {
      if (!b || typeof b !== 'object') {
        throw new DatasetSnapshotInvalidError('Batch item must be an object');
      }
      this.validateSha256(b.batchBusinessKey, 'batchBusinessKey');
      this.validateSha256(b.sourceContentHash, 'sourceContentHash');
      if (seenBatchKeys.has(b.batchBusinessKey)) {
        throw new DatasetSnapshotInvalidError(`Duplicate batchBusinessKey in data cutoff: ${b.batchBusinessKey}`);
      }
      seenBatchKeys.add(b.batchBusinessKey);
      return {
        batchBusinessKey: b.batchBusinessKey,
        sourceContentHash: b.sourceContentHash
      };
    });

    batches.sort((a, b) => {
      if (a.batchBusinessKey !== b.batchBusinessKey) return a.batchBusinessKey.localeCompare(b.batchBusinessKey);
      return a.sourceContentHash.localeCompare(b.sourceContentHash);
    });

    const payload: CanonicalDataCutoffPayload = {
      cutoffContractVersion: MARKET_DATA_CONTRACT_VERSIONS.DATA_CUTOFF,
      batches
    };

    const key = MarketDataCanonicalization.hashPayload(payload);

    return { payload, key };
  }

  static buildBusinessKey(
    input: Omit<CanonicalSnapshotBusinessKeyPayload, 'snapshotContractVersion'>
  ): { payload: CanonicalSnapshotBusinessKeyPayload; businessKey: string } {
    if (!/^VN\|MARKET_DATA_SOURCE\|[a-f0-9]{64}$/.test(input.sourceVersionKey)) {
      throw new DatasetSnapshotInvalidError(`Invalid sourceVersionKey: ${input.sourceVersionKey}`);
    }

    const rangeStart = this.validateDate(input.rangeStart);
    const rangeEnd = this.validateDate(input.rangeEnd);
    if (rangeEnd < rangeStart) {
      throw new DatasetSnapshotInvalidError('rangeEnd cannot be before rangeStart');
    }

    this.validateSha256(input.universeHash, 'universeHash');
    this.validateSha256(input.dataCutoffKey, 'dataCutoffKey');

    if (
      !input.canonicalizationVersion ||
      input.canonicalizationVersion.trim() !== input.canonicalizationVersion ||
      /[\x00-\x1F\x7F]/.test(input.canonicalizationVersion)
    ) {
      throw new DatasetSnapshotInvalidError('canonicalizationVersion is invalid');
    }

    const payload: CanonicalSnapshotBusinessKeyPayload = {
      snapshotContractVersion: MARKET_DATA_CONTRACT_VERSIONS.SNAPSHOT_BUSINESS_KEY,
      sourceVersionKey: input.sourceVersionKey,
      rangeStart,
      rangeEnd,
      universeHash: input.universeHash,
      dataCutoffKey: input.dataCutoffKey,
      canonicalizationVersion: input.canonicalizationVersion
    };

    const businessKey = MarketDataCanonicalization.hashPayload(payload);

    return { payload, businessKey };
  }

  static buildEntryHash(
    input: Omit<CanonicalSnapshotEntryPayload, 'entryContractVersion'>
  ): { payload: CanonicalSnapshotEntryPayload; entryHash: string } {
    if (!Number.isInteger(input.entrySequence) || input.entrySequence <= 0) {
      throw new DatasetSnapshotInvalidError(`entrySequence must be a positive integer, got ${input.entrySequence}`);
    }

    this.validateInstrumentBusinessKey(input.instrumentBusinessKey);
    const marketDate = this.validateDate(input.marketDate);
    this.validateSha256(input.barCanonicalHash, 'barCanonicalHash');

    const payload: CanonicalSnapshotEntryPayload = {
      entryContractVersion: MARKET_DATA_CONTRACT_VERSIONS.SNAPSHOT_ENTRY,
      entrySequence: input.entrySequence,
      instrumentBusinessKey: input.instrumentBusinessKey,
      marketDate,
      barCanonicalHash: input.barCanonicalHash
    };

    const entryHash = MarketDataCanonicalization.hashPayload(payload);

    return { payload, entryHash };
  }

  static buildManifestHash(
    entryHashes: string[]
  ): { payload: CanonicalSnapshotManifestPayload; manifestHash: string } {
    if (!Array.isArray(entryHashes)) {
      throw new DatasetSnapshotInvalidError('entryHashes must be an array');
    }

    const seen = new Set<string>();
    entryHashes.forEach(h => {
      this.validateSha256(h, 'entryHash in manifest');
      if (seen.has(h)) {
        throw new DatasetSnapshotInvalidError(`Duplicate entryHash in manifest: ${h}`);
      }
      seen.add(h);
    });

    const payload: CanonicalSnapshotManifestPayload = {
      manifestContractVersion: MARKET_DATA_CONTRACT_VERSIONS.SNAPSHOT_MANIFEST,
      entries: [...entryHashes]
    };

    const manifestHash = MarketDataCanonicalization.hashPayload(payload);

    return { payload, manifestHash };
  }

  static buildContentHash(
    input: Omit<CanonicalSnapshotContentPayload, 'snapshotContractVersion'>
  ): { payload: CanonicalSnapshotContentPayload; contentHash: string } {
    this.validateSha256(input.businessKey, 'businessKey');
    if (!Number.isInteger(input.rowCount) || input.rowCount < 0) {
      throw new DatasetSnapshotInvalidError(`rowCount must be a non-negative integer, got ${input.rowCount}`);
    }
    this.validateSha256(input.manifestHash, 'manifestHash');

    const payload: CanonicalSnapshotContentPayload = {
      snapshotContractVersion: MARKET_DATA_CONTRACT_VERSIONS.SNAPSHOT_CONTENT,
      businessKey: input.businessKey,
      rowCount: input.rowCount,
      manifestHash: input.manifestHash
    };

    const contentHash = MarketDataCanonicalization.hashPayload(payload);

    return { payload, contentHash };
  }

  static validateTransition(currentStatus: string, targetStatus: string): void {
    if (!['DRAFT', 'SEALED'].includes(currentStatus) || !['DRAFT', 'SEALED'].includes(targetStatus)) {
      throw new DatasetSnapshotInvalidTransitionError(`Invalid status values: ${currentStatus} -> ${targetStatus}`);
    }

    if (currentStatus === 'DRAFT' && targetStatus === 'SEALED') {
      return;
    }

    throw new DatasetSnapshotInvalidTransitionError(`Transition not allowed: ${currentStatus} -> ${targetStatus}`);
  }
}
