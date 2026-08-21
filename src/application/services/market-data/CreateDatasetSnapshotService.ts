import { CanonicalUniversePayload } from '../../../domain/contracts/MarketDataContracts';
import { DatasetSnapshotDomain, DatasetSnapshot } from '../../../domain/market-data/DatasetSnapshot';
import { MarketDataCanonicalization } from '../../../domain/market-data/MarketDataCanonicalization';
import {
  DatasetSnapshotInvalidError,
  DatasetSnapshotIdempotencyConflictError,
  MarketDataIntegrityError
} from '../../../domain/market-data/MarketDataErrors';
import { IClock } from '../../ports/IClock';
import {
  IDatasetSnapshotImportBatchQuery,
  IDatasetSnapshotDailyBarQuery,
  IDatasetSnapshotQueryRepository,
  IDatasetSnapshotWriteRepository,
  CreateSealedDatasetSnapshotCommand,
  DatasetSnapshotUniqueCollisionError,
  DatasetSnapshotBarCandidate
} from '../../ports/market-data/DatasetSnapshotPorts';
import { GetMarketDataSourceVersionService } from './source-version/GetMarketDataSourceVersionService';

export const DATASET_SNAPSHOT_CREATION_REQUEST_VERSION = '1.0' as const;

export interface CreateDatasetSnapshotRequest {
  sourceVersionKey: string;
  rangeStart: string;
  rangeEnd: string;
  universe: Omit<CanonicalUniversePayload, 'universeContractVersion'>;
  creationIdempotencyKey: string;
}

export interface CreateDatasetSnapshotResult {
  outcome: 'CREATED' | 'REPLAYED';
  snapshot: DatasetSnapshot;
}

export class CreateDatasetSnapshotService {
  constructor(
    private readonly getSourceVersion: GetMarketDataSourceVersionService,
    private readonly importBatchQuery: IDatasetSnapshotImportBatchQuery,
    private readonly dailyBarQuery: IDatasetSnapshotDailyBarQuery,
    private readonly queryRepo: IDatasetSnapshotQueryRepository,
    private readonly writeRepo: IDatasetSnapshotWriteRepository,
    private readonly clock: IClock
  ) {}

  async execute(request: CreateDatasetSnapshotRequest): Promise<CreateDatasetSnapshotResult> {
    this.validateIdempotencyKey(request.creationIdempotencyKey);

    const universeResult = DatasetSnapshotDomain.buildUniverse({
      securityTypes: request.universe.securityTypes,
      exchanges: request.universe.exchanges,
      instrumentBusinessKeys: request.universe.instrumentBusinessKeys,
      qualityFlagAllowlist: request.universe.qualityFlagAllowlist
    });

    const sourceVersion = await this.getSourceVersion.execute({ sourceKey: request.sourceVersionKey });

    const creationRequestPayload = {
      requestContractVersion: DATASET_SNAPSHOT_CREATION_REQUEST_VERSION,
      sourceVersionKey: request.sourceVersionKey,
      rangeStart: request.rangeStart,
      rangeEnd: request.rangeEnd,
      universeHash: universeResult.hash,
      canonicalizationVersion: sourceVersion.canonicalizationVersion
    };
    const creationRequestHash = MarketDataCanonicalization.hashPayload(creationRequestPayload);

    // 1. Exact Idempotency Replay (First)
    const existing = await this.queryRepo.findByCreationIdempotencyKey(request.creationIdempotencyKey);
    if (existing) {
      if (existing.creationRequestHash !== creationRequestHash) {
        throw new DatasetSnapshotIdempotencyConflictError();
      }
      this.verifyIdempotencyIntegrity(existing, request, universeResult, sourceVersion);
      return { outcome: 'REPLAYED', snapshot: existing };
    }

    // 2. Cutoff point
    const dataCutoffAt = this.clock.now();
    const batches = await this.importBatchQuery.listCompletedThrough(sourceVersion.id, dataCutoffAt);

    batches.forEach(b => {
      if (b.sourceVersionId !== sourceVersion.id) throw new MarketDataIntegrityError('Import batch wrong source version');
      if (b.status !== 'COMPLETED' && b.status !== 'COMPLETED_WITH_QUARANTINE') throw new MarketDataIntegrityError('Import batch invalid status');
      if (b.completedAt === null) throw new MarketDataIntegrityError('Import batch completedAt is null');
      if (b.completedAt > dataCutoffAt) throw new MarketDataIntegrityError('Import batch completedAt after cutoff');
    });

    const cutoffPayload = batches.map(b => ({
      batchBusinessKey: b.batchBusinessKey,
      sourceContentHash: b.sourceContentHash
    }));

    const dataCutoffResult = DatasetSnapshotDomain.buildDataCutoff({ batches: cutoffPayload });

    const businessKeyResult = DatasetSnapshotDomain.buildBusinessKey({
      sourceVersionKey: request.sourceVersionKey,
      rangeStart: request.rangeStart,
      rangeEnd: request.rangeEnd,
      universeHash: universeResult.hash,
      dataCutoffKey: dataCutoffResult.key,
      canonicalizationVersion: sourceVersion.canonicalizationVersion
    });

    const finalBusinessKey = businessKeyResult.businessKey;

    // 3. Candidate Query & Integrity
    let candidates: DatasetSnapshotBarCandidate[] = [];
    if (batches.length > 0) {
      candidates = await this.dailyBarQuery.listCandidates({
        sourceVersionId: sourceVersion.id,
        rangeStart: request.rangeStart,
        rangeEnd: request.rangeEnd,
        importBatchIds: batches.map(b => b.id)
      });
    }

    const batchIdSet = new Set(batches.map(b => b.id));
    candidates.forEach(c => {
      if (c.bar.sourceVersionId !== sourceVersion.id) throw new MarketDataIntegrityError('Dataset snapshot daily bar candidate is structurally inconsistent.');
      if (!batchIdSet.has(c.bar.importBatchId)) throw new MarketDataIntegrityError('Dataset snapshot daily bar candidate is structurally inconsistent.');
      if (c.bar.marketDate < request.rangeStart || c.bar.marketDate > request.rangeEnd) throw new MarketDataIntegrityError('Dataset snapshot daily bar candidate is structurally inconsistent.');
      if (!Number.isInteger(c.bar.correctionVersion) || c.bar.correctionVersion < 0) throw new MarketDataIntegrityError('Dataset snapshot daily bar candidate is structurally inconsistent.');
      try {
        DatasetSnapshotDomain.buildEntryHash({
          entrySequence: 1,
          instrumentBusinessKey: c.instrumentBusinessKey,
          marketDate: c.bar.marketDate,
          barCanonicalHash: c.bar.canonicalHash
        });
      } catch {
        throw new MarketDataIntegrityError('Dataset snapshot daily bar candidate is structurally inconsistent.');
      }
    });

    // 4. Correction Chain Selection
    const groups = new Map<string, DatasetSnapshotBarCandidate[]>();
    candidates.forEach(c => {
      const key = `${c.instrumentBusinessKey}|${c.bar.marketDate}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(c);
    });

    const currents: DatasetSnapshotBarCandidate[] = [];
    for (const group of groups.values()) {
      group.sort((a, b) => a.bar.correctionVersion - b.bar.correctionVersion);
      if (group[0].bar.correctionVersion !== 0) throw new MarketDataIntegrityError('Dataset snapshot eligible correction chain is inconsistent.');
      let prevId: string | null = null;
      let instId = group[0].bar.instrumentId;
      let recKey = group[0].bar.sourceRecordKey;
      let mkDate = group[0].bar.marketDate;
      let bizKey = group[0].instrumentBusinessKey;

      for (let i = 0; i < group.length; i++) {
        const c = group[i];
        if (c.bar.correctionVersion !== i) throw new MarketDataIntegrityError('Dataset snapshot eligible correction chain is inconsistent.');
        if (c.bar.instrumentId !== instId || c.bar.sourceRecordKey !== recKey || c.bar.marketDate !== mkDate || c.instrumentBusinessKey !== bizKey) {
          throw new MarketDataIntegrityError('Dataset snapshot eligible correction chain is inconsistent.');
        }
        if (i > 0 && c.bar.supersedesBarId !== prevId) throw new MarketDataIntegrityError('Dataset snapshot eligible correction chain is inconsistent.');
        prevId = c.bar.id;
      }
      currents.push(group[group.length - 1]);
    }

    // 5. Universe + Quality Selection
    const allowedSecurityTypes = new Set(universeResult.payload.securityTypes);
    const allowedExchanges = new Set(universeResult.payload.exchanges);
    const allowedKeys = new Set(universeResult.payload.instrumentBusinessKeys);
    const emptyKeys = universeResult.payload.instrumentBusinessKeys.length === 0;

    let selected = currents;
    if (universeResult.payload.exchanges.length === 0) {
      selected = [];
    } else {
      selected = currents.filter(c => {
        const parts = c.instrumentBusinessKey.split('|');
        const exchange = parts[1];
        const type = parts[3];
        if (!allowedExchanges.has(exchange as any)) return false;
        if (!allowedSecurityTypes.has(type as any)) return false;
        if (!emptyKeys && !allowedKeys.has(c.instrumentBusinessKey)) return false;

        if (c.bar.qualityDecision === 'QUARANTINED') return false;
        if (c.bar.qualityDecision === 'ACCEPTED_WITH_FLAGS') {
          if (!universeResult.payload.qualityFlagAllowlist.includes(c.bar.qualityFlags || '')) {
            return false;
          }
        }
        return true;
      });
    }

    // 6. Deterministic Entries
    selected.sort((a, b) => {
      if (a.instrumentBusinessKey < b.instrumentBusinessKey) return -1;
      if (a.instrumentBusinessKey > b.instrumentBusinessKey) return 1;
      if (a.bar.marketDate < b.bar.marketDate) return -1;
      if (a.bar.marketDate > b.bar.marketDate) return 1;
      return 0;
    });

    const entries = selected.map((c, i) => {
      const eSeq = i + 1;
      const entryResult = DatasetSnapshotDomain.buildEntryHash({
        entrySequence: eSeq,
        instrumentBusinessKey: c.instrumentBusinessKey,
        marketDate: c.bar.marketDate,
        barCanonicalHash: c.bar.canonicalHash
      });
      return {
        dailyBarId: c.bar.id,
        entrySequence: eSeq,
        instrumentBusinessKey: c.instrumentBusinessKey,
        marketDate: c.bar.marketDate,
        barCanonicalHash: c.bar.canonicalHash,
        entryHash: entryResult.entryHash
      };
    });

    // 7. Content Hashes
    const rowCount = entries.length;
    const manifestResult = DatasetSnapshotDomain.buildManifestHash(entries.map(e => e.entryHash));
    const contentResult = DatasetSnapshotDomain.buildContentHash({
      businessKey: finalBusinessKey,
      rowCount: rowCount,
      manifestHash: manifestResult.manifestHash
    });

    // 8. Business-Key Preflight (MUST occur AFTER content hashing)
    const existingByKey = await this.queryRepo.findByBusinessKey(finalBusinessKey);
    if (existingByKey) {
      this.verifyBusinessKeyIntegrity(
        existingByKey,
        request,
        universeResult,
        sourceVersion,
        dataCutoffResult,
        finalBusinessKey,
        creationRequestHash,
        rowCount,
        manifestResult.manifestHash,
        contentResult.contentHash
      );
      return { outcome: 'REPLAYED', snapshot: existingByKey };
    }

    // 9. Persistence
    DatasetSnapshotDomain.validateTransition('DRAFT', 'SEALED');

    const draft = {
      businessKey: finalBusinessKey,
      sourceVersionId: sourceVersion.id,
      rangeStart: request.rangeStart,
      rangeEnd: request.rangeEnd,
      universeDefinitionJson: universeResult.json,
      universeHash: universeResult.hash,
      dataCutoffKey: dataCutoffResult.key,
      dataCutoffAt: dataCutoffAt,
      canonicalizationVersion: sourceVersion.canonicalizationVersion,
      rowCount: rowCount,
      manifestHash: manifestResult.manifestHash,
      contentHash: contentResult.contentHash,
      status: 'DRAFT' as const,
      creationIdempotencyKey: request.creationIdempotencyKey,
      creationRequestHash: creationRequestHash
    };

    try {
      const sealedAt = this.clock.now();
      const created = await this.writeRepo.createSealed({ draft, entries, sealedAt });

      if (
        created.status !== 'SEALED' ||
        created.sealedAt === null ||
        created.businessKey !== draft.businessKey ||
        created.sourceVersionId !== draft.sourceVersionId ||
        created.rangeStart !== draft.rangeStart ||
        created.rangeEnd !== draft.rangeEnd ||
        created.universeDefinitionJson !== draft.universeDefinitionJson ||
        created.universeHash !== draft.universeHash ||
        created.dataCutoffKey !== draft.dataCutoffKey ||
        created.canonicalizationVersion !== draft.canonicalizationVersion ||
        created.rowCount !== draft.rowCount ||
        created.manifestHash !== draft.manifestHash ||
        created.contentHash !== draft.contentHash ||
        created.creationIdempotencyKey !== draft.creationIdempotencyKey ||
        created.creationRequestHash !== draft.creationRequestHash ||
        created.dataCutoffAt?.getTime() !== draft.dataCutoffAt?.getTime()
      ) {
        throw new MarketDataIntegrityError('Dataset snapshot persistence returned inconsistent content.');
      }

      return { outcome: 'CREATED', snapshot: created };
    } catch (e: any) {
      if (e instanceof DatasetSnapshotUniqueCollisionError) {
        return await this.recoverUniqueCollision(
          request,
          universeResult,
          sourceVersion,
          creationRequestHash,
          finalBusinessKey,
          dataCutoffResult.key,
          rowCount,
          manifestResult.manifestHash,
          contentResult.contentHash
        );
      }
      throw e;
    }
  }

  private validateIdempotencyKey(key: string) {
    if (typeof key !== 'string' || key.length === 0 || key.trim() !== key || /[\x00-\x1F\x7F]/.test(key)) {
      throw new DatasetSnapshotInvalidError('Invalid idempotency key.');
    }
  }

  private async recoverUniqueCollision(
    request: CreateDatasetSnapshotRequest,
    universeResult: any,
    sourceVersion: any,
    creationRequestHash: string,
    finalBusinessKey: string,
    dataCutoffKey: string,
    rowCount: number,
    manifestHash: string,
    contentHash: string
  ): Promise<CreateDatasetSnapshotResult> {
    const existing = await this.queryRepo.findByCreationIdempotencyKey(request.creationIdempotencyKey);
    if (existing) {
      if (existing.creationRequestHash !== creationRequestHash) {
        throw new DatasetSnapshotIdempotencyConflictError();
      }
      this.verifyIdempotencyIntegrity(existing, request, universeResult, sourceVersion);
      return { outcome: 'REPLAYED', snapshot: existing };
    }

    const existingByKey = await this.queryRepo.findByBusinessKey(finalBusinessKey);
    if (existingByKey) {
      this.verifyBusinessKeyIntegrity(
        existingByKey,
        request,
        universeResult,
        sourceVersion,
        { key: dataCutoffKey },
        finalBusinessKey,
        creationRequestHash,
        rowCount,
        manifestHash,
        contentHash
      );
      return { outcome: 'REPLAYED', snapshot: existingByKey };
    }

    throw new MarketDataIntegrityError('Dataset snapshot unique collision could not be resolved.');
  }

  private verifyIdempotencyIntegrity(existing: DatasetSnapshot, request: CreateDatasetSnapshotRequest, universeResult: any, sourceVersion: any) {
    if (
      existing.sourceVersionId !== sourceVersion.id ||
      existing.rangeStart !== request.rangeStart ||
      existing.rangeEnd !== request.rangeEnd ||
      existing.universeDefinitionJson !== universeResult.json ||
      existing.universeHash !== universeResult.hash ||
      existing.canonicalizationVersion !== sourceVersion.canonicalizationVersion ||
      existing.status !== 'SEALED' ||
      existing.sealedAt === null ||
      existing.dataCutoffAt === null
    ) {
      throw new MarketDataIntegrityError('Dataset snapshot idempotency replay resolves to inconsistent stored content.');
    }

    const recomputedKeyResult = DatasetSnapshotDomain.buildBusinessKey({
      sourceVersionKey: request.sourceVersionKey,
      rangeStart: request.rangeStart,
      rangeEnd: request.rangeEnd,
      universeHash: universeResult.hash,
      dataCutoffKey: existing.dataCutoffKey,
      canonicalizationVersion: sourceVersion.canonicalizationVersion
    });

    if (recomputedKeyResult.businessKey !== existing.businessKey) {
      throw new MarketDataIntegrityError('Dataset snapshot idempotency replay resolves to inconsistent stored content.');
    }

    const recomputedContent = DatasetSnapshotDomain.buildContentHash({
      businessKey: existing.businessKey,
      rowCount: existing.rowCount,
      manifestHash: existing.manifestHash
    });

    if (recomputedContent.contentHash !== existing.contentHash) {
      throw new MarketDataIntegrityError('Dataset snapshot idempotency replay resolves to inconsistent stored content.');
    }
  }

  private verifyBusinessKeyIntegrity(
    existing: DatasetSnapshot,
    request: CreateDatasetSnapshotRequest,
    universeResult: any,
    sourceVersion: any,
    dataCutoffResult: any,
    finalBusinessKey: string,
    creationRequestHash: string,
    currentRowCount: number,
    currentManifestHash: string,
    currentContentHash: string
  ) {
    if (
      existing.businessKey !== finalBusinessKey ||
      existing.sourceVersionId !== sourceVersion.id ||
      existing.rangeStart !== request.rangeStart ||
      existing.rangeEnd !== request.rangeEnd ||
      existing.universeDefinitionJson !== universeResult.json ||
      existing.universeHash !== universeResult.hash ||
      existing.dataCutoffKey !== dataCutoffResult.key ||
      existing.canonicalizationVersion !== sourceVersion.canonicalizationVersion ||
      existing.creationRequestHash !== creationRequestHash ||
      existing.rowCount !== currentRowCount ||
      existing.manifestHash !== currentManifestHash ||
      existing.contentHash !== currentContentHash ||
      existing.status !== 'SEALED' ||
      existing.sealedAt === null ||
      existing.dataCutoffAt === null
    ) {
      throw new MarketDataIntegrityError('Dataset snapshot business key resolves to inconsistent content.');
    }
  }
}
