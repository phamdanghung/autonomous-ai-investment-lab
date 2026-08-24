import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { setupIsolatedTestSchema, IsolatedTestSchema } from '../../utils/database';
import { PrismaDatasetSnapshotRepository } from '../../../src/infrastructure/repositories/market-data/PrismaDatasetSnapshotRepository';
import { PrismaMarketDataSourceRepository } from '../../../src/infrastructure/repositories/market-data/PrismaMarketDataSourceRepository';
import { GetMarketDataSourceVersionService } from '../../../src/application/services/market-data/source-version/GetMarketDataSourceVersionService';
import { CreateDatasetSnapshotService, CreateDatasetSnapshotRequest } from '../../../src/application/services/market-data/CreateDatasetSnapshotService';
import { IDatasetSnapshotImportBatchQuery, IDatasetSnapshotDailyBarQuery, IDatasetSnapshotWriteRepository, DatasetSnapshotImportBatchRef, DatasetSnapshotBarCandidate, DatasetSnapshotBarQuery, CreateSealedDatasetSnapshotCommand } from '../../../src/application/ports/market-data/DatasetSnapshotPorts';
import { IClock } from '../../../src/application/ports/IClock';
import { MarketInstrumentDomain } from '../../../src/domain/market-data/MarketInstrument';
import { DatasetSnapshotIdempotencyConflictError } from '../../../src/domain/market-data/MarketDataErrors';

class CountingImportBatchQuery implements IDatasetSnapshotImportBatchQuery {
  public importBatchCalls = 0;
  constructor(private delegate: IDatasetSnapshotImportBatchQuery) {}
  async listCompletedThrough(sourceVersionId: string, cutoffAt: Date): Promise<DatasetSnapshotImportBatchRef[]> {
    this.importBatchCalls++;
    return this.delegate.listCompletedThrough(sourceVersionId, cutoffAt);
  }
}

class CountingDailyBarQuery implements IDatasetSnapshotDailyBarQuery {
  public dailyBarCalls = 0;
  constructor(private delegate: IDatasetSnapshotDailyBarQuery) {}
  async listCandidates(query: DatasetSnapshotBarQuery): Promise<DatasetSnapshotBarCandidate[]> {
    this.dailyBarCalls++;
    return this.delegate.listCandidates(query);
  }
}

class BarrierWriteRepository implements IDatasetSnapshotWriteRepository {
  constructor(private delegate: IDatasetSnapshotWriteRepository, private barrierWait: () => Promise<void>) {}
  async createSealed(command: CreateSealedDatasetSnapshotCommand) {
    await this.barrierWait();
    return this.delegate.createSealed(command);
  }
}

class DeterministicClock implements IClock {
  public calls = 0;
  constructor(private readonly dates: Date[]) {}
  now(): Date {
    if (this.calls >= this.dates.length) {
      throw new Error(`Clock called more than ${this.dates.length} times`);
    }
    return this.dates[this.calls++];
  }
}

function createBarrier(parties: number) {
  let count = 0;
  let resolves: (() => void)[] = [];
  return {
    async wait() {
      count++;
      if (count === parties) {
        resolves.forEach(r => r());
        resolves = [];
      } else {
        await new Promise<void>(resolve => resolves.push(resolve));
      }
    },
    getCount() { return count; },
    reset() {
      count = 0;
      resolves = [];
    }
  };
}

const svKey = 'VN|MARKET_DATA_SOURCE|' + 'a'.repeat(64);
const instIdA = 'inst-a';
const instIdB = 'inst-b';
const bKeyA = MarketInstrumentDomain.buildBusinessKey('HOSE', 'RACEA', 'EQUITY', '2025-01-01');
const bKeyB = MarketInstrumentDomain.buildBusinessKey('HOSE', 'RACEB', 'EQUITY', '2025-01-01');
const svId = 'sv-1';
const earlyCutoff = new Date('2025-01-10T11:00:00.000Z');
const lateCutoff = new Date('2025-01-10T13:00:00.000Z');
const sealedDate = new Date('2025-01-15T00:00:00.000Z');
const sealedDate2 = new Date('2025-01-15T01:00:00.000Z');
const earlyBatchId = 'batch-early';
const lateBatchId = 'batch-late';

describe('DatasetSnapshot Race Conditions', () => {
  let prismaA: PrismaClient;
  let prismaB: PrismaClient;
  let isolatedSchema: IsolatedTestSchema;

  let serviceA: CreateDatasetSnapshotService;
  let serviceB: CreateDatasetSnapshotService;
  let barrier: ReturnType<typeof createBarrier>;
  let clockA: DeterministicClock;
  let clockB: DeterministicClock;
  let batchQueryA: CountingImportBatchQuery;
  let batchQueryB: CountingImportBatchQuery;
  let barQueryA: CountingDailyBarQuery;
  let barQueryB: CountingDailyBarQuery;

  beforeAll(async () => {
    isolatedSchema = await setupIsolatedTestSchema('dataset_snapshot_race');
    prismaA = new PrismaClient({ datasourceUrl: isolatedSchema.databaseUrl });
    prismaB = new PrismaClient({ datasourceUrl: isolatedSchema.databaseUrl });

    const pidA = await prismaA.$queryRawUnsafe<any[]>(`SELECT pg_backend_pid() AS pid`);
    const pidB = await prismaB.$queryRawUnsafe<any[]>(`SELECT pg_backend_pid() AS pid`);
    expect(pidA[0].pid).not.toEqual(pidB[0].pid);

    await prismaA.marketDataSourceVersion.create({
      data: {
        id: svId,
        providerCode: 'VN',
        datasetKind: 'EOD_MARKET_DATA',
        adapterKind: 'REPOSITORY_CSV_FIXTURE',
        adapterVersion: '1',
        schemaVersion: '1',
        canonicalizationVersion: '1',
        priceUnit: 'VND_PER_SHARE',
        encoding: 'UTF8',
        contractHash: 'c'.repeat(64),
        sourceKey: svKey,
        sealedAt: new Date()
      }
    });

    await prismaA.marketInstrument.createMany({
      data: [
        {
          id: instIdA,
          businessKey: bKeyA,
          exchange: 'HOSE',
          canonicalSymbol: 'RACEA',
          securityType: 'EQUITY',
          currency: 'VND',
          effectiveFrom: new Date('2025-01-01T00:00:00.000Z'),
          sealedAt: new Date()
        },
        {
          id: instIdB,
          businessKey: bKeyB,
          exchange: 'HOSE',
          canonicalSymbol: 'RACEB',
          securityType: 'EQUITY',
          currency: 'VND',
          effectiveFrom: new Date('2025-01-01T00:00:00.000Z'),
          sealedAt: new Date()
        }
      ]
    });

    await prismaA.marketDataImportBatch.createMany({
      data: [
        {
          id: earlyBatchId,
          sourceVersionId: svId,
          batchBusinessKey: 'b'.repeat(64),
          status: 'COMPLETED',
          importMode: 'INITIAL',
          sourceObjectKey: 's3://x',
          sourceByteSize: 100n,
          startedAt: new Date(),
          creationIdempotencyKey: 'ib-early',
          creationRequestHash: 'r-early',
          sourceContentHash: 'e'.repeat(64),
          completedAt: new Date('2025-01-10T10:00:00.000Z')
        },
        {
          id: lateBatchId,
          sourceVersionId: svId,
          batchBusinessKey: 'd'.repeat(64),
          status: 'COMPLETED',
          importMode: 'INITIAL',
          sourceObjectKey: 's3://y',
          sourceByteSize: 100n,
          startedAt: new Date(),
          creationIdempotencyKey: 'ib-late',
          creationRequestHash: 'r-late',
          sourceContentHash: 'd'.repeat(64),
          completedAt: new Date('2025-01-10T12:00:00.000Z')
        }
      ]
    });

    await prismaA.dailyMarketBar.createMany({
      data: [
        {
          id: 'bar-early',
          sourceVersionId: svId,
          importBatchId: earlyBatchId,
          instrumentId: instIdA,
          marketDate: new Date('2025-01-02T00:00:00.000Z'),
          barKind: 'TRADED',
          open: 10, high: 12, low: 9, close: 11, volume: 1000,
          canonicalHash: 'c'.repeat(64),
          sourceRecordKey: 'srk-early',
          sourceRowHash: 'c'.repeat(64),
          correctionVersion: 0,
          qualityDecision: 'ACCEPTED',
          qualityFlags: '[]'
        },
        {
          id: 'bar-late',
          sourceVersionId: svId,
          importBatchId: lateBatchId,
          instrumentId: instIdB,
          marketDate: new Date('2025-01-03T00:00:00.000Z'),
          barKind: 'TRADED',
          open: 20, high: 22, low: 19, close: 21, volume: 2000,
          canonicalHash: 'd'.repeat(64),
          sourceRecordKey: 'srk-late',
          sourceRowHash: 'd'.repeat(64),
          correctionVersion: 0,
          qualityDecision: 'ACCEPTED',
          qualityFlags: '[]'
        }
      ]
    });
  });

  afterAll(async () => {
    await prismaA.$disconnect();
    await prismaB.$disconnect();
    await isolatedSchema.teardown();
  });

  beforeEach(async () => {
    barrier = createBarrier(2);
    await prismaA.$executeRawUnsafe(`TRUNCATE TABLE "DatasetSnapshot" CASCADE;`);
  });

  function setupRace(cutoffA: Date, sealedA: Date, cutoffB: Date, sealedB: Date) {
    const dsRepoA = new PrismaDatasetSnapshotRepository(prismaA);
    const dsRepoB = new PrismaDatasetSnapshotRepository(prismaB);
    const svRepoA = new PrismaMarketDataSourceRepository(prismaA, 'EOD_MARKET_DATA');
    const svRepoB = new PrismaMarketDataSourceRepository(prismaB, 'EOD_MARKET_DATA');
    const svSvcA = new GetMarketDataSourceVersionService(svRepoA, 'EOD_MARKET_DATA');
    const svSvcB = new GetMarketDataSourceVersionService(svRepoB, 'EOD_MARKET_DATA');

    batchQueryA = new CountingImportBatchQuery(dsRepoA);
    batchQueryB = new CountingImportBatchQuery(dsRepoB);
    barQueryA = new CountingDailyBarQuery(dsRepoA);
    barQueryB = new CountingDailyBarQuery(dsRepoB);

    barrier = createBarrier(2);

    const writeRepoA = new BarrierWriteRepository(dsRepoA, () => barrier.wait());
    const writeRepoB = new BarrierWriteRepository(dsRepoB, () => barrier.wait());

    clockA = new DeterministicClock([cutoffA, sealedA]);
    clockB = new DeterministicClock([cutoffB, sealedB]);

    serviceA = new CreateDatasetSnapshotService(svSvcA, batchQueryA, barQueryA, dsRepoA, writeRepoA, clockA);
    serviceB = new CreateDatasetSnapshotService(svSvcB, batchQueryB, barQueryB, dsRepoB, writeRepoB, clockB);
  }

  async function assertFinalState(prisma: PrismaClient, expectCount: number, expectedTotalEntries: number) {
    const snaps = await prisma.datasetSnapshot.findMany({ include: { entries: { orderBy: { entrySequence: 'asc' } } } });
    expect(snaps.length).toBe(expectCount);
    
    const drafts = snaps.filter(s => s.status === 'DRAFT');
    expect(drafts.length).toBe(0);

    let totalEntries = 0;
    for (const snap of snaps) {
      expect(snap.status).toBe('SEALED');
      expect(snap.sealedAt).not.toBeNull();
      expect(snap.entries.length).toBe(snap.rowCount);
      totalEntries += snap.entries.length;

      for (let i = 0; i < snap.rowCount; i++) {
        expect(snap.entries[i].entrySequence).toBe(i + 1);
      }
    }
    expect(totalEntries).toBe(expectedTotalEntries);
    return snaps;
  }

  const baseRequest: CreateDatasetSnapshotRequest = {
    sourceVersionKey: svKey,
    creationIdempotencyKey: 'idem-1',
    rangeStart: '2025-01-01',
    rangeEnd: '2025-01-31',
    universe: {
      securityTypes: ['EQUITY'],
      exchanges: ['HOSE'],
      instrumentBusinessKeys: [],
      qualityFlagAllowlist: []
    }
  };

  it('RACE E1 — SAME IDEMPOTENCY / SAME REQUEST', async () => {
    setupRace(lateCutoff, sealedDate, lateCutoff, sealedDate2);

    const req = { ...baseRequest, creationIdempotencyKey: 'race-e1' };

    const results = await Promise.allSettled([
      serviceA.execute(req),
      serviceB.execute(req)
    ]);
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.error(`Service ${i} failed:`, r.reason);
      }
    });

    expect(barrier.getCount()).toBe(2);

    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('fulfilled');

    const vals = results.map(r => (r as PromiseFulfilledResult<any>).value);
    const outcomes = vals.map(v => v.outcome).sort();
    expect(outcomes).toEqual(['CREATED', 'REPLAYED']);

    const snapA = vals[0].snapshot;
    const snapB = vals[1].snapshot;

    expect(snapA.id).toEqual(snapB.id);
    expect(snapA.businessKey).toEqual(snapB.businessKey);
    expect(snapA.dataCutoffKey).toEqual(snapB.dataCutoffKey);
    expect(snapA.manifestHash).toEqual(snapB.manifestHash);
    expect(snapA.contentHash).toEqual(snapB.contentHash);
    expect(snapA.rowCount).toBe(2);
    expect(snapB.rowCount).toBe(2);

    await assertFinalState(prismaA, 1, 2);
  });

  it('RACE E2 — DIFFERENT IDEMPOTENCY / SAME BUSINESS KEY', async () => {
    setupRace(lateCutoff, sealedDate, lateCutoff, sealedDate2);

    const reqA = { ...baseRequest, creationIdempotencyKey: 'race-e2-a' };
    const reqB = { ...baseRequest, creationIdempotencyKey: 'race-e2-b' };

    const results = await Promise.allSettled([
      serviceA.execute(reqA),
      serviceB.execute(reqB)
    ]);

    expect(barrier.getCount()).toBe(2);

    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('fulfilled');

    const vals = results.map(r => (r as PromiseFulfilledResult<any>).value);
    const outcomes = vals.map(v => v.outcome).sort();
    expect(outcomes).toEqual(['CREATED', 'REPLAYED']);

    const snapA = vals[0].snapshot;
    const snapB = vals[1].snapshot;

    expect(snapA.id).toEqual(snapB.id);
    expect(snapA.rowCount).toBe(2);

    const snaps = await assertFinalState(prismaA, 1, 2);
    
    const createdIndex = vals.findIndex(v => v.outcome === 'CREATED');
    expect(createdIndex).toBeGreaterThanOrEqual(0);
    const expectedWinnerIdem = createdIndex === 0 ? reqA.creationIdempotencyKey : reqB.creationIdempotencyKey;
    expect(snaps[0].creationIdempotencyKey).toBe(expectedWinnerIdem);
  });

  it('RACE E3 — SAME IDEMPOTENCY / DIFFERENT REQUEST HASH', async () => {
    setupRace(lateCutoff, sealedDate, lateCutoff, sealedDate2);

    const reqA = { ...baseRequest, creationIdempotencyKey: 'race-e3' };
    const reqB = { 
      ...baseRequest, 
      creationIdempotencyKey: 'race-e3',
      universe: {
        ...baseRequest.universe,
        instrumentBusinessKeys: [bKeyA]
      }
    };

    const results = await Promise.allSettled([
      serviceA.execute(reqA),
      serviceB.execute(reqB)
    ]);

    expect(barrier.getCount()).toBe(2);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const val = (fulfilled[0] as PromiseFulfilledResult<any>).value;
    expect(val.outcome).toBe('CREATED');

    const err = (rejected[0] as PromiseRejectedResult).reason;
    expect(err).toBeInstanceOf(DatasetSnapshotIdempotencyConflictError);
    
    expect(err.name).not.toContain('PrismaClient');
    expect(err.name).not.toBe('DatasetSnapshotUniqueCollisionError');

    await assertFinalState(prismaA, 1, val.snapshot.rowCount);
  });

  it('RACE E4 — SAME IDEMPOTENCY / SAME REQUEST / DIFFERENT CUTOFF', async () => {
    setupRace(earlyCutoff, sealedDate, lateCutoff, sealedDate2);

    const req = { ...baseRequest, creationIdempotencyKey: 'race-e4' };

    const results = await Promise.allSettled([
      serviceA.execute(req),
      serviceB.execute(req)
    ]);

    expect(barrier.getCount()).toBe(2);

    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('fulfilled');

    const vals = results.map(r => (r as PromiseFulfilledResult<any>).value);
    const outcomes = vals.map(v => v.outcome).sort();
    expect(outcomes).toEqual(['CREATED', 'REPLAYED']);

    const snapA = vals[0].snapshot;
    const snapB = vals[1].snapshot;

    expect(snapA.id).toEqual(snapB.id);

    const finalRowCount = snapA.rowCount;
    expect([1, 2]).toContain(finalRowCount);

    if (snapA.dataCutoffAt.getTime() === earlyCutoff.getTime()) {
      expect(finalRowCount).toBe(1);
    } else {
      expect(finalRowCount).toBe(2);
    }

    await assertFinalState(prismaA, 1, finalRowCount);

    expect(batchQueryA.importBatchCalls).toBe(1);
    expect(barQueryA.dailyBarCalls).toBe(1);
    expect(clockA.calls).toBe(2);

    expect(batchQueryB.importBatchCalls).toBe(1);
    expect(barQueryB.dailyBarCalls).toBe(1);
    expect(clockB.calls).toBe(2);
  });

  it('RACE E5 — DIFFERENT IDEMPOTENCY + DIFFERENT CUTOFF', async () => {
    setupRace(earlyCutoff, sealedDate, lateCutoff, sealedDate2);

    const reqA = { ...baseRequest, creationIdempotencyKey: 'race-e5-early' };
    const reqB = { ...baseRequest, creationIdempotencyKey: 'race-e5-late' };

    const results = await Promise.allSettled([
      serviceA.execute(reqA),
      serviceB.execute(reqB)
    ]);

    expect(barrier.getCount()).toBe(2);

    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('fulfilled');

    const vals = results.map(r => (r as PromiseFulfilledResult<any>).value);
    const outcomes = vals.map(v => v.outcome);
    expect(outcomes).toEqual(['CREATED', 'CREATED']);

    const snapA = vals[0].snapshot;
    const snapB = vals[1].snapshot;

    expect(snapA.id).not.toEqual(snapB.id);
    expect(snapA.businessKey).not.toEqual(snapB.businessKey);
    expect(snapA.dataCutoffKey).not.toEqual(snapB.dataCutoffKey);

    expect(snapA.rowCount).toBe(1);
    expect(snapB.rowCount).toBe(2);

    await assertFinalState(prismaA, 2, 3);
  });
});
