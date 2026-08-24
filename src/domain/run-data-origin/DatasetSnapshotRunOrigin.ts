import { MarketDataDomainError } from '../market-data/MarketDataErrors';
import { MarketDataValidation } from '../market-data/MarketDataValidation';
import { DatasetSnapshot } from '../market-data/DatasetSnapshot';

export type RunDataOriginKind = 'DATASET_SNAPSHOT';

export interface DatasetSnapshotRunOrigin {
  originKind: 'DATASET_SNAPSHOT';
  snapshotBusinessKey: string;
  dataOriginHash: string;
  canonicalStartDate: string;
  rangeStart: string;
  rangeEnd: string;
  dataCutoffKey: string;
  rowCount: number;
}

export class DatasetSnapshotRunOriginInvalidError extends MarketDataDomainError {
  constructor(message: string = 'Dataset snapshot cannot be used as a simulation run data origin.') {
    super(
      message,
      'DATASET_SNAPSHOT_RUN_ORIGIN_INVALID',
      'The selected dataset snapshot cannot be used as a simulation data origin.',
      'BUSINESS_RULE',
      false
    );
  }
}

export class DatasetSnapshotRunOriginDomain {
  static build(
    snapshot: DatasetSnapshot,
    canonicalStartDate: string
  ): DatasetSnapshotRunOrigin {
    if (!snapshot || typeof snapshot !== 'object') {
      throw new DatasetSnapshotRunOriginInvalidError();
    }

    if (snapshot.status !== 'SEALED') {
      throw new DatasetSnapshotRunOriginInvalidError();
    }

    if (!(snapshot.sealedAt instanceof Date) || isNaN(snapshot.sealedAt.getTime())) {
      throw new DatasetSnapshotRunOriginInvalidError();
    }

    if (!snapshot.businessKey || !/^[a-f0-9]{64}$/.test(snapshot.businessKey)) {
      throw new DatasetSnapshotRunOriginInvalidError();
    }

    if (!snapshot.contentHash || !/^[a-f0-9]{64}$/.test(snapshot.contentHash)) {
      throw new DatasetSnapshotRunOriginInvalidError();
    }

    if (!snapshot.dataCutoffKey || !/^[a-f0-9]{64}$/.test(snapshot.dataCutoffKey)) {
      throw new DatasetSnapshotRunOriginInvalidError();
    }

    if (typeof snapshot.rowCount !== 'number' || !Number.isInteger(snapshot.rowCount) || snapshot.rowCount < 0) {
      throw new DatasetSnapshotRunOriginInvalidError();
    }

    let rangeStart: string;
    let rangeEnd: string;
    let validCanonicalStart: string;

    try {
      rangeStart = MarketDataValidation.normalizeDateOnly(snapshot.rangeStart);
      rangeEnd = MarketDataValidation.normalizeDateOnly(snapshot.rangeEnd);
      validCanonicalStart = MarketDataValidation.normalizeDateOnly(canonicalStartDate);
    } catch (e) {
      throw new DatasetSnapshotRunOriginInvalidError();
    }

    if (rangeStart !== snapshot.rangeStart || rangeEnd !== snapshot.rangeEnd || validCanonicalStart !== canonicalStartDate) {
      throw new DatasetSnapshotRunOriginInvalidError();
    }

    if (rangeStart > rangeEnd) {
      throw new DatasetSnapshotRunOriginInvalidError();
    }

    if (validCanonicalStart < rangeStart || validCanonicalStart > rangeEnd) {
      throw new DatasetSnapshotRunOriginInvalidError();
    }

    return {
      originKind: 'DATASET_SNAPSHOT',
      snapshotBusinessKey: snapshot.businessKey,
      dataOriginHash: snapshot.contentHash,
      canonicalStartDate: validCanonicalStart,
      rangeStart,
      rangeEnd,
      dataCutoffKey: snapshot.dataCutoffKey,
      rowCount: snapshot.rowCount
    };
  }
}
