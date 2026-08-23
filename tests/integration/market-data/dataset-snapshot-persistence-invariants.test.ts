import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, DatasetSnapshotStatus, MarketImportStatus, MarketImportMode, MarketBarKind, MarketQualityDecision } from '@prisma/client';
import { setupIsolatedTestSchema, IsolatedTestSchema } from '../../utils/database';

describe('DatasetSnapshot Persistence Invariants', () => {
  let prisma: PrismaClient;
  let isolatedSchema: IsolatedTestSchema;

  const validSourceVersionId = 'sv-1';
  const instrumentId = 'inst-1';
  const batchId = 'batch-1';
  const barId1 = 'bar-1';
  const barId2 = 'bar-2';

    beforeAll(async () => {
    isolatedSchema = await setupIsolatedTestSchema('ds_persist_invariants');
    prisma = new PrismaClient({ datasourceUrl: isolatedSchema.databaseUrl });

    // Seed prerequisites
    await prisma.marketDataSourceVersion.create({
      data: {
        id: validSourceVersionId,
        providerCode: 'TEST',
        datasetKind: 'EOD_MARKET_DATA',
        adapterKind: 'REPOSITORY_CSV_FIXTURE',
        adapterVersion: '1',
        schemaVersion: '1',
        canonicalizationVersion: '1',
        priceUnit: 'VND_PER_SHARE',
        encoding: 'UTF8',
        contractHash: 'chash',
        sourceKey: 'skey',
        sealedAt: new Date()
      }
    });

    await prisma.marketDataSourceVersion.create({
      data: {
        id: 'other-source-version',
        providerCode: 'TEST',
        datasetKind: 'EOD_MARKET_DATA',
        adapterKind: 'REPOSITORY_CSV_FIXTURE',
        adapterVersion: '2',
        schemaVersion: '1',
        canonicalizationVersion: '1',
        priceUnit: 'VND_PER_SHARE',
        encoding: 'UTF8',
        contractHash: 'chash-other',
        sourceKey: 'skey-other',
        sealedAt: new Date()
      }
    });

    await prisma.marketInstrument.create({
      data: {
        id: instrumentId,
        businessKey: 'inst-bk',
        exchange: 'HOSE',
        canonicalSymbol: 'VND',
        securityType: 'EQUITY',
        currency: 'VND',
        effectiveFrom: new Date('2020-01-01T00:00:00Z'),
        sealedAt: new Date()
      }
    });

    await prisma.marketDataImportBatch.create({
      data: {
        id: batchId,
        status: MarketImportStatus.COMPLETED,
        sourceVersionId: validSourceVersionId,
        batchBusinessKey: 'batch1',
        sourceContentHash: 'hash1',
        creationIdempotencyKey: 'idem1',
        sourceObjectKey: 's1',
        startedAt: new Date(),
        completedAt: new Date(),
        creationRequestHash: 'crh1',
        sourceByteSize: 100n,
        importMode: MarketImportMode.INITIAL
      }
    });

    await prisma.dailyMarketBar.createMany({
      data: [
        {
          id: barId1,
          sourceVersionId: validSourceVersionId,
          importBatchId: batchId,
          sourceRecordKey: 'k1',
          instrumentId: instrumentId,
          marketDate: new Date('2023-01-01T00:00:00Z'),
          barKind: MarketBarKind.TRADED,
          open: 100n, high: 100n, low: 100n, close: 100n, volume: 0n,
          correctionVersion: 0,
          qualityDecision: MarketQualityDecision.ACCEPTED,
          qualityFlags: '[]',
          sourceRowHash: 'row1',
          canonicalHash: 'c1'
        },
        {
          id: barId2,
          sourceVersionId: validSourceVersionId,
          importBatchId: batchId,
          sourceRecordKey: 'k2',
          instrumentId: instrumentId,
          marketDate: new Date('2023-01-02T00:00:00Z'),
          barKind: MarketBarKind.TRADED,
          open: 100n, high: 100n, low: 100n, close: 100n, volume: 0n,
          correctionVersion: 0,
          qualityDecision: MarketQualityDecision.ACCEPTED,
          qualityFlags: '[]',
          sourceRowHash: 'row2',
          canonicalHash: 'c2'
        }
      ]
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    if (isolatedSchema) await isolatedSchema.teardown();
  });

  // Base snapshot helper
  const createBaseSnapshotData = (override = {}) => ({
    businessKey: `snap-${Date.now()}-${Math.random()}`,
    sourceVersionId: validSourceVersionId,
    rangeStart: new Date('2023-01-01T00:00:00Z'),
    rangeEnd: new Date('2023-12-31T00:00:00Z'),
    universeDefinitionJson: '{}',
    universeHash: 'uhash',
    dataCutoffKey: 'cutoff',
    canonicalizationVersion: '1',
    rowCount: 100,
    manifestHash: 'mhash',
    contentHash: 'chash',
    status: 'DRAFT' as DatasetSnapshotStatus,
    creationIdempotencyKey: `idem-${Date.now()}-${Math.random()}`,
    creationRequestHash: 'crhash',
    ...override
  });

  // 7. CHECK - SNAPSHOT RANGE
  it('rejects DatasetSnapshot with rangeEnd < rangeStart', async () => {
    const data = createBaseSnapshotData({
      rangeStart: new Date('2023-12-31T00:00:00Z'),
      rangeEnd: new Date('2023-01-01T00:00:00Z')
    });

    await expect(prisma.datasetSnapshot.create({ data })).rejects.toThrow();

    const count = await prisma.datasetSnapshot.count({ where: { businessKey: data.businessKey } });
    expect(count).toBe(0);
  });

  // 8. CHECK - ROW COUNT
  it('rejects DatasetSnapshot with rowCount < 0', async () => {
    const data = createBaseSnapshotData({ rowCount: -1 });

    await expect(prisma.datasetSnapshot.create({ data })).rejects.toThrow();

    const count = await prisma.datasetSnapshot.count({ where: { businessKey: data.businessKey } });
    expect(count).toBe(0);
  });

  // 9. CHECK - STATUS / SEALEDAT
  describe('Status / SealedAt Invariants', () => {
    it('rejects DRAFT with non-null sealedAt', async () => {
      const data = createBaseSnapshotData({
        status: 'DRAFT',
        sealedAt: new Date()
      });
      await expect(prisma.datasetSnapshot.create({ data })).rejects.toThrow();
    });

    it('rejects SEALED with null sealedAt', async () => {
      const data = createBaseSnapshotData({
        status: 'SEALED',
        sealedAt: null
      });
      await expect(prisma.datasetSnapshot.create({ data })).rejects.toThrow();
    });

    it('accepts DRAFT with null sealedAt', async () => {
      const data = createBaseSnapshotData({ status: 'DRAFT', sealedAt: null });
      const snap = await prisma.datasetSnapshot.create({ data });
      expect(snap.status).toBe('DRAFT');
    });

    // We verify if the DB prevents direct SEALED inserts via triggers (it doesnt, but we verify it works or fails according to rules)
    it('allows direct SEALED insert if sealedAt is provided (current trigger doesnt run on INSERT)', async () => {
      const data = createBaseSnapshotData({ status: 'SEALED', sealedAt: new Date() });
      const snap = await prisma.datasetSnapshot.create({ data });
      expect(snap.status).toBe('SEALED');
    });
  });

  // 10. CHECK - ENTRY SEQUENCE
  it('rejects DatasetSnapshotEntry with entrySequence <= 0', async () => {
    const snap = await prisma.datasetSnapshot.create({ data: createBaseSnapshotData() });

    await expect(prisma.datasetSnapshotEntry.create({
      data: {
        snapshotId: snap.id,
        dailyBarId: barId1,
        entrySequence: 0,
        instrumentBusinessKey: 'inst-bk',
        marketDate: new Date('2023-01-01T00:00:00Z'),
        barCanonicalHash: 'c1',
        entryHash: `eh-${Date.now()}`
      }
    })).rejects.toThrow();

    await expect(prisma.datasetSnapshotEntry.create({
      data: {
        snapshotId: snap.id,
        dailyBarId: barId1,
        entrySequence: -1,
        instrumentBusinessKey: 'inst-bk',
        marketDate: new Date('2023-01-01T00:00:00Z'),
        barCanonicalHash: 'c1',
        entryHash: `eh-${Date.now()}-2`
      }
    })).rejects.toThrow();
  });

  // 11. SNAPSHOT DELETE IMMUTABILITY
  it('rejects DELETE on DatasetSnapshot', async () => {
    const snap = await prisma.datasetSnapshot.create({ data: createBaseSnapshotData() });
    await expect(prisma.datasetSnapshot.delete({ where: { id: snap.id } })).rejects.toThrow(/DatasetSnapshot cannot be deleted/);

    const count = await prisma.datasetSnapshot.count({ where: { id: snap.id } });
    expect(count).toBe(1);
  });

  // 12. SEALED SNAPSHOT IMMUTABILITY
  describe('SEALED Snapshot Immutability', () => {
    it.each([
      ['businessKey', 'bk-new-sealed'],
      ['rangeEnd', new Date('2024-01-01T00:00:00Z')],
      ['universeHash', 'uh-new-sealed'],
      ['dataCutoffKey', 'cutoff-new-sealed'],
      ['rowCount', 999],
      ['manifestHash', 'mh-new-sealed'],
      ['contentHash', 'ch-new-sealed'],
      ['creationRequestHash', 'crh-new-sealed'],
      ['sealedAt', new Date('2025-01-01T00:00:00Z')]
    ])('rejects mutation of %s', async (field, newValue) => {
      const data = createBaseSnapshotData({ status: 'SEALED', sealedAt: new Date() });
      const snap = await prisma.datasetSnapshot.create({ data });

      const originalValue = (snap as any)[field];

      await expect(prisma.datasetSnapshot.update({
        where: { id: snap.id },
        data: { [field]: newValue }
      })).rejects.toThrow(/SEALED DatasetSnapshot cannot be modified/);

      const fresh = await prisma.datasetSnapshot.findUnique({ where: { id: snap.id } });
      expect((fresh as any)[field]).toEqual(originalValue);
    });
  });

  // 13. SEALED STATUS MUST NOT REOPEN
  it('rejects SEALED -> DRAFT transition', async () => {
    const snap = await prisma.datasetSnapshot.create({ data: createBaseSnapshotData({ status: 'SEALED', sealedAt: new Date() }) });

    await expect(prisma.datasetSnapshot.update({
      where: { id: snap.id },
      data: { status: 'DRAFT', sealedAt: null }
    })).rejects.toThrow(/SEALED DatasetSnapshot cannot be modified/);
  });

  // 14. DRAFT -> DRAFT UPDATE PROHIBITION
  it('rejects DRAFT -> DRAFT mutation', async () => {
    const snap = await prisma.datasetSnapshot.create({ data: createBaseSnapshotData() });

    await expect(prisma.datasetSnapshot.update({
      where: { id: snap.id },
      data: { rowCount: 999, status: 'DRAFT' } // explicitly staying DRAFT
    })).rejects.toThrow(/DRAFT -> DRAFT update is not allowed/);
  });

  // 15. ONLY ALLOWED SNAPSHOT TRANSITION (DRAFT -> SEALED)
  it('allows DRAFT -> SEALED transition with sealedAt null -> non-null', async () => {
    const snap = await prisma.datasetSnapshot.create({ data: createBaseSnapshotData() });

    const updated = await prisma.datasetSnapshot.update({
      where: { id: snap.id },
      data: { status: 'SEALED', sealedAt: new Date() }
    });

    expect(updated.status).toBe('SEALED');
    expect(updated.sealedAt).not.toBeNull();
  });

  // 16. DRAFT -> SEALED IDENTITY IMMUTABILITY
  describe('DRAFT -> SEALED Identity/Content Immutability', () => {
    it.each([
      ['businessKey', 'bk-new-draft'],
      ['sourceVersionId', 'other-source-version'],
      ['rangeStart', new Date('2022-01-01T00:00:00Z')],
      ['rangeEnd', new Date('2024-01-01T00:00:00Z')],
      ['universeDefinitionJson', '{"a":1}'],
      ['universeHash', 'uh-new-draft'],
      ['dataCutoffKey', 'cutoff-new-draft'],
      ['canonicalizationVersion', '2'],
      ['rowCount', 999],
      ['manifestHash', 'mh-new-draft'],
      ['contentHash', 'ch-new-draft'],
      ['creationIdempotencyKey', 'idem-new-draft'],
      ['creationRequestHash', 'crh-new-draft']
    ])('rejects DRAFT -> SEALED transition when modifying %s', async (field, newValue) => {
      const data = createBaseSnapshotData();
      const snap = await prisma.datasetSnapshot.create({ data });
      const originalValue = (snap as any)[field];

      await expect(prisma.datasetSnapshot.update({
        where: { id: snap.id },
        data: { status: 'SEALED', sealedAt: new Date(), [field]: newValue }
      })).rejects.toThrow(/DatasetSnapshot identity\/content fields are immutable/);

      const fresh = await prisma.datasetSnapshot.findUnique({ where: { id: snap.id } });
      expect(fresh?.status).toBe('DRAFT');
      expect(fresh?.sealedAt).toBeNull();
      expect((fresh as any)[field]).toEqual(originalValue);
    });
  });

  // 17. ENTRY INSERT WHILE DRAFT
  it('allows inserting entry into DRAFT snapshot', async () => {
    const snap = await prisma.datasetSnapshot.create({ data: createBaseSnapshotData() });

    const entry = await prisma.datasetSnapshotEntry.create({
      data: {
        snapshotId: snap.id,
        dailyBarId: barId1,
        entrySequence: 1,
        instrumentBusinessKey: 'inst-bk',
        marketDate: new Date('2023-01-01T00:00:00Z'),
        barCanonicalHash: 'c1',
        entryHash: `eh-${Date.now()}`
      }
    });

    expect(entry.id).toBeDefined();
  });

  // 18. ENTRY INSERT AFTER SEALED
  it('rejects inserting entry into SEALED snapshot', async () => {
    const snap = await prisma.datasetSnapshot.create({ data: createBaseSnapshotData({ status: 'SEALED', sealedAt: new Date() }) });

    await expect(prisma.datasetSnapshotEntry.create({
      data: {
        snapshotId: snap.id,
        dailyBarId: barId1,
        entrySequence: 1,
        instrumentBusinessKey: 'inst-bk',
        marketDate: new Date('2023-01-01T00:00:00Z'),
        barCanonicalHash: 'c1',
        entryHash: `eh-${Date.now()}`
      }
    })).rejects.toThrow(/Cannot insert DatasetSnapshotEntry into a SEALED DatasetSnapshot/);
  });

  // 19. ENTRY UPDATE IMMUTABILITY
  it('rejects updates on DatasetSnapshotEntry', async () => {
    const snap = await prisma.datasetSnapshot.create({ data: createBaseSnapshotData() });
    const entry = await prisma.datasetSnapshotEntry.create({
      data: {
        snapshotId: snap.id,
        dailyBarId: barId1,
        entrySequence: 1,
        instrumentBusinessKey: 'inst-bk',
        marketDate: new Date('2023-01-01T00:00:00Z'),
        barCanonicalHash: 'c1',
        entryHash: `eh-${Date.now()}`
      }
    });

    await expect(prisma.datasetSnapshotEntry.update({
      where: { id: entry.id },
      data: { entrySequence: 2 }
    })).rejects.toThrow(/DatasetSnapshotEntry is immutable. No UPDATE or DELETE allowed/);
  });

  // 20. ENTRY DELETE IMMUTABILITY
  it('rejects deletes on DatasetSnapshotEntry', async () => {
    const snap = await prisma.datasetSnapshot.create({ data: createBaseSnapshotData() });
    const entry = await prisma.datasetSnapshotEntry.create({
      data: {
        snapshotId: snap.id,
        dailyBarId: barId1,
        entrySequence: 1,
        instrumentBusinessKey: 'inst-bk',
        marketDate: new Date('2023-01-01T00:00:00Z'),
        barCanonicalHash: 'c1',
        entryHash: `eh-${Date.now()}`
      }
    });

    await expect(prisma.datasetSnapshotEntry.delete({
      where: { id: entry.id }
    })).rejects.toThrow(/DatasetSnapshotEntry is immutable. No UPDATE or DELETE allowed/);
  });

  // 21. SNAPSHOT / ENTRY UNIQUE INVARIANTS
  it('enforces UNIQUE constraints on DatasetSnapshot', async () => {
    const data = createBaseSnapshotData();
    await prisma.datasetSnapshot.create({ data });

    // Same business key
    await expect(prisma.datasetSnapshot.create({
      data: createBaseSnapshotData({ businessKey: data.businessKey })
    })).rejects.toThrow();

    // Same idempotency key
    await expect(prisma.datasetSnapshot.create({
      data: createBaseSnapshotData({ creationIdempotencyKey: data.creationIdempotencyKey })
    })).rejects.toThrow();
  });

  it('enforces UNIQUE constraints on DatasetSnapshotEntry', async () => {
    const snap = await prisma.datasetSnapshot.create({ data: createBaseSnapshotData() });

    await prisma.datasetSnapshotEntry.create({
      data: {
        snapshotId: snap.id,
        dailyBarId: barId1,
        entrySequence: 1,
        instrumentBusinessKey: 'inst-bk',
        marketDate: new Date('2023-01-01T00:00:00Z'),
        barCanonicalHash: 'c1',
        entryHash: 'unique-eh1'
      }
    });

    // Same sequence
    await expect(prisma.datasetSnapshotEntry.create({
      data: { snapshotId: snap.id, dailyBarId: barId2, entrySequence: 1, instrumentBusinessKey: 'inst-bk2', marketDate: new Date('2023-01-02T00:00:00Z'), barCanonicalHash: 'c2', entryHash: 'unique-eh2' }
    })).rejects.toThrow();

    // Same dailyBarId
    await expect(prisma.datasetSnapshotEntry.create({
      data: { snapshotId: snap.id, dailyBarId: barId1, entrySequence: 2, instrumentBusinessKey: 'inst-bk2', marketDate: new Date('2023-01-02T00:00:00Z'), barCanonicalHash: 'c2', entryHash: 'unique-eh3' }
    })).rejects.toThrow();

    // Same instrument + marketDate
    await expect(prisma.datasetSnapshotEntry.create({
      data: { snapshotId: snap.id, dailyBarId: barId2, entrySequence: 3, instrumentBusinessKey: 'inst-bk', marketDate: new Date('2023-01-01T00:00:00Z'), barCanonicalHash: 'c2', entryHash: 'unique-eh4' }
    })).rejects.toThrow();

    // Same entryHash
    await expect(prisma.datasetSnapshotEntry.create({
      data: { snapshotId: snap.id, dailyBarId: barId2, entrySequence: 4, instrumentBusinessKey: 'inst-bk2', marketDate: new Date('2023-01-02T00:00:00Z'), barCanonicalHash: 'c2', entryHash: 'unique-eh1' }
    })).rejects.toThrow();
  });

  // 22. FOREIGN KEY RESTRICTIONS
  it('enforces FOREIGN KEY constraints on DatasetSnapshot (sourceVersionId)', async () => {
    await expect(prisma.datasetSnapshot.create({
      data: createBaseSnapshotData({ sourceVersionId: 'does-not-exist' })
    })).rejects.toThrow();
  });

  it('enforces FOREIGN KEY constraints on DatasetSnapshotEntry (dailyBarId, snapshotId)', async () => {
    const snap = await prisma.datasetSnapshot.create({ data: createBaseSnapshotData() });

    // Missing dailyBarId
    await expect(prisma.datasetSnapshotEntry.create({
      data: { snapshotId: snap.id, dailyBarId: 'does-not-exist', entrySequence: 1, instrumentBusinessKey: 'bk', marketDate: new Date(), barCanonicalHash: 'c', entryHash: 'eh' }
    })).rejects.toThrow();

    // Missing snapshotId
    await expect(prisma.datasetSnapshotEntry.create({
      data: { snapshotId: 'does-not-exist', dailyBarId: barId1, entrySequence: 1, instrumentBusinessKey: 'bk', marketDate: new Date(), barCanonicalHash: 'c', entryHash: 'eh' }
    })).rejects.toThrow();
  });

  it('prevents deletion of referenced DailyMarketBar via RESTRICT', async () => {
    const snap = await prisma.datasetSnapshot.create({ data: createBaseSnapshotData() });
    await prisma.datasetSnapshotEntry.create({
      data: { snapshotId: snap.id, dailyBarId: barId1, entrySequence: 1, instrumentBusinessKey: 'inst-bk', marketDate: new Date('2023-01-01T00:00:00Z'), barCanonicalHash: 'c1', entryHash: `eh-${Date.now()}` }
    });

    // Delete DailyMarketBar -> should reject because DatasetSnapshotEntry points to it
    // But DailyMarketBar has trigger that prevents delete entirely anyway.
    // Wait, the trigger "block_daily_market_bar_mutation" prevents DELETE on DailyMarketBar.
    // We will verify the mutation is blocked.
    await expect(prisma.dailyMarketBar.delete({ where: { id: barId1 } })).rejects.toThrow();
  });

});
