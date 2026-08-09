import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { setupIsolatedTestSchema, IsolatedTestSchema } from '../../utils/database';
import { PrismaImportBatchMutationRepository } from '../../../src/infrastructure/repositories/market-data/PrismaImportBatchMutationRepository';
import { ProgressDelta } from '../../../src/domain/market-data/MarketDataImportBatch';
import { TransitionImportBatchCommand } from '../../../src/application/ports/market-data/ImportBatchMutationPorts';

describe('Import Batch Mutation Concurrency Race Tests', () => {
  let isolatedSchema: IsolatedTestSchema;
  let basePrismaA: PrismaClient;
  let basePrismaB: PrismaClient;
  let testSourceVersionId = `sv-race-${Date.now()}`;

  beforeEach(async () => {
    isolatedSchema = await setupIsolatedTestSchema('ib_race');
    
    // Seed initial Source Version directly on schema to satisfy FK
    const url = isolatedSchema.databaseUrl;
    const tempClient = new PrismaClient({ datasourceUrl: url });
    try {
      await tempClient.marketDataSourceVersion.create({
        data: {
          id: testSourceVersionId,
          sourceKey: 'test-source-key',
          providerCode: 'TEST',
          datasetKind: 'EOD_MARKET_DATA',
          adapterKind: 'REPOSITORY_CSV_FIXTURE',
          adapterVersion: '1.0',
          schemaVersion: '1.0',
          canonicalizationVersion: '1.0',
          priceUnit: 'VND_PER_SHARE',
          encoding: 'UTF8',
          contractHash: 'test-hash-race',
          sealedAt: new Date()
        }
      });
    } finally {
      await tempClient.$disconnect();
    }
    
    const separator = url.includes('?') ? '&' : '?';
    basePrismaA = new PrismaClient({ datasourceUrl: url + separator + 'application_name=race_client_A' });
    basePrismaB = new PrismaClient({ datasourceUrl: url + separator + 'application_name=race_client_B' });
  });

  afterEach(async () => {
    const results = await Promise.allSettled([
      basePrismaA?.$disconnect(),
      basePrismaB?.$disconnect(),
      isolatedSchema?.teardown()
    ]);
    const errors = results.filter(r => r.status === 'rejected');
    if (errors.length > 0) {
      throw new Error(`Cleanup failed: ${errors.map(e => (e as PromiseRejectedResult).reason).join(', ')}`);
    }
  });

  async function expectIndependentPostgresSessions() {
    const pidA = await basePrismaA.$queryRaw<{pid: number}[]>`SELECT pg_backend_pid() as pid`;
    const pidB = await basePrismaB.$queryRaw<{pid: number}[]>`SELECT pg_backend_pid() as pid`;
    expect(pidA[0].pid).not.toEqual(pidB[0].pid);
  }

  async function seedBatch(id: string) {
    await basePrismaA.marketDataImportBatch.create({
      data: {
        id,
        sourceVersionId: testSourceVersionId,
        creationIdempotencyKey: `idem-${id}`,
        creationRequestHash: `req-${id}`,
        batchBusinessKey: `biz-${id}`,
        sourceObjectKey: `obj-${id}`,
        sourceContentHash: 'a'.repeat(64),
        sourceByteSize: 1024,
        declaredRowCount: 100,
        parsedRowCount: 5,
        acceptedRowCount: 3,
        flaggedRowCount: 1,
        quarantinedRowCount: 1,
        importMode: 'INITIAL',
        status: 'PENDING',
        startedAt: new Date()
      }
    });
  }

  it('D3-A: PROGRESS vs PROGRESS - Atomic accumulation exactly once', async () => {
    const id = 'batch-d3-a';
    await seedBatch(id);

    await expectIndependentPostgresSessions();

    let readyCount = 0;
    let releaseBarrier: () => void;
    const barrier = new Promise<void>(resolve => { releaseBarrier = resolve; });

    const prismaA = basePrismaA.$extends({
      query: {
        marketDataImportBatch: {
          async updateManyAndReturn({ args, query }) {
            readyCount++;
            if (readyCount === 2) releaseBarrier();
            await barrier;
            return query(args);
          }
        }
      }
    });

    const prismaB = basePrismaB.$extends({
      query: {
        marketDataImportBatch: {
          async updateManyAndReturn({ args, query }) {
            readyCount++;
            if (readyCount === 2) releaseBarrier();
            await barrier;
            return query(args);
          }
        }
      }
    });

    const repoA = new PrismaImportBatchMutationRepository(prismaA as any);
    const repoB = new PrismaImportBatchMutationRepository(prismaB as any);

    const deltaA: ProgressDelta = { parsedDelta: 10, acceptedDelta: 6, flaggedDelta: 3, quarantinedDelta: 1 };
    const deltaB: ProgressDelta = { parsedDelta: 20, acceptedDelta: 12, flaggedDelta: 5, quarantinedDelta: 3 };

    const pA = repoA.applyProgressDeltaConditional(id, deltaA);
    const pB = repoB.applyProgressDeltaConditional(id, deltaB);

    const [resA, resB] = await Promise.all([pA, pB]);

    expect(readyCount).toBe(2);
    expect(resA.outcome).toBe('UPDATED');
    expect(resB.outcome).toBe('UPDATED');

    const finalState = await basePrismaA.marketDataImportBatch.findUniqueOrThrow({ where: { id } });
    
    expect(finalState.parsedRowCount).toBe(5 + 10 + 20); // 35
    expect(finalState.acceptedRowCount).toBe(3 + 6 + 12); // 21
    expect(finalState.flaggedRowCount).toBe(1 + 3 + 5); // 9
    expect(finalState.quarantinedRowCount).toBe(1 + 1 + 3); // 5
    expect(finalState.status).toBe('PENDING');
  });

  it('D3-B: TERMINAL vs TERMINAL - Exactly one transition wins', async () => {
    const id = 'batch-d3-b';
    await seedBatch(id);
    
    await expectIndependentPostgresSessions();
    
    let readyCount = 0;
    let releaseBarrier: () => void;
    const barrier = new Promise<void>(resolve => { releaseBarrier = resolve; });

    const prismaA = basePrismaA.$extends({ query: { marketDataImportBatch: { async updateManyAndReturn({ args, query }) { readyCount++; if (readyCount === 2) releaseBarrier(); await barrier; return query(args); } } } });
    const prismaB = basePrismaB.$extends({ query: { marketDataImportBatch: { async updateManyAndReturn({ args, query }) { readyCount++; if (readyCount === 2) releaseBarrier(); await barrier; return query(args); } } } });

    const repoA = new PrismaImportBatchMutationRepository(prismaA as any);
    const repoB = new PrismaImportBatchMutationRepository(prismaB as any);

    const cmdA: TransitionImportBatchCommand = { id, targetStatus: 'COMPLETED', completedAt: new Date(), failedAt: null, failureCode: null };
    const cmdB: TransitionImportBatchCommand = { id, targetStatus: 'FAILED', completedAt: null, failedAt: new Date(), failureCode: 'TEST_ERR' };

    const pA = repoA.transitionConditional(cmdA);
    const pB = repoB.transitionConditional(cmdB);

    const [resA, resB] = await Promise.all([pA, pB]);

    expect(readyCount).toBe(2);
    
    const outcomes = [resA.outcome, resB.outcome];
    expect(outcomes).toContain('UPDATED');
    expect(outcomes).toContain('NO_MATCH');

    const finalState = await basePrismaA.marketDataImportBatch.findUniqueOrThrow({ where: { id } });
    if (resA.outcome === 'UPDATED') {
      expect(finalState.status).toBe('COMPLETED');
    } else {
      expect(finalState.status).toBe('FAILED');
      expect(finalState.failureCode).toBe('TEST_ERR');
    }
  });

  it('D3-D: PROGRESS vs TERMINAL - Safe serialization without anomalies', async () => {
    const id = 'batch-d3-d';
    await seedBatch(id);
    
    await expectIndependentPostgresSessions();
    
    let readyCount = 0;
    let releaseBarrier: () => void;
    const barrier = new Promise<void>(resolve => { releaseBarrier = resolve; });

    const prismaA = basePrismaA.$extends({ query: { marketDataImportBatch: { async updateManyAndReturn({ args, query }) { readyCount++; if (readyCount === 2) releaseBarrier(); await barrier; return query(args); } } } });
    const prismaB = basePrismaB.$extends({ query: { marketDataImportBatch: { async updateManyAndReturn({ args, query }) { readyCount++; if (readyCount === 2) releaseBarrier(); await barrier; return query(args); } } } });

    const repoA = new PrismaImportBatchMutationRepository(prismaA as any);
    const repoB = new PrismaImportBatchMutationRepository(prismaB as any);

    const deltaA: ProgressDelta = { parsedDelta: 10, acceptedDelta: 6, flaggedDelta: 3, quarantinedDelta: 1 };
    const pA = repoA.applyProgressDeltaConditional(id, deltaA);

    const cmdB: TransitionImportBatchCommand = { id, targetStatus: 'COMPLETED', completedAt: new Date(), failedAt: null, failureCode: null };
    const pB = repoB.transitionConditional(cmdB);

    const [resA, resB] = await Promise.all([pA, pB]);
    expect(readyCount).toBe(2);
    
    const finalState = await basePrismaA.marketDataImportBatch.findUniqueOrThrow({ where: { id } });
    expect(finalState.status).toBe('COMPLETED');
    expect(resB.outcome).toBe('UPDATED'); // Transition must ALWAYS succeed given the row was initially PENDING

    if (resA.outcome === 'UPDATED') {
      expect(finalState.parsedRowCount).toBe(15);
      expect(finalState.acceptedRowCount).toBe(9);
      expect(finalState.flaggedRowCount).toBe(4);
      expect(finalState.quarantinedRowCount).toBe(2);
    } else {
      expect(resA.outcome).toBe('NO_MATCH');
      expect(finalState.parsedRowCount).toBe(5);
      expect(finalState.acceptedRowCount).toBe(3);
      expect(finalState.flaggedRowCount).toBe(1);
      expect(finalState.quarantinedRowCount).toBe(1);
    }
  });
});
