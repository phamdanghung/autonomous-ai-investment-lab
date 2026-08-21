import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreateDatasetSnapshotService, CreateDatasetSnapshotRequest } from '../../../src/application/services/market-data/CreateDatasetSnapshotService';
import { DatasetSnapshotUniqueCollisionError } from '../../../src/application/ports/market-data/DatasetSnapshotPorts';
import {
  DatasetSnapshotIdempotencyConflictError,
  MarketDataIntegrityError,
  DatasetSnapshotInvalidError
} from '../../../src/domain/market-data/MarketDataErrors';
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
    exchanges: ['HOSE', 'HNX', 'UPCOM'] as any,
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

      const expectedSha256 = '9e840bab45c7af2fbb06f6bd90524b13b4da67ee334561f814bc594d1f277236';
      expect(hash).toBe(expectedSha256);
    });

    it('exact idempotency replay returns original snapshot, zero downstream calls', async () => {
      getSourceVersion.execute.mockResolvedValue(dummySourceVersion);
      const universeResult = DatasetSnapshotDomain.buildUniverse(dummyUniverse as any);

      const expectedSha256 = '9e840bab45c7af2fbb06f6bd90524b13b4da67ee334561f814bc594d1f277236';

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
        creationRequestHash: expectedSha256
      };
      queryRepo.findByCreationIdempotencyKey.mockResolvedValue(existing);

      const res = await service.execute(validReq);
      expect(res.outcome).toBe('REPLAYED');
      expect(res.snapshot).toBe(existing);

      expect(clock.now).not.toHaveBeenCalled();
      expect(importBatchQuery.listCompletedThrough).not.toHaveBeenCalled();
      expect(dailyBarQuery.listCandidates).not.toHaveBeenCalled();
      expect(writeRepo.createSealed).not.toHaveBeenCalled();
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
      const expectedSha256 = '9e840bab45c7af2fbb06f6bd90524b13b4da67ee334561f814bc594d1f277236';

      queryRepo.findByCreationIdempotencyKey.mockResolvedValue({
        creationRequestHash: expectedSha256,
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

      const baseBar = { id: 'b-1', sourceVersionId: 'sv-1', importBatchId: 'b1', marketDate: '2023-05-05', correctionVersion: 0, canonicalHash: '1234567890123456789012345678901234567890123456789012345678901234', qualityDecision: 'ACCEPTED', instrumentId: 'i-1', sourceRecordKey: 'rk-1' };
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
    it('A. v0 qualityDecision ACCEPTED, v1 qualityDecision QUARANTINED => rowCount 0', async () => {
      getSourceVersion.execute.mockResolvedValue(dummySourceVersion);
      queryRepo.findByCreationIdempotencyKey.mockResolvedValue(null);
      const now = new Date();
      clock.now.mockReturnValue(now);
      importBatchQuery.listCompletedThrough.mockResolvedValue([
        { id: 'b1', sourceVersionId: 'sv-1', batchBusinessKey: '1234567890123456789012345678901234567890123456789012345678901234', sourceContentHash: '1234567890123456789012345678901234567890123456789012345678901234', status: 'COMPLETED', completedAt: now }
      ]);

      const baseBar = { id: 'b-1', sourceVersionId: 'sv-1', importBatchId: 'b1', marketDate: '2023-05-05', correctionVersion: 0, canonicalHash: '1234567890123456789012345678901234567890123456789012345678901234', qualityDecision: 'ACCEPTED', instrumentId: 'i-1', sourceRecordKey: 'rk-1' };
      const baseCand = { bar: baseBar, instrumentBusinessKey: 'VN|HOSE|VCB|EQUITY|2023-05-05' };

      dailyBarQuery.listCandidates.mockResolvedValue([
        baseCand,
        { ...baseCand, bar: { ...baseBar, id: 'b-2', correctionVersion: 1, supersedesBarId: 'b-1', qualityDecision: 'QUARANTINED' } }
      ]);
      writeRepo.createSealed.mockImplementation(async (cmd: any) => ({ ...cmd.draft, status: 'SEALED', sealedAt: cmd.sealedAt, dataCutoffAt: cmd.draft.dataCutoffAt }));
      const res = await service.execute(validReq);
      expect(res.snapshot.rowCount).toBe(0);
    });

    it('B. v0 ACCEPTED, v1 ACCEPTED_WITH_FLAGS (FLAG_A not in allowlist) => rowCount 0', async () => {
      getSourceVersion.execute.mockResolvedValue(dummySourceVersion);
      queryRepo.findByCreationIdempotencyKey.mockResolvedValue(null);
      const now = new Date();
      clock.now.mockReturnValue(now);
      importBatchQuery.listCompletedThrough.mockResolvedValue([
        { id: 'b1', sourceVersionId: 'sv-1', batchBusinessKey: '1234567890123456789012345678901234567890123456789012345678901234', sourceContentHash: '1234567890123456789012345678901234567890123456789012345678901234', status: 'COMPLETED', completedAt: now }
      ]);

      const baseBar = { id: 'b-1', sourceVersionId: 'sv-1', importBatchId: 'b1', marketDate: '2023-05-05', correctionVersion: 0, canonicalHash: '1234567890123456789012345678901234567890123456789012345678901234', qualityDecision: 'ACCEPTED', instrumentId: 'i-1', sourceRecordKey: 'rk-1' };
      const baseCand = { bar: baseBar, instrumentBusinessKey: 'VN|HOSE|VCB|EQUITY|2023-05-05' };

      dailyBarQuery.listCandidates.mockResolvedValue([
        baseCand,
        { ...baseCand, bar: { ...baseBar, id: 'b-2', correctionVersion: 1, supersedesBarId: 'b-1', qualityDecision: 'ACCEPTED_WITH_FLAGS', qualityFlags: 'FLAG_A' } }
      ]);
      writeRepo.createSealed.mockImplementation(async (cmd: any) => ({ ...cmd.draft, status: 'SEALED', sealedAt: cmd.sealedAt, dataCutoffAt: cmd.draft.dataCutoffAt }));
      const res = await service.execute(validReq);
      expect(res.snapshot.rowCount).toBe(0);
    });

    it('C. v1 ACCEPTED_WITH_FLAGS (FLAG_A in exact allowlist) => included', async () => {
      getSourceVersion.execute.mockResolvedValue(dummySourceVersion);
      queryRepo.findByCreationIdempotencyKey.mockResolvedValue(null);
      const now = new Date();
      clock.now.mockReturnValue(now);
      importBatchQuery.listCompletedThrough.mockResolvedValue([
        { id: 'b1', sourceVersionId: 'sv-1', batchBusinessKey: '1234567890123456789012345678901234567890123456789012345678901234', sourceContentHash: '1234567890123456789012345678901234567890123456789012345678901234', status: 'COMPLETED', completedAt: now }
      ]);

      const baseBar = { id: 'b-1', sourceVersionId: 'sv-1', importBatchId: 'b1', marketDate: '2023-05-05', correctionVersion: 0, canonicalHash: '1234567890123456789012345678901234567890123456789012345678901234', qualityDecision: 'ACCEPTED', instrumentId: 'i-1', sourceRecordKey: 'rk-1' };
      const baseCand = { bar: baseBar, instrumentBusinessKey: 'VN|HOSE|VCB|EQUITY|2023-05-05' };

      dailyBarQuery.listCandidates.mockResolvedValue([
        baseCand,
        { ...baseCand, bar: { ...baseBar, id: 'b-2', correctionVersion: 1, supersedesBarId: 'b-1', qualityDecision: 'ACCEPTED_WITH_FLAGS', qualityFlags: 'FLAG_A' } }
      ]);
      writeRepo.createSealed.mockImplementation(async (cmd: any) => ({ ...cmd.draft, status: 'SEALED', sealedAt: cmd.sealedAt, dataCutoffAt: cmd.draft.dataCutoffAt }));
      const req = { ...validReq, universe: { ...validReq.universe, qualityFlagAllowlist: ['FLAG_A'] } };
      const res = await service.execute(req);
      expect(res.snapshot.rowCount).toBe(1);
    });

    it('D. allowlist contains FLAG_A,FLAG_B while qualityFlags is FLAG_A => no partial match', async () => {
      getSourceVersion.execute.mockResolvedValue(dummySourceVersion);
      queryRepo.findByCreationIdempotencyKey.mockResolvedValue(null);
      const now = new Date();
      clock.now.mockReturnValue(now);
      importBatchQuery.listCompletedThrough.mockResolvedValue([
        { id: 'b1', sourceVersionId: 'sv-1', batchBusinessKey: '1234567890123456789012345678901234567890123456789012345678901234', sourceContentHash: '1234567890123456789012345678901234567890123456789012345678901234', status: 'COMPLETED', completedAt: now }
      ]);

      const baseBar = { id: 'b-1', sourceVersionId: 'sv-1', importBatchId: 'b1', marketDate: '2023-05-05', correctionVersion: 0, canonicalHash: '1234567890123456789012345678901234567890123456789012345678901234', qualityDecision: 'ACCEPTED', instrumentId: 'i-1', sourceRecordKey: 'rk-1' };
      const baseCand = { bar: baseBar, instrumentBusinessKey: 'VN|HOSE|VCB|EQUITY|2023-05-05' };

      dailyBarQuery.listCandidates.mockResolvedValue([
        baseCand,
        { ...baseCand, bar: { ...baseBar, id: 'b-2', correctionVersion: 1, supersedesBarId: 'b-1', qualityDecision: 'ACCEPTED_WITH_FLAGS', qualityFlags: 'FLAG_A' } }
      ]);
      writeRepo.createSealed.mockImplementation(async (cmd: any) => ({ ...cmd.draft, status: 'SEALED', sealedAt: cmd.sealedAt, dataCutoffAt: cmd.draft.dataCutoffAt }));
      const req = { ...validReq, universe: { ...validReq.universe, qualityFlagAllowlist: ['FLAG_A,FLAG_B'] } };
      const res = await service.execute(req);
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

      const expectedSha256 = '9e840bab45c7af2fbb06f6bd90524b13b4da67ee334561f814bc594d1f277236';
      const universeResult = DatasetSnapshotDomain.buildUniverse(dummyUniverse as any);

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
        creationRequestHash: expectedSha256,
        creationIdempotencyKey: 'different'
      };

      queryRepo.findByBusinessKey.mockResolvedValue(existing);

      const res = await service.execute(validReq);
      expect(res.outcome).toBe('REPLAYED');
      expect(res.snapshot).toBe(existing);
    });

    it('business-key replay returns IntegrityError if rowCount mismatches expected candidates', async () => {
      getSourceVersion.execute.mockResolvedValue(dummySourceVersion);
      queryRepo.findByCreationIdempotencyKey.mockResolvedValue(null);
      const now = new Date();
      clock.now.mockReturnValue(now);
      importBatchQuery.listCompletedThrough.mockResolvedValue([
        { id: 'b1', sourceVersionId: 'sv-1', batchBusinessKey: '1234567890123456789012345678901234567890123456789012345678901234', sourceContentHash: '1234567890123456789012345678901234567890123456789012345678901234', status: 'COMPLETED', completedAt: now }
      ]);
      const baseBar = { id: 'b-1', sourceVersionId: 'sv-1', importBatchId: 'b1', marketDate: '2023-05-05', correctionVersion: 0, canonicalHash: '1234567890123456789012345678901234567890123456789012345678901234', qualityDecision: 'ACCEPTED', instrumentId: 'i-1', sourceRecordKey: 'rk-1' };
      const baseCand = { bar: baseBar, instrumentBusinessKey: 'VN|HOSE|VCB|EQUITY|2023-05-05' };
      dailyBarQuery.listCandidates.mockResolvedValue([baseCand]);

      const expectedSha256 = '9e840bab45c7af2fbb06f6bd90524b13b4da67ee334561f814bc594d1f277236';
      const universeResult = DatasetSnapshotDomain.buildUniverse(dummyUniverse as any);

      const dataCutoffKey = DatasetSnapshotDomain.buildDataCutoff({ batches: [{ batchBusinessKey: '1234567890123456789012345678901234567890123456789012345678901234', sourceContentHash: '1234567890123456789012345678901234567890123456789012345678901234' }] }).key;
      const bKey = DatasetSnapshotDomain.buildBusinessKey({
        sourceVersionKey: 'VN|MARKET_DATA_SOURCE|1234567890123456789012345678901234567890123456789012345678901234',
        rangeStart: '2023-01-01',
        rangeEnd: '2023-12-31',
        universeHash: universeResult.hash,
        dataCutoffKey,
        canonicalizationVersion: '1.0'
      }).businessKey;

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
        contentHash: 'differentHash',
        creationRequestHash: expectedSha256,
        creationIdempotencyKey: 'different'
      };

      queryRepo.findByBusinessKey.mockResolvedValue(existing);

      await expect(service.execute(validReq)).rejects.toThrow(MarketDataIntegrityError);
    });

    it('business-key replay returns IntegrityError if manifestHash mismatches expected', async () => {
      getSourceVersion.execute.mockResolvedValue(dummySourceVersion);
      queryRepo.findByCreationIdempotencyKey.mockResolvedValue(null);
      clock.now.mockReturnValue(new Date());
      importBatchQuery.listCompletedThrough.mockResolvedValue([]);

      const expectedSha256 = '9e840bab45c7af2fbb06f6bd90524b13b4da67ee334561f814bc594d1f277236';
      const universeResult = DatasetSnapshotDomain.buildUniverse(dummyUniverse as any);

      const dataCutoffKey = DatasetSnapshotDomain.buildDataCutoff({ batches: [] }).key;
      const bKey = DatasetSnapshotDomain.buildBusinessKey({
        sourceVersionKey: 'VN|MARKET_DATA_SOURCE|1234567890123456789012345678901234567890123456789012345678901234',
        rangeStart: '2023-01-01',
        rangeEnd: '2023-12-31',
        universeHash: universeResult.hash,
        dataCutoffKey,
        canonicalizationVersion: '1.0'
      }).businessKey;

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
        manifestHash: 'differentManifest',
        contentHash: 'differentHash',
        creationRequestHash: expectedSha256,
        creationIdempotencyKey: 'different'
      };

      queryRepo.findByBusinessKey.mockResolvedValue(existing);

      await expect(service.execute(validReq)).rejects.toThrow(MarketDataIntegrityError);
    });
  });

  describe('J. COLLISION', () => {
    it('technical collision + idempotency winner => REPLAYED', async () => {
      getSourceVersion.execute.mockResolvedValue(dummySourceVersion);
      queryRepo.findByCreationIdempotencyKey.mockResolvedValue(null);
      clock.now.mockReturnValue(new Date());
      importBatchQuery.listCompletedThrough.mockResolvedValue([]);

      writeRepo.createSealed.mockRejectedValue(new DatasetSnapshotUniqueCollisionError());

      const expectedSha256 = '9e840bab45c7af2fbb06f6bd90524b13b4da67ee334561f814bc594d1f277236';
      const universeResult = DatasetSnapshotDomain.buildUniverse(dummyUniverse as any);

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
        creationRequestHash: expectedSha256,
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

    it('technical collision + business-key winner => REPLAYED, zero extra query calls', async () => {
      getSourceVersion.execute.mockResolvedValue(dummySourceVersion);
      queryRepo.findByCreationIdempotencyKey.mockResolvedValue(null);
      clock.now.mockReturnValue(new Date());
      importBatchQuery.listCompletedThrough.mockResolvedValue([]);

      writeRepo.createSealed.mockRejectedValue(new DatasetSnapshotUniqueCollisionError());

      const expectedSha256 = '9e840bab45c7af2fbb06f6bd90524b13b4da67ee334561f814bc594d1f277236';
      const universeResult = DatasetSnapshotDomain.buildUniverse(dummyUniverse as any);

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
        creationRequestHash: expectedSha256,
        creationIdempotencyKey: 'different'
      };

      queryRepo.findByBusinessKey.mockImplementation((k: string) => {
        if (queryRepo.findByBusinessKey.mock.calls.length > 1) {
          return Promise.resolve(existing);
        }
        return Promise.resolve(null);
      });

      const res = await service.execute(validReq);
      expect(res.outcome).toBe('REPLAYED');
      expect(importBatchQuery.listCompletedThrough).toHaveBeenCalledTimes(1);
      expect(clock.now).toHaveBeenCalledTimes(2); // once at cutoff, once at persistence
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

    it('collision without idempotency row and no business-key row throws IntegrityError', async () => {
      getSourceVersion.execute.mockResolvedValue(dummySourceVersion);
      queryRepo.findByCreationIdempotencyKey.mockResolvedValue(null);
      clock.now.mockReturnValue(new Date());
      importBatchQuery.listCompletedThrough.mockResolvedValue([]);

      writeRepo.createSealed.mockRejectedValue(new DatasetSnapshotUniqueCollisionError());
      queryRepo.findByBusinessKey.mockResolvedValue(null);

      await expect(service.execute(validReq)).rejects.toThrow(MarketDataIntegrityError);
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

  describe('L. DETERMINISTIC ENTRY ORDER', () => {
    it('deterministic ordering logic', async () => {
      getSourceVersion.execute.mockResolvedValue(dummySourceVersion);
      queryRepo.findByCreationIdempotencyKey.mockResolvedValue(null);
      const now = new Date();
      clock.now.mockReturnValue(now);
      importBatchQuery.listCompletedThrough.mockResolvedValue([
        { id: 'b1', sourceVersionId: 'sv-1', batchBusinessKey: '1234567890123456789012345678901234567890123456789012345678901234', sourceContentHash: '1234567890123456789012345678901234567890123456789012345678901234', status: 'COMPLETED', completedAt: now }
      ]);
      const baseBar = { id: 'b-1', sourceVersionId: 'sv-1', importBatchId: 'b1', marketDate: '2023-05-05', correctionVersion: 0, canonicalHash: '1234567890123456789012345678901234567890123456789012345678901234', qualityDecision: 'ACCEPTED', instrumentId: 'i-1', sourceRecordKey: 'rk-1' };
      const candA = { bar: { ...baseBar, id: 'a' }, instrumentBusinessKey: 'VN|HOSE|AAA|EQUITY|2023-05-05' };
      const candB = { bar: { ...baseBar, id: 'b' }, instrumentBusinessKey: 'VN|HOSE|BBB|EQUITY|2023-05-05' };
      const candC = { bar: { ...baseBar, id: 'c', marketDate: '2023-05-06' }, instrumentBusinessKey: 'VN|HOSE|AAA|EQUITY|2023-05-06' };

      dailyBarQuery.listCandidates.mockResolvedValue([candB, candC, candA]);

      let expectedEntries: any[] = [];
      writeRepo.createSealed.mockImplementation(async (cmd: any) => {
        expectedEntries = cmd.entries;
        return { ...cmd.draft, status: 'SEALED', sealedAt: cmd.sealedAt, dataCutoffAt: cmd.draft.dataCutoffAt };
      });
      await service.execute(validReq);

      expect(expectedEntries.length).toBe(3);
      expect(expectedEntries[0].instrumentBusinessKey).toBe('VN|HOSE|AAA|EQUITY|2023-05-05');
      expect(expectedEntries[1].instrumentBusinessKey).toBe('VN|HOSE|AAA|EQUITY|2023-05-06');
      expect(expectedEntries[2].instrumentBusinessKey).toBe('VN|HOSE|BBB|EQUITY|2023-05-05');
      expect(expectedEntries[0].entrySequence).toBe(1);
      expect(expectedEntries[1].entrySequence).toBe(2);
      expect(expectedEntries[2].entrySequence).toBe(3);
    });
  });
});
