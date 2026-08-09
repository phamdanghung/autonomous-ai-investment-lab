import { CanonicalBatchBusinessKeyPayload, CanonicalImportRequestPayload, MARKET_DATA_CONTRACT_VERSIONS, MarketImportMode } from '../contracts/MarketDataContracts';
import { MarketDataCanonicalization } from './MarketDataCanonicalization';
import { MarketImportInvalidTransitionError, MarketImportInvalidError } from './MarketDataErrors';

export type MarketDataImportStatus = 'PENDING' | 'COMPLETED' | 'COMPLETED_WITH_QUARANTINE' | 'FAILED';

export interface MarketDataImportBatch {
  id: string; // UUID
  sourceVersionId: string;
  creationIdempotencyKey: string | null;
  creationRequestHash: string;
  batchBusinessKey: string;
  importMode: MarketImportMode;
  status: MarketDataImportStatus;
  parsedRowCount: number;
  acceptedRowCount: number;
  flaggedRowCount: number;
  quarantinedRowCount: number;
}

export type ExistingImportIdentity = {
  creationIdempotencyKey: string | null;
  creationRequestHash: string;
  batchBusinessKey: string;
};

export type ImportIdempotencyDecision =
  | 'CREATE_NEW'
  | 'REPLAY_BY_IDEMPOTENCY_KEY'
  | 'REPLAY_BY_BUSINESS_KEY'
  | 'IDEMPOTENCY_CONFLICT'
  | 'BUSINESS_KEY_CONFLICT';

export type ProgressDelta = {
  parsedDelta: number;
  acceptedDelta: number;
  flaggedDelta: number;
  quarantinedDelta: number;
};

export class MarketDataImportBatchDomain {
  /**
   * Evaluates idempotency and returns a pure decision outcome.
   */
  static evaluateIdempotency(requestIdempotencyKey: string | null, requestHash: string, businessKey: string, existing: ExistingImportIdentity | null): ImportIdempotencyDecision {
    if (!existing) {
      return 'CREATE_NEW';
    }

    // Exact match on idempotency key
    if (requestIdempotencyKey && existing.creationIdempotencyKey === requestIdempotencyKey) {
      if (existing.creationRequestHash === requestHash) {
        return 'REPLAY_BY_IDEMPOTENCY_KEY';
      }
      return 'IDEMPOTENCY_CONFLICT';
    }

    // Different idempotency key (or null), but same business key
    if (existing.batchBusinessKey === businessKey) {
      if (existing.creationRequestHash === requestHash) {
        return 'REPLAY_BY_BUSINESS_KEY';
      }
      return 'BUSINESS_KEY_CONFLICT';
    }

    // Should theoretically not reach here if queried correctly by idempotencyKey OR businessKey,
    // but default to CREATE_NEW if no matches on the identifiers (impossible if DB queries correctly).
    return 'CREATE_NEW';
  }

  /**
   * Computes the batch business key.
   */
  static buildBatchBusinessKey(sourceVersionKey: string, sourceContentHash: string, importMode: MarketImportMode, canonicalizationVersion: string): { payload: CanonicalBatchBusinessKeyPayload, hash: string } {
    const payload: CanonicalBatchBusinessKeyPayload = {
      batchContractVersion: MARKET_DATA_CONTRACT_VERSIONS.BATCH_BUSINESS_KEY,
      sourceVersionKey,
      sourceContentHash: sourceContentHash.toLowerCase(),
      importMode,
      canonicalizationVersion,
    };

    const hash = MarketDataCanonicalization.hashPayload(payload).toLowerCase();
    return { payload, hash };
  }

  /**
   * Computes the creation request hash.
   */
  static buildCreationRequestHash(payload: Omit<CanonicalImportRequestPayload, 'importContractVersion'>): { payload: CanonicalImportRequestPayload, hash: string } {
    // Validate sourceByteSize is a non-negative decimal string (0, 1, 123) without leading zeros unless it's just '0'
    if (!/^(0|[1-9][0-9]*)$/.test(payload.sourceByteSize)) {
      throw new MarketImportInvalidError('sourceByteSize must be a non-negative integer string without leading zeros');
    }

    // Validate fixtureKey (logical key only, no paths/urls, no whitespace/empty)
    if (!payload.fixtureKey || payload.fixtureKey.trim() === '' || /^\s|\s$/.test(payload.fixtureKey)) {
      throw new MarketImportInvalidError('fixtureKey must not be empty or contain leading/trailing whitespace');
    }
    if (/^(https?|file):\/\//i.test(payload.fixtureKey) || /^[A-Za-z]:\\/.test(payload.fixtureKey) || /^\//.test(payload.fixtureKey) || /\.\.(\/|\\)/.test(payload.fixtureKey)) {
      throw new MarketImportInvalidError('fixtureKey must be a logical key, not a path or URL');
    }

    // Validate sourceObjectKey (logical key only, no whitespace/empty)
    if (!payload.sourceObjectKey || payload.sourceObjectKey.trim() === '' || /^\s|\s$/.test(payload.sourceObjectKey)) {
      throw new MarketImportInvalidError('sourceObjectKey must not be empty or contain leading/trailing whitespace');
    }
    if (/^(https?|file):\/\//i.test(payload.sourceObjectKey) || /^[A-Za-z]:\\/.test(payload.sourceObjectKey) || /^\//.test(payload.sourceObjectKey) || /\.\.(\/|\\)/.test(payload.sourceObjectKey)) {
      throw new MarketImportInvalidError('sourceObjectKey must be a logical key, not a path or URL');
    }

    // Validate sourceContentHash (64-char lowercase hex strictly)
    if (!/^[a-f0-9]{64}$/.test(payload.sourceContentHash)) {
      throw new MarketImportInvalidError('sourceContentHash must be exactly 64 lowercase hexadecimal characters');
    }

    const canonicalPayload: CanonicalImportRequestPayload = {
      importContractVersion: MARKET_DATA_CONTRACT_VERSIONS.IMPORT_REQUEST,
      sourceVersionKey: payload.sourceVersionKey,
      fixtureKey: payload.fixtureKey,
      sourceObjectKey: payload.sourceObjectKey,
      sourceContentHash: payload.sourceContentHash.toLowerCase(),
      sourceByteSize: payload.sourceByteSize,
      importMode: payload.importMode,
      adapterVersion: payload.adapterVersion,
      schemaVersion: payload.schemaVersion,
      canonicalizationVersion: payload.canonicalizationVersion,
    };

    const hash = MarketDataCanonicalization.hashPayload(canonicalPayload).toLowerCase();
    return { payload: canonicalPayload, hash };
  }

  /**
   * Validates a progress update delta.
   */
  static validateProgressDelta(delta: ProgressDelta): void {
    if (delta.parsedDelta < 0 || !Number.isInteger(delta.parsedDelta)) throw new MarketImportInvalidError('parsedDelta must be a non-negative integer');
    if (delta.acceptedDelta < 0 || !Number.isInteger(delta.acceptedDelta)) throw new MarketImportInvalidError('acceptedDelta must be a non-negative integer');
    if (delta.flaggedDelta < 0 || !Number.isInteger(delta.flaggedDelta)) throw new MarketImportInvalidError('flaggedDelta must be a non-negative integer');
    if (delta.quarantinedDelta < 0 || !Number.isInteger(delta.quarantinedDelta)) throw new MarketImportInvalidError('quarantinedDelta must be a non-negative integer');

    const sum = delta.acceptedDelta + delta.flaggedDelta + delta.quarantinedDelta;
    if (delta.parsedDelta !== sum) {
      throw new MarketImportInvalidError('parsedDelta must equal the sum of accepted, flagged, and quarantined deltas');
    }
  }

  /**
   * Validates state transition.
   */
  static validateTransition(currentStatus: MarketDataImportStatus, targetStatus: MarketDataImportStatus): void {
    if (currentStatus !== 'PENDING') {
      throw new MarketImportInvalidTransitionError(`Cannot transition from terminal status ${currentStatus}`);
    }

    const allowedTargets: MarketDataImportStatus[] = ['PENDING', 'COMPLETED', 'COMPLETED_WITH_QUARANTINE', 'FAILED'];
    if (!allowedTargets.includes(targetStatus)) {
      throw new MarketImportInvalidTransitionError(`Invalid target status ${targetStatus}`);
    }
  }
}
