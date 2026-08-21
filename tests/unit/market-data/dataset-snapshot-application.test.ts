import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreateDatasetSnapshotService, CreateDatasetSnapshotRequest } from '../../../src/application/services/market-data/CreateDatasetSnapshotService';
import { GetMarketDataSourceVersionService } from '../../../src/application/services/market-data/source-version/GetMarketDataSourceVersionService';
import {
  IDatasetSnapshotImportBatchQuery,
  IDatasetSnapshotDailyBarQuery,
  IDatasetSnapshotQueryRepository,
  IDatasetSnapshotWriteRepository,
  DatasetSnapshotUniqueCollisionError
} from '../../../src/application/ports/market-data/DatasetSnapshotPorts';
import { IClock } from '../../../src/application/ports/IClock';
import {
  DatasetSnapshotIdempotencyConflictError,
  MarketDataIntegrityError,
  DatasetSnapshotInvalidError
} from '../../../src/domain/market-data/MarketDataErrors';
import { MarketDataCanonicalization } from '../../../src/domain/market-data/MarketDataCanonicalization';
import { DatasetSnapshotDomain } from '../../../src/domain/market-data/DatasetSnapshot';

describe('DatasetSnapshot Application Service', () => {
  let getSourceVersion: any;
  let importBatchQuery: any;
  let dailyBarQuery: any;
  let queryRepo: any;
  let writeRepo: any;
  let clock: any;
  let service: CreateDatasetSnapshotService;

  beforeEach(() => {
    getSourceVersion = { execute: vi.fn() };
    importBatchQuery = { listCompletedThrough: vi.fn() };
    dailyBarQuery = { listCandidates: vi.fn() };
    queryRepo = { findByCreationIdempotencyKey: vi.fn(), findByBusinessKey: vi.fn() };
    writeRepo = { createSealed: vi.fn() };
    clock = { now: vi.fn() };

    service = new CreateDatasetSnapshotService(
      getSourceVersion,
      importBatchQuery,
      dailyBarQuery,
      queryRepo,
      writeRepo,
      clock
    );
  });

  const dummyUniverse = {
    securityTypes: ['EQUITY'] as any,
    exchanges: ['HOSE'] as any,
    instrumentBusinessKeys: [],
    qualityFlagAllowlist: []
  };

  const validReq: CreateDatasetSnapshotRequest = {
    sourceVersionKey: 'VN|MARKET_DATA_SOURCE|1234567890123456789012345678901234567890123456789012345678901234',
    rangeStart: '2023-01-01',
    rangeEnd: '2023-12-31',
    universe: dummyUniverse,
    creationIdempotencyKey: 'idemp-1'
  };

  const dummySourceVersion = {
    id: 'sv-1',
    sourceKey: 'VN|MARKET_DATA_SOURCE|1234567890123456789012345678901234567890123456789012345678901234',
    canonicalizationVersion: '1.0'
  };

  describe('A. REQUEST / IDEMPOTENCY', () => {
    it('invalid idempotency key rejected', async () => {
      await expect(service.execute({ ...validReq, creationIdempotencyKey: '' }))
        .rejects.toThrow(DatasetSnapshotInvalidError);
      await expect(service.execute({ ...validReq, creationIdempotencyKey: ' ' }))
        .rejects.toThrow(DatasetSnapshotInvalidError);
    });

    it('hard-coded fixed creationRequestHash vector', async () => {
      getSourceVersion.execute.mockResolvedValue(dummySourceVersion);
      queryRepo.findByCreationIdempotencyKey.mockResolvedValue(null);
      importBatchQuery.listCompletedThrough.mockResolvedValue([]);
      clock.now.mockReturnValue(new Date('2024-01-01T00:00:00Z'));
      writeRepo.createSealed.mockImplementation(async (cmd: any) => ({
        ...cmd.draft,
        status: 'SEALED',
        sealedAt: cmd.sealedAt,
        dataCutoffAt: cmd.draft.dataCutoffAt
      }));

      const req: CreateDatasetSnapshotRequest = {
        sourceVersionKey: 'VN|MARKET_DATA_SOURCE|1234567890123456789012345678901234567890123456789012345678901234',
        rangeStart: '2023-01-01',
        rangeEnd: '2023-12-31',
        universe: {
          securityTypes: ['EQUITY'],
          exchanges: ['HOSE', 'HNX', 'UPCOM'],
          instrumentBusinessKeys: [],
          qualityFlagAllowlist: []
        },
        creationIdempotencyKey: 'idemp-1'
      };

      const res = await service.execute(req);
      const hash = res.snapshot.creationRequestHash;
      
      const uHash = DatasetSnapshotDomain.buildUniverse({
        ...req.universe,
        securityTypes: ['EQUITY'] as any,
        exchanges: ['HOSE', 'HNX', 'UPCOM'] as any,
      }).hash;
      
      const payload = {
        canonicalizationVersion: '1.0',
        rangeEnd: '2023-12-31',
        rangeStart: '2023-01-01',
        requestContractVersion: '1.0',
        sourceVersionKey: 'VN|MARKET_DATA_SOURCE|1234567890123456789012345678901234567890123456789012345678901234',
        universeHash: uHash
      };
      
      const expected = MarketDataCanonicalization.hashPayload(payload);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
      expect(hash).toBe(expected);
      expect(typeof expected).toBe('string');
    });

    it('exact idempotency replay returns original snapshot, zero downstream calls', async () => {
      getSourceVersion.execute.mockResolvedValue(dummySourceVersion);
      const universeResult = DatasetSnapshotDomain.buildUniverse(dummyUniverse as any);
      const reqHash = MarketDataCanonicalization.hashPayload({
        requestContractVersion: '1.0',
        sourceVersionKey: 'VN|MARKET_DATA_SOURCE|1234567890123456789012345678901234567890123456789012345678901234',
        rangeStart: '2023-01-01',
        rangeEnd: '2023-12-31',
        universeHash: universeResult.hash,
        canonicalizationVersion: '1.0'
      });
      const dataCutoffKey = DatasetSnapshotDomain.buildDataCutoff({ batches: [] }).key;
      const bKey = DatasetSnapshotDomain.buildBusinessKey({
        sourceVersionKey: 'VN|MARKET_DATA_SOURCE|1234567890123456789012345678901234567890123456789012345678901234',
        rangeStart: '2023-01-01',
        rangeEnd: '2023-12-31',
        universeHash: universeResult.hash,
        dataCutoffKey,
        canonicalizationVersion: '1.0'
      }).businessKey;
      const cHash = DatasetSnapshotDomain.buildContentHash({
        businessKey: bKey,
        rowCount: 0,
        manifestHash: DatasetSnapshotDomain.buildManifestHash([]).manifestHash
      }).contentHash;

      const existing = {
        sourceVersionId: 'sv-1',
        rangeStart: '2023-01-01',
        rangeEnd: '2023-12-31',
        universeDefinitionJson: universeResult.json,
        universeHash: universeResult.hash,
        canonicalizationVersion: '1.0',
        status: 'SEALED',
        sealedAt: new Date(),
        dataCutoffAt: new Date(),
        dataCutoffKey,
        businessKey: bKey,
        rowCount: 0,
        manifestHash: DatasetSnapshotDomain.buildManifestHash([]).manifestHash,
        contentHash: cHash,
        creationRequestHash: reqHash
      };
      queryRepo.findByCreationIdempotencyKey.mockResolvedValue(existing);

      const res = await service.execute(validReq);
      expect(res.outcome).toBe('REPLAYED');
      expect(res.snapshot).toBe(existing);
      expect(clock.now).not.toHaveBeenCalled();
      expect(importBatchQuery.listCompletedThrough).not.toHaveBeenCalled();
    });

    it('same idempotency key + different request hash throws DatasetSnapshotIdempotencyConflictError', async () => {
      getSourceVersion.execute.mockResolvedValue(dummySourceVersion);
      queryRepo.findByCreationIdempotencyKey.mockResolvedValue({
        creationRequestHash: 'different'
      });
      await expect(service.execute(validReq)).rejects.toThrow(DatasetSnapshotIdempotencyConflictError);
    });

    it('same request hash + corrupt stored identity/content throws integrity', async () => {
      getSourceVersion.execute.mockResolvedValue(dummySourceVersion);
      const universeResult = DatasetSnapshotDomain.buildUniverse(dummyUniverse as any);
      const reqHash = MarketDataCanonicalization.hashPayload({
        requestContractVersion: '1.0',
        sourceVersionKey: 'VN|MARKET_DATA_SOURCE|1234567890123456789012345678901234567890123456789012345678901234',
        rangeStart: '2023-01-01',
        rangeEnd: '2023-12-31',
        universeHash: universeResult.hash,
        canonicalizationVersion: '1.0'
      });
      
      queryRepo.findByCreationIdempotencyKey.mockResolvedValue({
        creationRequestHash: reqHash,
        sourceVersionId: 'different'
      });
      
      await expect(service.execute(validReq)).rejects.toThrow(MarketDataIntegrityError);
    });
  });

  describe('B. CUTOFF', () => {
    it('COMPLETED and COMPLETED_WITH_QUARANTINE included, wrong source/status throws', async () => {
      getSourceVersion.execute.mockResolvedValue(dummySourceVersion);
      queryRepo.findByCreationIdempotencyKey.mockResolvedValue(null);
      const now = new Date('2024-01-01T00:00:00Z');
      clock.now.mockReturnValue(now);

      const baseBatch = { id: 'b1', sourceVersionId: 'sv-1', batchBusinessKey: '1234567890123456789012345678901234567890123456789012345678901234', sourceContentHash: '1234567890123456789012345678901234567890123456789012345678901234', status: 'COMPLETED', completedAt: new Date('2023-12-01T00:00:00Z') };
      
      importBatchQuery.listCompletedThrough.mockResolvedValue([{ ...baseBatch, sourceVersionId: 'sv-2' }]);
      await expect(service.execute(validReq)).rejects.toThrow(MarketDataIntegrityError);

      importBatchQuery.listCompletedThrough.mockResolvedValue([{ ...baseBatch, status: 'PENDING' }]);
      await expect(service.execute(validReq)).rejects.toThrow(MarketDataIntegrityError);

      importBatchQuery.listCompletedThrough.mockResolvedValue([{ ...baseBatch, completedAt: null }]);
      await expect(service.execute(validReq)).rejects.toThrow(MarketDataIntegrityError);

      importBatchQuery.listCompletedThrough.mockResolvedValue([{ ...baseBatch, completedAt: new Date('2024-02-01T00:00:00Z') }]);
      await expect(service.execute(validReq)).rejects.toThrow(MarketDataIntegrityError);
    });
  });

  describe('C. CORRECTIONS', () => {
    it('v0 selected, missing v0 throws, version gap throws, wrong supersedes throws', async () => {
      getSourceVersion.execute.mockResolvedValue(dummySourceVersion);
      queryRepo.findByCreationIdempotencyKey.mockResolvedValue(null);
      const now = new Date();
      clock.now.mockReturnValue(now);
      importBatchQuery.listCompletedThrough.mockResolvedValue([
        { id: 'b1', sourceVersionId: 'sv-1', batchBusinessKey: '1234567890123456789012345678901234567890123456789012345678901234', sourceContentHash: '1234567890123456789012345678901234567890123456789012345678901234', status: 'COMPLETED', completedAt: now }
      ]);

      const baseBar = { id: 'b-1', sourceVersionId: 'sv-1', importBatchId: 'b1', marketDate: '2023-05-05', correctionVersion: 0, canonicalHash: '1234567890123456789012345678901234567890123456789012345678901234', qualityStatus: 'ACCEPTED', instrumentId: 'i-1', sourceRecordKey: 'rk-1' };
      const baseCand = { bar: baseBar, instrumentBusinessKey: 'VN|HOSE|VCB|EQUITY|2023-05-05' };

      dailyBarQuery.listCandidates.mockResolvedValue([{ ...baseCand, bar: { ...baseBar, correctionVersion: 1 } }]);
      await expect(service.execute(validReq)).rejects.toThrow(MarketDataIntegrityError);

      dailyBarQuery.listCandidates.mockResolvedValue([
        baseCand,
        { ...baseCand, bar: { ...baseBar, id: 'b-2', correctionVersion: 2, supersedesBarId: 'b-1' } }
      ]);
      await expect(service.execute(validReq)).rejects.toThrow(MarketDataIntegrityError);

      dailyBarQuery.listCandidates.mockResolvedValue([
        baseCand,
        { ...baseCand, bar: { ...baseBar, id: 'b-2', correctionVersion: 1, supersedesBarId: 'wrong' } }
      ]);
      await expect(service.execute(validReq)).rejects.toThrow(MarketDataIntegrityError);
      
      dailyBarQuery.listCandidates.mockResolvedValue([
        baseCand,
        { ...baseCand, bar: { ...baseBar, id: 'b-2', correctionVersion: 1, supersedesBarId: 'b-1' } },
        { ...baseCand, bar: { ...baseBar, id: 'b-3', correctionVersion: 2, supersedesBarId: 'b-2' } }
      ]);
      writeRepo.createSealed.mockImplementation(async (cmd: any) => ({ ...cmd.draft, status: 'SEALED', sealedAt: cmd.sealedAt, dataCutoffAt: cmd.draft.dataCutoffAt }));
      const res = await service.execute(validReq);
      expect(res.snapshot.rowCount).toBe(1);
    });
  });

  describe('D. QUALITY & E. UNIVERSE & F. ENTRIES', () => {
    it('quarantined latest no-fallback result, flagged exact match, empty exchanges', async () => {
      getSourceVersion.execute.mockResolvedValue(dummySourceVersion);
      queryRepo.findByCreationIdempotencyKey.mockResolvedValue(null);
      const now = new Date();
      clock.now.mockReturnValue(now);
      importBatchQuery.listCompletedThrough.mockResolvedValue([
        { id: 'b1', sourceVersionId: 'sv-1', batchBusinessKey: '1234567890123456789012345678901234567890123456789012345678901234', sourceContentHash: '1234567890123456789012345678901234567890123456789012345678901234', status: 'COMPLETED', completedAt: now }
      ]);

      const baseBar = { id: 'b-1', sourceVersionId: 'sv-1', importBatchId: 'b1', marketDate: '2023-05-05', correctionVersion: 0, canonicalHash: '1234567890123456789012345678901234567890123456789012345678901234', qualityStatus: 'ACCEPTED', instrumentId: 'i-1', sourceRecordKey: 'rk-1' };
      const baseCand = { bar: baseBar, instrumentBusinessKey: 'VN|HOSE|VCB|EQUITY|2023-05-05' };

      dailyBarQuery.listCandidates.mockResolvedValue([
        baseCand,
        { ...baseCand, bar: { ...baseBar, id: 'b-2', correctionVersion: 1, supersedesBarId: 'b-1', qualityStatus: 'QUARANTINED' } }
      ]);
      writeRepo.createSealed.mockImplementation(async (cmd: any) => ({ ...cmd.draft, status: 'SEALED', sealedAt: cmd.sealedAt, dataCutoffAt: cmd.draft.dataCutoffAt }));
      let res = await service.execute(validReq);
      expect(res.snapshot.rowCount).toBe(0);

      dailyBarQuery.listCandidates.mockResolvedValue([
        baseCand,
        { ...baseCand, bar: { ...baseBar, id: 'b-2', correctionVersion: 1, supersedesBarId: 'b-1', qualityStatus: 'ACCEPTED_WITH_FLAGS', qualityFlags: 'X' } }
      ]);
      res = await service.execute(validReq);
      expect(res.snapshot.rowCount).toBe(0);
    });
  });

  describe('G. ZERO ROW', () => {
    it('zero eligible batches -> zero rows', async () => {
      getSourceVersion.execute.mockResolvedValue(dummySourceVersion);
      queryRepo.findByCreationIdempotencyKey.mockResolvedValue(null);
      clock.now.mockReturnValue(new Date());
      importBatchQuery.listCompletedThrough.mockResolvedValue([]);
      writeRepo.createSealed.mockImplementation(async (cmd: any) => ({ ...cmd.draft, status: 'SEALED', sealedAt: cmd.sealedAt, dataCutoffAt: cmd.draft.dataCutoffAt }));

      const res = await service.execute(validReq);
      expect(dailyBarQuery.listCandidates).not.toHaveBeenCalled();
      expect(res.snapshot.rowCount).toBe(0);
    });
  });

  describe('H. BUSINESS KEY REPLAY', () => {
    it('exact business/content replay returns REPLAYED', async () => {
      getSourceVersion.execute.mockResolvedValue(dummySourceVersion);
      queryRepo.findByCreationIdempotencyKey.mockResolvedValue(null);
      clock.now.mockReturnValue(new Date());
      importBatchQuery.listCompletedThrough.mockResolvedValue([]);

      const universeResult = DatasetSnapshotDomain.buildUniverse(dummyUniverse as any);
      const reqHash = MarketDataCanonicalization.hashPayload({
        requestContractVersion: '1.0',
        sourceVersionKey: 'VN|MARKET_DATA_SOURCE|1234567890123456789012345678901234567890123456789012345678901234',
        rangeStart: '2023-01-01',
        rangeEnd: '2023-12-31',
        universeHash: universeResult.hash,
        canonicalizationVersion: '1.0'
      });
      const dataCutoffKey = DatasetSnapshotDomain.buildDataCutoff({ batches: [] }).key;
      const bKey = DatasetSnapshotDomain.buildBusinessKey({
        sourceVersionKey: 'VN|MARKET_DATA_SOURCE|1234567890123456789012345678901234567890123456789012345678901234',
        rangeStart: '2023-01-01',
        rangeEnd: '2023-12-31',
        universeHash: universeResult.hash,
        dataCutoffKey,
        canonicalizationVersion: '1.0'
      }).businessKey;
      const cHash = DatasetSnapshotDomain.buildContentHash({
        businessKey: bKey,
        rowCount: 0,
        manifestHash: DatasetSnapshotDomain.buildManifestHash([]).manifestHash
      }).contentHash;

      const existing = {
        businessKey: bKey,
        sourceVersionId: 'sv-1',
        rangeStart: '2023-01-01',
        rangeEnd: '2023-12-31',
        universeDefinitionJson: universeResult.json,
        universeHash: universeResult.hash,
        canonicalizationVersion: '1.0',
        status: 'SEALED',
        sealedAt: new Date(),
        dataCutoffAt: new Date(),
        dataCutoffKey,
        rowCount: 0,
        manifestHash: DatasetSnapshotDomain.buildManifestHash([]).manifestHash,
        contentHash: cHash,
        creationRequestHash: reqHash,
        creationIdempotencyKey: 'different'
      };
      
      queryRepo.findByBusinessKey.mockResolvedValue(existing);

      const res = await service.execute(validReq);
      expect(res.outcome).toBe('REPLAYED');
      expect(res.snapshot).toBe(existing);
    });
  });

  describe('J. COLLISION', () => {
    it('technical collision + idempotency winner => REPLAYED', async () => {
      getSourceVersion.execute.mockResolvedValue(dummySourceVersion);
      queryRepo.findByCreationIdempotencyKey.mockResolvedValue(null);
      clock.now.mockReturnValue(new Date());
      importBatchQuery.listCompletedThrough.mockResolvedValue([]);
      
      writeRepo.createSealed.mockRejectedValue(new DatasetSnapshotUniqueCollisionError());

      const universeResult = DatasetSnapshotDomain.buildUniverse(dummyUniverse as any);
      const reqHash = MarketDataCanonicalization.hashPayload({
        requestContractVersion: '1.0',
        sourceVersionKey: 'VN|MARKET_DATA_SOURCE|1234567890123456789012345678901234567890123456789012345678901234',
        rangeStart: '2023-01-01',
        rangeEnd: '2023-12-31',
        universeHash: universeResult.hash,
        canonicalizationVersion: '1.0'
      });
      const dataCutoffKey = DatasetSnapshotDomain.buildDataCutoff({ batches: [] }).key;
      const bKey = DatasetSnapshotDomain.buildBusinessKey({
        sourceVersionKey: 'VN|MARKET_DATA_SOURCE|1234567890123456789012345678901234567890123456789012345678901234',
        rangeStart: '2023-01-01',
        rangeEnd: '2023-12-31',
        universeHash: universeResult.hash,
        dataCutoffKey,
        canonicalizationVersion: '1.0'
      }).businessKey;
      const cHash = DatasetSnapshotDomain.buildContentHash({
        businessKey: bKey,
        rowCount: 0,
        manifestHash: DatasetSnapshotDomain.buildManifestHash([]).manifestHash
      }).contentHash;

      const existing = {
        sourceVersionId: 'sv-1',
        rangeStart: '2023-01-01',
        rangeEnd: '2023-12-31',
        universeDefinitionJson: universeResult.json,
        universeHash: universeResult.hash,
        canonicalizationVersion: '1.0',
        status: 'SEALED',
        sealedAt: new Date(),
        dataCutoffAt: new Date(),
        dataCutoffKey,
        businessKey: bKey,
        rowCount: 0,
        manifestHash: DatasetSnapshotDomain.buildManifestHash([]).manifestHash,
        contentHash: cHash,
        creationRequestHash: reqHash,
        creationIdempotencyKey: 'idemp-1'
      };

      queryRepo.findByCreationIdempotencyKey.mockImplementation((k: string) => {
        if (queryRepo.findByCreationIdempotencyKey.mock.calls.length > 1) {
          return Promise.resolve(existing);
        }
        return Promise.resolve(null);
      });

      const res = await service.execute(validReq);
      expect(res.outcome).toBe('REPLAYED');
    });

    it('unrelated Error rethrown exact same object', async () => {
      getSourceVersion.execute.mockResolvedValue(dummySourceVersion);
      queryRepo.findByCreationIdempotencyKey.mockResolvedValue(null);
      clock.now.mockReturnValue(new Date());
      importBatchQuery.listCompletedThrough.mockResolvedValue([]);
      const myErr = new Error('boom');
      writeRepo.createSealed.mockRejectedValue(myErr);

      await expect(service.execute(validReq)).rejects.toBe(myErr);
    });
  });

  describe('K. ERROR METADATA', () => {
    it('DatasetSnapshotIdempotencyConflictError exact metadata', () => {
      const err = new DatasetSnapshotIdempotencyConflictError();
      expect(err.code).toBe('DATASET_SNAPSHOT_IDEMPOTENCY_CONFLICT');
      expect(err.category).toBe('CONFLICT');
      expect(err.retryable).toBe(false);
      expect(err.safeMessage).toBe('This snapshot request has already been processed with different data.');
      expect(err.message).toBe('Dataset snapshot idempotency key reused with different request payload.');
    });
  });
});
