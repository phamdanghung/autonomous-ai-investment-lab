import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma, MarketImportMode, MarketBarKind, MarketQualityDecision, MarketImportStatus } from '@prisma/client';
import { PrismaDatasetSnapshotRepository } from '../../../src/infrastructure/repositories/market-data/PrismaDatasetSnapshotRepository';
import {
  CreateDatasetSnapshotDraftCommand,
  CreateDatasetSnapshotEntryCommand,
  DatasetSnapshotUniqueCollisionError,
  CreateSealedDatasetSnapshotCommand
} from '../../../src/application/ports/market-data/DatasetSnapshotPorts';
import {
  MarketDataIntegrityError,
  MarketDataConcurrencyConflictError
} from '../../../src/domain/market-data/MarketDataErrors';
import { setupIsolatedTestSchema, IsolatedTestSchema } from '../../utils/database';

describe('PrismaDatasetSnapshotRepository Integration', () => {
  let prisma: PrismaClient;
  let repo: PrismaDatasetSnapshotRepository;
  let isolatedSchema: IsolatedTestSchema;

  const validSourceVersionId = 'test-source-version';
  const testDateStr = '2023-01-01';
  const testDateObj = new Date('2023-01-01T00:00:00.000Z');

  beforeAll(async () => {
    isolatedSchema = await setupIsolatedTestSchema('ds_repo');
    prisma = new PrismaClient({ datasourceUrl: isolatedSchema.databaseUrl });
    await prisma.$connect();
    repo = new PrismaDatasetSnapshotRepository(prisma);

    // Seed required initial data
    await prisma.marketDataSourceVersion.create({
      data: {
        id: validSourceVersionId,
        sourceKey: `sk-${Date.now()}-1`,
        contractHash: `ch-${Date.now()}-1`,
        providerCode: 'TEST',
        datasetKind: 'EOD_MARKET_DATA',
        adapterKind: 'REPOSITORY_CSV_FIXTURE',
        adapterVersion: '1.0',
        schemaVersion: '1.0',
        canonicalizationVersion: '1.0',
        priceUnit: 'VND_PER_SHARE',
        encoding: 'UTF8',
        sealedAt: new Date()
      }
    });

    await prisma.marketDataSourceVersion.create({
      data: {
        id: 'other-source-version',
        sourceKey: `sk-${Date.now()}-2`,
        contractHash: `ch-${Date.now()}-2`,
        providerCode: 'TEST',
        datasetKind: 'EOD_MARKET_DATA',
        adapterKind: 'REPOSITORY_CSV_FIXTURE',
        adapterVersion: '1.0',
        schemaVersion: '1.0',
        canonicalizationVersion: '1.0',
        priceUnit: 'VND_PER_SHARE',
        encoding: 'UTF8',
        sealedAt: new Date()
      }
    });

    await prisma.marketInstrument.createMany({
      data: [
        { id: 'inst-1', businessKey: 'ABC', canonicalSymbol: 'ABC', exchange: 'HOSE', securityType: 'EQUITY', currency: 'VND', effectiveFrom: new Date('2020-01-01'), sealedAt: new Date() },
        { id: 'inst-2', businessKey: 'XYZ', canonicalSymbol: 'XYZ', exchange: 'HOSE', securityType: 'EQUITY', currency: 'VND', effectiveFrom: new Date('2020-01-01'), sealedAt: new Date() }
      ]
    });
    // Seed ImportBatches
    const batches = [
      { id: 'batch-1', status: MarketImportStatus.COMPLETED, completedAt: new Date('2023-01-01T10:00:00.000Z'), sourceVersionId: validSourceVersionId, batchBusinessKey: 'batch1', sourceContentHash: 'hash1', creationIdempotencyKey: 'idem1', sourceObjectKey: 's1', startedAt: new Date(), creationRequestHash: 'crh1', sourceByteSize: 100n, importMode: MarketImportMode.INITIAL },
      { id: 'batch-2', status: MarketImportStatus.COMPLETED, completedAt: new Date('2023-01-01T12:00:00.000Z'), sourceVersionId: validSourceVersionId, batchBusinessKey: 'batch2', sourceContentHash: 'hash2', creationIdempotencyKey: 'idem2', sourceObjectKey: 's2', startedAt: new Date(), creationRequestHash: 'crh2', sourceByteSize: 100n, importMode: MarketImportMode.INITIAL },
      { id: 'batch-3', status: MarketImportStatus.COMPLETED_WITH_QUARANTINE, completedAt: new Date('2023-01-01T11:00:00.000Z'), sourceVersionId: validSourceVersionId, batchBusinessKey: 'batch3', sourceContentHash: 'hash3', creationIdempotencyKey: 'idem3', sourceObjectKey: 's3', startedAt: new Date(), creationRequestHash: 'crh3', sourceByteSize: 100n, importMode: MarketImportMode.INITIAL },
      { id: 'batch-4', status: MarketImportStatus.COMPLETED, completedAt: new Date('2023-01-01T13:00:00.000Z'), sourceVersionId: validSourceVersionId, batchBusinessKey: 'batch4', sourceContentHash: 'hash4', creationIdempotencyKey: 'idem4', sourceObjectKey: 's4', startedAt: new Date(), creationRequestHash: 'crh4', sourceByteSize: 100n, importMode: MarketImportMode.INITIAL },
      { id: 'batch-5', status: MarketImportStatus.PENDING, completedAt: null, sourceVersionId: validSourceVersionId, batchBusinessKey: 'batch5', sourceContentHash: 'hash5', creationIdempotencyKey: 'idem5', sourceObjectKey: 's5', startedAt: new Date(), creationRequestHash: 'crh5', sourceByteSize: 100n, importMode: MarketImportMode.INITIAL },
      { id: 'batch-6', status: MarketImportStatus.FAILED, completedAt: null, failedAt: new Date(), failureCode: 'ERROR', sourceVersionId: validSourceVersionId, batchBusinessKey: 'batch6', sourceContentHash: 'hash6', creationIdempotencyKey: 'idem6', sourceObjectKey: 's6', startedAt: new Date(), creationRequestHash: 'crh6', sourceByteSize: 100n, importMode: MarketImportMode.INITIAL },
      { id: 'batch-other', status: MarketImportStatus.COMPLETED, completedAt: new Date('2023-01-01T09:00:00.000Z'), sourceVersionId: 'other-source-version', batchBusinessKey: 'batchOther', sourceContentHash: 'hashOther', creationIdempotencyKey: 'idemOther', sourceObjectKey: 'sOther', startedAt: new Date(), creationRequestHash: 'crhOther', sourceByteSize: 100n, importMode: MarketImportMode.INITIAL }
    ];
    await prisma.marketDataImportBatch.createMany({ data: batches });

    // Seed DailyMarketBar
    const bars = [
      { id: 'bar-1', sourceVersionId: validSourceVersionId, importBatchId: 'batch-1', sourceRecordKey: 'k1', instrumentId: 'inst-1', marketDate: new Date('2023-01-02T00:00:00.000Z'), barKind: MarketBarKind.TRADED, open: 100n, high: 100n, low: 100n, close: 100n, volume: 0n, correctionVersion: 0, qualityDecision: MarketQualityDecision.ACCEPTED, qualityFlags: '[]', sourceRowHash: 'row1', canonicalHash: 'c1' },
      { id: 'bar-1-v1', sourceVersionId: validSourceVersionId, importBatchId: 'batch-1', sourceRecordKey: 'k2', instrumentId: 'inst-1', marketDate: new Date('2023-01-02T00:00:00.000Z'), barKind: MarketBarKind.TRADED, open: 100n, high: 100n, low: 100n, close: 100n, volume: 0n, correctionVersion: 1, supersedesBarId: 'bar-1', qualityDecision: MarketQualityDecision.ACCEPTED, qualityFlags: '[]', sourceRowHash: 'row2', canonicalHash: 'c1_v1' },
      { id: 'bar-2', sourceVersionId: validSourceVersionId, importBatchId: 'batch-1', sourceRecordKey: 'k3', instrumentId: 'inst-2', marketDate: new Date('2023-01-02T00:00:00.000Z'), barKind: MarketBarKind.TRADED, open: null, high: null, low: null, close: null, volume: 0n, correctionVersion: 0, qualityDecision: MarketQualityDecision.QUARANTINED, qualityFlags: '[]', sourceRowHash: 'row3', canonicalHash: 'c2' },
      { id: 'bar-out-before', sourceVersionId: validSourceVersionId, importBatchId: 'batch-1', sourceRecordKey: 'k4', instrumentId: 'inst-1', marketDate: new Date('2023-01-01T00:00:00.000Z'), barKind: MarketBarKind.TRADED, open: 100n, high: 100n, low: 100n, close: 100n, volume: 0n, correctionVersion: 0, qualityDecision: MarketQualityDecision.ACCEPTED, qualityFlags: '[]', sourceRowHash: 'row4', canonicalHash: 'cx1' },
      { id: 'bar-out-after', sourceVersionId: validSourceVersionId, importBatchId: 'batch-1', sourceRecordKey: 'k5', instrumentId: 'inst-1', marketDate: new Date('2023-01-05T00:00:00.000Z'), barKind: MarketBarKind.TRADED, open: 100n, high: 100n, low: 100n, close: 100n, volume: 0n, correctionVersion: 0, qualityDecision: MarketQualityDecision.ACCEPTED, qualityFlags: '[]', sourceRowHash: 'row5', canonicalHash: 'cx2' },
      { id: 'bar-3', sourceVersionId: validSourceVersionId, importBatchId: 'batch-2', sourceRecordKey: 'k6', instrumentId: 'inst-1', marketDate: new Date('2023-01-03T00:00:00.000Z'), barKind: MarketBarKind.TRADED, open: 100n, high: 100n, low: 100n, close: 100n, volume: 0n, correctionVersion: 0, qualityDecision: MarketQualityDecision.ACCEPTED, qualityFlags: '[]', sourceRowHash: 'row6', canonicalHash: 'c3' },
      { id: 'bar-nonreq', sourceVersionId: validSourceVersionId, importBatchId: 'batch-3', sourceRecordKey: 'k7', instrumentId: 'inst-1', marketDate: new Date('2023-01-04T00:00:00.000Z'), barKind: MarketBarKind.TRADED, open: 100n, high: 100n, low: 100n, close: 100n, volume: 0n, correctionVersion: 0, qualityDecision: MarketQualityDecision.ACCEPTED, qualityFlags: '[]', sourceRowHash: 'row7', canonicalHash: 'cx3' },
      { id: 'bar-other-sv', sourceVersionId: 'other-source-version', importBatchId: 'batch-other', sourceRecordKey: 'k8', instrumentId: 'inst-1', marketDate: new Date('2023-01-02T00:00:00.000Z'), barKind: MarketBarKind.TRADED, open: 100n, high: 100n, low: 100n, close: 100n, volume: 0n, correctionVersion: 0, qualityDecision: MarketQualityDecision.ACCEPTED, qualityFlags: '[]', sourceRowHash: 'row8', canonicalHash: 'cx4' }
    ];
    await prisma.dailyMarketBar.createMany({ data: bars });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    if (isolatedSchema) {
      await isolatedSchema.teardown();
    }
  });

  describe('Import Cutoff Query', () => {
    it('returns exact completed batches within cutoff', async () => {
      const cutoff = new Date('2023-01-01T12:00:00.000Z');
      const results = await repo.listCompletedThrough(validSourceVersionId, cutoff);

      expect(results).toHaveLength(3);
      const keys = results.map(r => r.batchBusinessKey).sort();
      expect(keys).toEqual(['batch1', 'batch2', 'batch3']); // Only these 3

      // Verify exact fields returned
      const b1 = results.find(r => r.batchBusinessKey === 'batch1');
      expect(b1).toBeDefined();
      expect(b1?.id).toBe('batch-1');
      expect(b1?.sourceVersionId).toBe(validSourceVersionId);
      expect(b1?.sourceContentHash).toBe('hash1');
      expect(b1?.status).toBe('COMPLETED');
      expect(b1?.completedAt).toEqual(new Date('2023-01-01T10:00:00.000Z'));
      
      // createdAt and other DB-only fields should not be exposed (verified by TS interface)
      expect(Object.keys(b1 || {})).not.toContain('createdAt');
      expect(Object.keys(b1 || {})).not.toContain('storageKey');
    });
  });

  describe('Daily Bar Candidate Query', () => {
    it('returns empty array if importBatchIds is empty', async () => {
      const results = await repo.listCandidates({
        sourceVersionId: validSourceVersionId,
        rangeStart: '2023-01-02',
        rangeEnd: '2023-01-04',
        importBatchIds: []
      });
      expect(results).toEqual([]);
    });

    it('returns correct candidates including QUARANTINED and uncollapsed versions', async () => {
      const results = await repo.listCandidates({
        sourceVersionId: validSourceVersionId,
        rangeStart: '2023-01-02',
        rangeEnd: '2023-01-04',
        importBatchIds: ['batch-1', 'batch-2']
      });

      expect(results).toHaveLength(4);
      const ids = results.map(r => r.bar.id).sort();
      expect(ids).toEqual(['bar-1', 'bar-1-v1', 'bar-2', 'bar-3'].sort());

      // Verify relation mapping
      const bar2 = results.find(r => r.bar.id === 'bar-2');
      expect(bar2?.instrumentBusinessKey).toBe('XYZ');
      expect(bar2?.bar.qualityDecision).toBe('QUARANTINED');

      const bar1 = results.find(r => r.bar.id === 'bar-1');
      const bar1v1 = results.find(r => r.bar.id === 'bar-1-v1');
      expect(bar1?.instrumentBusinessKey).toBe('ABC');
      expect(bar1v1?.instrumentBusinessKey).toBe('ABC');
      
      // Order checking (by instrumentBusinessKey/id, marketDate, correctionVersion is DB order but let's check it's stable)
      // We requested instrumentId asc, marketDate asc, correctionVersion asc
    });
  });

  describe('Write and Query DatasetSnapshot', () => {
    let createdSnapshotId: string;
    
    it('creates zero-row SEALED snapshot successfully', async () => {
      const draft: CreateDatasetSnapshotDraftCommand = {
        businessKey: 'biz-key-0',
        sourceVersionId: validSourceVersionId,
        rangeStart: '2023-01-01',
        rangeEnd: '2023-01-31',
        universeDefinitionJson: '{}',
        universeHash: 'uhash',
        dataCutoffKey: 'dckey',
        dataCutoffAt: testDateObj,
        canonicalizationVersion: '1.0',
        rowCount: 0,
        manifestHash: 'mhash',
        contentHash: 'chash',
        status: 'DRAFT',
        creationIdempotencyKey: 'idem-0',
        creationRequestHash: 'crh'
      };

      const result = await repo.createSealed({ draft, entries: [], sealedAt: testDateObj });

      expect(result.status).toBe('SEALED');
      expect(result.rowCount).toBe(0);
      expect(result.sealedAt).toEqual(testDateObj);

      // Verify createdAt is NOT exposed in the mapped result
      expect((result as any).createdAt).toBeUndefined();

      // Check DB directly
      const dbRow = await prisma.datasetSnapshot.findUnique({ where: { id: result.id } });
      expect(dbRow?.status).toBe('SEALED');
      
      const dbEntries = await prisma.datasetSnapshotEntry.count({ where: { snapshotId: result.id } });
      expect(dbEntries).toBe(0);
    });

    it('creates multi-row SEALED snapshot successfully', async () => {
      const draft: CreateDatasetSnapshotDraftCommand = {
        businessKey: 'biz-key-multi',
        sourceVersionId: validSourceVersionId,
        rangeStart: '2023-01-01',
        rangeEnd: '2023-01-31',
        universeDefinitionJson: '{}',
        universeHash: 'uhash',
        dataCutoffKey: 'dckey',
        dataCutoffAt: testDateObj,
        canonicalizationVersion: '1.0',
        rowCount: 2,
        manifestHash: 'mhash',
        contentHash: 'chash',
        status: 'DRAFT',
        creationIdempotencyKey: 'idem-multi',
        creationRequestHash: 'crh'
      };

      const entries: CreateDatasetSnapshotEntryCommand[] = [
        { dailyBarId: 'bar-1', entrySequence: 1, instrumentBusinessKey: 'ABC', marketDate: '2023-01-02', barCanonicalHash: 'c1', entryHash: 'e1' },
        { dailyBarId: 'bar-3', entrySequence: 2, instrumentBusinessKey: 'ABC', marketDate: '2023-01-03', barCanonicalHash: 'c3', entryHash: 'e2' }
      ];

      const result = await repo.createSealed({ draft, entries, sealedAt: testDateObj });
      createdSnapshotId = result.id;

      expect(result.status).toBe('SEALED');
      expect(result.rowCount).toBe(2);

      // Verify Date roundtrips
      expect(result.rangeStart).toBe('2023-01-01');
      expect(result.rangeEnd).toBe('2023-01-31');
      
      const dbEntries = await prisma.datasetSnapshotEntry.findMany({ where: { snapshotId: result.id }, orderBy: { entrySequence: 'asc' } });
      expect(dbEntries).toHaveLength(2);
      expect(dbEntries[0].entrySequence).toBe(1);
      expect(dbEntries[0].dailyBarId).toBe('bar-1');
      expect(dbEntries[0].instrumentBusinessKey).toBe('ABC');
    });

    it('finds by businessKey', async () => {
      const result = await repo.findByBusinessKey('biz-key-multi');
      expect(result).not.toBeNull();
      expect(result?.id).toBe(createdSnapshotId);
    });

    it('finds by creationIdempotencyKey', async () => {
      const result = await repo.findByCreationIdempotencyKey('idem-multi');
      expect(result).not.toBeNull();
      expect(result?.id).toBe(createdSnapshotId);
    });

    it('returns null for missing keys', async () => {
      const result1 = await repo.findByBusinessKey('missing');
      expect(result1).toBeNull();
      const result2 = await repo.findByCreationIdempotencyKey('missing');
      expect(result2).toBeNull();
    });

    it('enforces rowCount command guard', async () => {
      const draft: CreateDatasetSnapshotDraftCommand = {
        businessKey: 'biz-guard', sourceVersionId: validSourceVersionId, rangeStart: '2023-01-01', rangeEnd: '2023-01-31', universeDefinitionJson: '{}', universeHash: 'uhash', dataCutoffKey: 'dckey', dataCutoffAt: testDateObj, canonicalizationVersion: '1.0', rowCount: 1, manifestHash: 'mhash', contentHash: 'chash', status: 'DRAFT', creationIdempotencyKey: 'idem-guard', creationRequestHash: 'crh'
      };
      
      await expect(repo.createSealed({ draft, entries: [], sealedAt: testDateObj }))
        .rejects
        .toThrow(new MarketDataIntegrityError('Dataset snapshot persistence command row count does not match entries.'));

      const count = await prisma.datasetSnapshot.count({ where: { businessKey: 'biz-guard' } });
      expect(count).toBe(0);
    });
  });

  describe('Error Mapping and Rollbacks', () => {
    it('throws DatasetSnapshotUniqueCollisionError on duplicate businessKey', async () => {
      const draft: CreateDatasetSnapshotDraftCommand = {
        businessKey: 'biz-key-multi', // Already exists
        sourceVersionId: validSourceVersionId, rangeStart: '2023-01-01', rangeEnd: '2023-01-31', universeDefinitionJson: '{}', universeHash: 'uhash', dataCutoffKey: 'dckey', dataCutoffAt: testDateObj, canonicalizationVersion: '1.0', rowCount: 0, manifestHash: 'mhash', contentHash: 'chash', status: 'DRAFT', creationIdempotencyKey: 'idem-new', creationRequestHash: 'crh'
      };

      const p = repo.createSealed({ draft, entries: [], sealedAt: testDateObj });
      await expect(p).rejects.toThrow(DatasetSnapshotUniqueCollisionError);
      
      try { await p; } catch (e: any) {
        expect(e.message).toBe('Dataset snapshot unique collision.');
        expect(e.message).not.toContain('Prisma');
      }
    });

    it('throws DatasetSnapshotUniqueCollisionError on duplicate idempotencyKey', async () => {
      const draft: CreateDatasetSnapshotDraftCommand = {
        businessKey: 'biz-new', sourceVersionId: validSourceVersionId, rangeStart: '2023-01-01', rangeEnd: '2023-01-31', universeDefinitionJson: '{}', universeHash: 'uhash', dataCutoffKey: 'dckey', dataCutoffAt: testDateObj, canonicalizationVersion: '1.0', rowCount: 0, manifestHash: 'mhash', contentHash: 'chash', status: 'DRAFT', creationIdempotencyKey: 'idem-multi', // Already exists
        creationRequestHash: 'crh'
      };

      await expect(repo.createSealed({ draft, entries: [], sealedAt: testDateObj }))
        .rejects.toThrow(DatasetSnapshotUniqueCollisionError);
    });

    it('throws MarketDataIntegrityError and rolls back on duplicate entry sequence', async () => {
      const draft: CreateDatasetSnapshotDraftCommand = {
        businessKey: 'biz-dup-entry', sourceVersionId: validSourceVersionId, rangeStart: '2023-01-01', rangeEnd: '2023-01-31', universeDefinitionJson: '{}', universeHash: 'uhash', dataCutoffKey: 'dckey', dataCutoffAt: testDateObj, canonicalizationVersion: '1.0', rowCount: 2, manifestHash: 'mhash', contentHash: 'chash', status: 'DRAFT', creationIdempotencyKey: 'idem-dup-entry', creationRequestHash: 'crh'
      };

      const entries: CreateDatasetSnapshotEntryCommand[] = [
        { dailyBarId: 'bar-1', entrySequence: 1, instrumentBusinessKey: 'ABC', marketDate: '2023-01-02', barCanonicalHash: 'c1', entryHash: 'e1' },
        { dailyBarId: 'bar-3', entrySequence: 1, instrumentBusinessKey: 'ABC', marketDate: '2023-01-03', barCanonicalHash: 'c3', entryHash: 'e2' } // Duplicate sequence!
      ];

      const p = repo.createSealed({ draft, entries, sealedAt: testDateObj });
      await expect(p).rejects.toThrow(new MarketDataIntegrityError('Dataset snapshot entry violates persistence uniqueness.'));

      try { await p; } catch (e: any) {
        expect(e.message).not.toContain('Prisma');
      }

      // Verify rollback
      const count = await prisma.datasetSnapshot.count({ where: { businessKey: 'biz-dup-entry' } });
      expect(count).toBe(0);
    });

    it('throws MarketDataIntegrityError and rolls back on invalid dailyBarId FK', async () => {
      const draft: CreateDatasetSnapshotDraftCommand = {
        businessKey: 'biz-fk', sourceVersionId: validSourceVersionId, rangeStart: '2023-01-01', rangeEnd: '2023-01-31', universeDefinitionJson: '{}', universeHash: 'uhash', dataCutoffKey: 'dckey', dataCutoffAt: testDateObj, canonicalizationVersion: '1.0', rowCount: 1, manifestHash: 'mhash', contentHash: 'chash', status: 'DRAFT', creationIdempotencyKey: 'idem-fk', creationRequestHash: 'crh'
      };

      const entries: CreateDatasetSnapshotEntryCommand[] = [
        { dailyBarId: 'invalid-bar', entrySequence: 1, instrumentBusinessKey: 'ABC', marketDate: '2023-01-02', barCanonicalHash: 'c1', entryHash: 'e1' }
      ];

      const p = repo.createSealed({ draft, entries, sealedAt: testDateObj });
      await expect(p).rejects.toThrow(new MarketDataIntegrityError('Dataset snapshot references missing persistence identity.'));

      try { await p; } catch (e: any) {
        expect(e.message).not.toContain('Prisma');
      }

      // Verify rollback
      const count = await prisma.datasetSnapshot.count({ where: { businessKey: 'biz-fk' } });
      expect(count).toBe(0);
    });

    it('throws MarketDataIntegrityError on invalid SourceVersion FK', async () => {
      const draft: CreateDatasetSnapshotDraftCommand = {
        businessKey: 'biz-sv-fk', sourceVersionId: 'missing-sv', rangeStart: '2023-01-01', rangeEnd: '2023-01-31', universeDefinitionJson: '{}', universeHash: 'uhash', dataCutoffKey: 'dckey', dataCutoffAt: testDateObj, canonicalizationVersion: '1.0', rowCount: 0, manifestHash: 'mhash', contentHash: 'chash', status: 'DRAFT', creationIdempotencyKey: 'idem-sv-fk', creationRequestHash: 'crh'
      };

      await expect(repo.createSealed({ draft, entries: [], sealedAt: testDateObj }))
        .rejects.toThrow(new MarketDataIntegrityError('Dataset snapshot references missing persistence identity.'));

      const count = await prisma.datasetSnapshot.count({ where: { businessKey: 'biz-sv-fk' } });
      expect(count).toBe(0);
    });
  });

  describe('Error Mapper Tests (Synthetic)', () => {
    it('maps P2034 to MarketDataConcurrencyConflictError', async () => {
      // Simulate P2034 using private handlePrismaError method for coverage
      const p2034Error = new Prisma.PrismaClientKnownRequestError('conflict', { code: 'P2034', clientVersion: '1' });
      expect(() => (repo as any).handlePrismaError(p2034Error)).toThrow(MarketDataConcurrencyConflictError);
    });

    it('maps PrismaClientUnknownRequestError to MarketDataIntegrityError', async () => {
      const unknownErr = new Prisma.PrismaClientUnknownRequestError('unknown', { clientVersion: '1' });
      expect(() => (repo as any).handlePrismaError(unknownErr)).toThrow(new MarketDataIntegrityError('Database integrity error.'));
    });

    it('rethrows unrelated Errors exactly', async () => {
      const plainError = new Error('Random error');
      try {
        (repo as any).handlePrismaError(plainError);
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBe(plainError); // exact object identity
      }
    });
  });
});
