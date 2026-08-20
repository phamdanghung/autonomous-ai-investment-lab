import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { setupIsolatedTestSchema, IsolatedTestSchema } from '../../utils/database';

import { PrismaDailyMarketBarRepository } from '../../../src/infrastructure/repositories/market-data/PrismaDailyMarketBarRepository';
import { RegisterDailyMarketBarService, RegisterDailyMarketBarRequest } from '../../../src/application/services/market-data/RegisterDailyMarketBarService';
import { PrismaMarketInstrumentQueryRepository } from '../../../src/infrastructure/repositories/market-data/PrismaMarketInstrumentRepository';
import { PrismaMarketDataSourceRepository } from '../../../src/infrastructure/repositories/market-data/PrismaMarketDataSourceRepository';
import { GetMarketDataSourceVersionService } from '../../../src/application/services/market-data/source-version/GetMarketDataSourceVersionService';

import { MarketDataIntegrityError } from '../../../src/domain/market-data/MarketDataErrors';
import { DailyMarketBarUniqueCollisionError } from '../../../src/application/ports/market-data/DailyMarketBarPorts';
import { MarketInstrumentDomain } from '../../../src/domain/market-data/MarketInstrument';

describe('DailyMarketBar Concurrency Race', () => {
  let isolatedSchema: IsolatedTestSchema;
  let basePrismaA: PrismaClient;
  let basePrismaB: PrismaClient;

  let sourceVersionId: string;
  let instrumentId: string;
  let pendingBatchAId: string;
  let pendingBatchBId: string;

  const sourceFamily = 'daily-bar-race';
  const sourceVersionKey = `VN|MARKET_DATA_SOURCE|${'a'.repeat(64)}`;
  const instrumentBusinessKey = MarketInstrumentDomain.buildBusinessKey('HOSE', 'DMBAR', 'EQUITY', '2025-01-01');

  let readyCount = 0;
  let release!: () => void;
  let barrier: Promise<void>;

  let serviceA: RegisterDailyMarketBarService;
  let serviceB: RegisterDailyMarketBarService;

  beforeEach(async () => {
    isolatedSchema = await setupIsolatedTestSchema('daily_bar_race');
    
    // Seed using a temporary client
    const seedPrisma = new PrismaClient({ datasourceUrl: isolatedSchema.databaseUrl });
    await seedPrisma.$connect();

    const sv = await seedPrisma.marketDataSourceVersion.create({
      data: {
        sourceKey: sourceVersionKey,
        contractHash: 'a'.repeat(64),
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
    sourceVersionId = sv.id;

    const inst = await seedPrisma.marketInstrument.create({
      data: {
        businessKey: instrumentBusinessKey,
        exchange: 'HOSE',
        canonicalSymbol: 'DMBAR',
        securityType: 'EQUITY',
        effectiveFrom: new Date(Date.UTC(2025, 0, 1)),
        effectiveTo: null,
        currency: 'VND',
        sealedAt: new Date()
      }
    });
    instrumentId = inst.id;

    const batchA = await seedPrisma.marketDataImportBatch.create({
      data: {
        batchBusinessKey: 'batch-a-key',
        creationIdempotencyKey: 'idem-a',
        creationRequestHash: 'req-a',
        sourceVersionId,
        sourceObjectKey: 'obj-a',
        sourceContentHash: 'hash',
        sourceByteSize: 100n,
        importMode: 'INITIAL',
        status: 'PENDING',
        startedAt: new Date(),
      }
    });
    pendingBatchAId = batchA.id;

    const batchB = await seedPrisma.marketDataImportBatch.create({
      data: {
        batchBusinessKey: 'batch-b-key',
        creationIdempotencyKey: 'idem-b',
        creationRequestHash: 'req-b',
        sourceVersionId,
        sourceObjectKey: 'obj-b',
        sourceContentHash: 'hash',
        sourceByteSize: 100n,
        importMode: 'INITIAL',
        status: 'PENDING',
        startedAt: new Date(),
      }
    });
    pendingBatchBId = batchB.id;

    await seedPrisma.$disconnect();

    // Setup independent clients
    basePrismaA = new PrismaClient({ datasourceUrl: isolatedSchema.databaseUrl });
    basePrismaB = new PrismaClient({ datasourceUrl: isolatedSchema.databaseUrl });
    await basePrismaA.$connect();
    await basePrismaB.$connect();

    const pidA = (await basePrismaA.$queryRaw<{pg_backend_pid: number}[]>`SELECT pg_backend_pid()`)[0].pg_backend_pid;
    const pidB = (await basePrismaB.$queryRaw<{pg_backend_pid: number}[]>`SELECT pg_backend_pid()`)[0].pg_backend_pid;
    expect(pidA).not.toBe(pidB);

    // Setup barrier
    readyCount = 0;
    barrier = new Promise<void>(resolve => release = resolve);

    const prismaA = basePrismaA.$extends({
      query: {
        dailyMarketBar: {
          async create({ args, query }) {
            readyCount++;
            if (readyCount === 2) release();
            await barrier;
            return query(args);
          }
        }
      }
    }) as unknown as PrismaClient;

    const prismaB = basePrismaB.$extends({
      query: {
        dailyMarketBar: {
          async create({ args, query }) {
            readyCount++;
            if (readyCount === 2) release();
            await barrier;
            return query(args);
          }
        }
      }
    }) as unknown as PrismaClient;

    // Build stacks
    const buildStack = (p: PrismaClient) => {
      const dailyRepo = new PrismaDailyMarketBarRepository(p);
      const instrumentRepo = new PrismaMarketInstrumentQueryRepository(p);
      const sourceRepo = new PrismaMarketDataSourceRepository(p, sourceFamily);
      const getSourceVersionService = new GetMarketDataSourceVersionService(sourceRepo, sourceFamily);
      return new RegisterDailyMarketBarService(dailyRepo, dailyRepo, dailyRepo, getSourceVersionService, instrumentRepo);
    };

    serviceA = buildStack(prismaA);
    serviceB = buildStack(prismaB);
  }, 20000);

  afterEach(async () => {
    await basePrismaA.$disconnect();
    await basePrismaB.$disconnect();
    if (isolatedSchema) {
      await isolatedSchema.teardown();
    }
  }, 20000);

  const getRequestBase = (importBatchId: string): RegisterDailyMarketBarRequest => ({
    sourceVersionKey,
    importBatchId,
    sourceRecordKey: 'rec-1',
    instrumentBusinessKey,
    marketDate: '2025-01-02',
    barKind: 'TRADED',
    open: '10',
    high: '12',
    low: '9',
    close: '11',
    volume: '1000',
    tradingValue: '10000',
    correctionVersion: 0,
    qualityDecision: 'ACCEPTED',
    qualityFlags: '',
    supersedesBarHash: null,
    sourceRowHash: 'a'.repeat(64)
  });

  it('E1 - SAME CANONICAL BAR', async () => {
    const reqA = getRequestBase(pendingBatchAId);
    const reqB = getRequestBase(pendingBatchBId);

    const results = await Promise.allSettled([
      serviceA.execute(reqA),
      serviceB.execute(reqB)
    ]);

    expect(readyCount).toBe(2);

    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('fulfilled');

    const vA = (results[0] as PromiseFulfilledResult<any>).value;
    const vB = (results[1] as PromiseFulfilledResult<any>).value;

    expect(
      (vA.outcome === 'CREATED' && vB.outcome === 'REPLAYED') ||
      (vA.outcome === 'REPLAYED' && vB.outcome === 'CREATED')
    ).toBe(true);

    const expectedWinningBatchId = vA.outcome === 'CREATED' ? pendingBatchAId : pendingBatchBId;

    expect(vA.bar.id).toBe(vB.bar.id);
    expect(vA.bar.canonicalHash).toBe(vB.bar.canonicalHash);
    expect(vA.bar.importBatchId).toBe(expectedWinningBatchId);
    expect(vB.bar.importBatchId).toBe(expectedWinningBatchId);

    // Final DB checks
    const p = new PrismaClient({ datasourceUrl: isolatedSchema.databaseUrl });
    const count = await p.dailyMarketBar.count({ where: { canonicalHash: vA.bar.canonicalHash } });
    expect(count).toBe(1);

    const dbRow = await p.dailyMarketBar.findUnique({ where: { canonicalHash: vA.bar.canonicalHash } });
    expect(dbRow).not.toBeNull();
    expect(dbRow!.importBatchId).toBe(expectedWinningBatchId);

    await p.$disconnect();
  });

  it('E2 - IDENTITY A CONFLICT', async () => {
    const reqA = getRequestBase(pendingBatchAId);
    const reqB = { 
      ...getRequestBase(pendingBatchBId), 
      sourceRecordKey: 'diff-rec', // different key => different canonical hash
      volume: '999' 
    };

    const results = await Promise.allSettled([
      serviceA.execute(reqA),
      serviceB.execute(reqB)
    ]);

    expect(readyCount).toBe(2);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    expect((fulfilled[0] as any).value.outcome).toBe('CREATED');

    const error = (rejected[0] as PromiseRejectedResult).reason;
    expect(error).toBeInstanceOf(MarketDataIntegrityError);
    expect(error.message).toBe('Daily market bar unique collision conflicts with existing canonical content.');
    expect(error).not.toBeInstanceOf(DailyMarketBarUniqueCollisionError);
    expect(error).not.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(error).not.toBeInstanceOf(Prisma.PrismaClientUnknownRequestError);

    // Final DB check
    const p = new PrismaClient({ datasourceUrl: isolatedSchema.databaseUrl });
    const count = await p.dailyMarketBar.count({
      where: {
        sourceVersionId,
        instrumentId,
        marketDate: new Date(Date.UTC(2025, 0, 2)),
        correctionVersion: 0
      }
    });
    expect(count).toBe(1);
    await p.$disconnect();
  });

  it('E3 - IDENTITY B CONFLICT', async () => {
    const reqA = getRequestBase(pendingBatchAId);
    const reqB = { 
      ...getRequestBase(pendingBatchBId), 
      marketDate: '2025-01-03', // different date => different identity A
      volume: '999' 
    };

    const results = await Promise.allSettled([
      serviceA.execute(reqA),
      serviceB.execute(reqB)
    ]);

    expect(readyCount).toBe(2);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    expect((fulfilled[0] as any).value.outcome).toBe('CREATED');

    const error = (rejected[0] as PromiseRejectedResult).reason;
    expect(error).toBeInstanceOf(MarketDataIntegrityError);
    expect(error.message).toBe('Daily market bar unique collision conflicts with existing canonical content.');
    expect(error).not.toBeInstanceOf(DailyMarketBarUniqueCollisionError);
    expect(error).not.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(error).not.toBeInstanceOf(Prisma.PrismaClientUnknownRequestError);

    const p = new PrismaClient({ datasourceUrl: isolatedSchema.databaseUrl });
    const count = await p.dailyMarketBar.count({
      where: {
        sourceVersionId,
        sourceRecordKey: 'rec-1',
        correctionVersion: 0
      }
    });
    expect(count).toBe(1);
    await p.$disconnect();
  });

  it('E4 - CORRECTION FORK', async () => {
    // 1. Seed v0 deterministically using normal service
    const reqV0 = getRequestBase(pendingBatchAId);
    
    // Create a plain service/repo without barrier for seeding
    const pSeed = new PrismaClient({ datasourceUrl: isolatedSchema.databaseUrl });
    const repoSeed = new PrismaDailyMarketBarRepository(pSeed);
    const instRepoSeed = new PrismaMarketInstrumentQueryRepository(pSeed);
    const srcRepoSeed = new PrismaMarketDataSourceRepository(pSeed, sourceFamily);
    const getSrcVerSeed = new GetMarketDataSourceVersionService(srcRepoSeed, sourceFamily);
    const serviceSeed = new RegisterDailyMarketBarService(repoSeed, repoSeed, repoSeed, getSrcVerSeed, instRepoSeed);

    const resV0 = await serviceSeed.execute(reqV0);
    expect(resV0.outcome).toBe('CREATED');
    const v0Hash = resV0.bar.canonicalHash;
    const v0Id = resV0.bar.id;
    await pSeed.$disconnect();

    // 2. Race two different v1s
    const reqV1A = { 
      ...getRequestBase(pendingBatchAId),
      correctionVersion: 1,
      volume: '1100',
      supersedesBarHash: v0Hash
    };
    const reqV1B = { 
      ...getRequestBase(pendingBatchBId),
      correctionVersion: 1,
      volume: '1200',
      supersedesBarHash: v0Hash
    };

    const results = await Promise.allSettled([
      serviceA.execute(reqV1A),
      serviceB.execute(reqV1B)
    ]);

    expect(readyCount).toBe(2);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const winningV1 = (fulfilled[0] as any).value;
    expect(winningV1.outcome).toBe('CREATED');

    const error = (rejected[0] as PromiseRejectedResult).reason;
    expect(error).toBeInstanceOf(MarketDataIntegrityError);
    // Accept either valid race outcome message
    const msg = error.message;
    expect(
      msg === 'Daily market bar unique collision conflicts with existing canonical content.' ||
      msg === 'Daily market bar predecessor has already been superseded.'
    ).toBe(true);
    expect(error).not.toBeInstanceOf(DailyMarketBarUniqueCollisionError);
    expect(error).not.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(error).not.toBeInstanceOf(Prisma.PrismaClientUnknownRequestError);

    const p = new PrismaClient({ datasourceUrl: isolatedSchema.databaseUrl });
    const observerRepo = new PrismaDailyMarketBarRepository(p);

    const lookup = await observerRepo.findBySupersedesBarId(v0Id);
    expect(lookup).not.toBeNull();
    expect(lookup!.id).toBe(winningV1.bar.id);
    expect(lookup!.canonicalHash).toBe(winningV1.bar.canonicalHash);

    // Check v0 still exists
    const v0Check = await p.dailyMarketBar.findUnique({ where: { id: v0Id } });
    expect(v0Check).toBeDefined();

    // Check exactly one supersedesBarId
    const supersedesCount = await p.dailyMarketBar.count({ where: { supersedesBarId: v0Id } });
    expect(supersedesCount).toBe(1);

    // Check chain total (v0 + v1)
    const chainCount = await p.dailyMarketBar.count({
      where: {
        sourceVersionId,
        instrumentId,
        marketDate: new Date(Date.UTC(2025, 0, 2))
      }
    });
    expect(chainCount).toBe(2);

    await p.$disconnect();
  });
});
