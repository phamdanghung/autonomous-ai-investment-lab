import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { setupIsolatedTestSchema, IsolatedTestSchema } from '../../utils/database';
import { PrismaImportBatchMutationRepository } from '../../../src/infrastructure/repositories/market-data/PrismaImportBatchMutationRepository';
import { MarketDataIntegrityError, MarketDataConcurrencyConflictError } from '../../../src/domain/market-data/MarketDataErrors';
import { ProgressDelta } from '../../../src/domain/market-data/MarketDataImportBatch';
import { TransitionImportBatchCommand } from '../../../src/application/ports/market-data/ImportBatchMutationPorts';

describe('PrismaImportBatchMutationRepository Integration', () => {
  let isolatedSchema: IsolatedTestSchema;
  let prisma: PrismaClient;
  let repo: PrismaImportBatchMutationRepository;

  beforeAll(async () => {
    isolatedSchema = await setupIsolatedTestSchema('ib_mutation_repo');
    prisma = new PrismaClient({ datasourceUrl: isolatedSchema.databaseUrl });
    repo = new PrismaImportBatchMutationRepository(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    if (isolatedSchema) {
      await isolatedSchema.teardown();
    }
  });

  const testSourceVersionId = `sv-${Date.now()}`;
  let batchCounter = 0;

  beforeAll(async () => {
    await prisma.marketDataSourceVersion.create({
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
        contractHash: 'test-hash',
        sealedAt: new Date()
      }
    });
  });

  async function seedBatch(status: 'PENDING' | 'COMPLETED' | 'COMPLETED_WITH_QUARANTINE' | 'FAILED' = 'PENDING') {
    batchCounter++;
    const id = `batch-${Date.now()}-${batchCounter}`;
    
    let completedAt: Date | null = null;
    let failedAt: Date | null = null;
    let failureCode: string | null = null;

    if (status === 'COMPLETED' || status === 'COMPLETED_WITH_QUARANTINE') {
      completedAt = new Date();
    } else if (status === 'FAILED') {
      failedAt = new Date();
      failureCode = 'TEST_FAIL';
    }

    await prisma.marketDataImportBatch.create({
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
        parsedRowCount: 0,
        acceptedRowCount: 0,
        flaggedRowCount: 0,
        quarantinedRowCount: 0,
        importMode: 'INITIAL',
        status,
        startedAt: new Date(),
        completedAt,
        failedAt,
        failureCode
      }
    });
    return id;
  }

  describe('findById', () => {
    it('returns null if missing', async () => {
      const res = await repo.findById('non-existent');
      expect(res).toBeNull();
    });

    it('returns record if found', async () => {
      const id = await seedBatch();
      const res = await repo.findById(id);
      expect(res).toBeDefined();
      expect(res?.id).toBe(id);
    });
  });

  describe('applyProgressDeltaConditional', () => {
    it('executes progress atomic increment', async () => {
      const id = await seedBatch();
      const delta: ProgressDelta = { parsedDelta: 5, acceptedDelta: 3, flaggedDelta: 1, quarantinedDelta: 1 };
      
      const res = await repo.applyProgressDeltaConditional(id, delta);
      expect(res.outcome).toBe('UPDATED');
      if (res.outcome === 'UPDATED') {
        expect(res.record.parsedRowCount).toBe(5);
        expect(res.record.acceptedRowCount).toBe(3);
        expect(res.record.flaggedRowCount).toBe(1);
        expect(res.record.quarantinedRowCount).toBe(1);
      }
    });

    it('executes progress all-zero delta successfully', async () => {
      const id = await seedBatch();
      const delta: ProgressDelta = { parsedDelta: 0, acceptedDelta: 0, flaggedDelta: 0, quarantinedDelta: 0 };
      
      const res = await repo.applyProgressDeltaConditional(id, delta);
      expect(res.outcome).toBe('UPDATED');
    });

    it('accumulates correctly with two sequential valid progress increments', async () => {
      const id = await seedBatch();
      await repo.applyProgressDeltaConditional(id, { parsedDelta: 5, acceptedDelta: 3, flaggedDelta: 1, quarantinedDelta: 1 });
      const res = await repo.applyProgressDeltaConditional(id, { parsedDelta: 10, acceptedDelta: 5, flaggedDelta: 2, quarantinedDelta: 3 });
      
      expect(res.outcome).toBe('UPDATED');
      if (res.outcome === 'UPDATED') {
        expect(res.record.parsedRowCount).toBe(15);
        expect(res.record.acceptedRowCount).toBe(8);
        expect(res.record.flaggedRowCount).toBe(3);
        expect(res.record.quarantinedRowCount).toBe(4);
      }
    });

    it('returns NO_MATCH for conditional progress on terminal row', async () => {
      const id = await seedBatch('COMPLETED');
      const delta: ProgressDelta = { parsedDelta: 5, acceptedDelta: 5, flaggedDelta: 0, quarantinedDelta: 0 };
      const res = await repo.applyProgressDeltaConditional(id, delta);
      expect(res.outcome).toBe('NO_MATCH');
    });
  });

  describe('transitionConditional', () => {
    it('PENDING -> PENDING -> UPDATED', async () => {
      const id = await seedBatch('PENDING');
      const cmd: TransitionImportBatchCommand = { id, targetStatus: 'PENDING', completedAt: null, failedAt: null, failureCode: null };
      const res = await repo.transitionConditional(cmd);
      
      expect(res.outcome).toBe('UPDATED');
      if (res.outcome === 'UPDATED') {
        expect(res.record.status).toBe('PENDING');
      }
    });

    it('PENDING -> COMPLETED -> UPDATED -> completedAt preserved -> failedAt/failureCode null', async () => {
      const id = await seedBatch('PENDING');
      
      // Need valid counters for completed invariants
      await prisma.marketDataImportBatch.update({
        where: { id },
        data: { parsedRowCount: 100, acceptedRowCount: 100 }
      });

      const completedAt = new Date('2026-08-01T12:00:00Z');
      const cmd: TransitionImportBatchCommand = { id, targetStatus: 'COMPLETED', completedAt, failedAt: null, failureCode: null };
      const res = await repo.transitionConditional(cmd);
      
      expect(res.outcome).toBe('UPDATED');
      if (res.outcome === 'UPDATED') {
        expect(res.record.status).toBe('COMPLETED');
        const check = await prisma.marketDataImportBatch.findUnique({ where: { id } });
        expect(check?.completedAt).toEqual(completedAt);
        expect(check?.failedAt).toBeNull();
        expect(check?.failureCode).toBeNull();
      }
    });

    it('PENDING -> COMPLETED_WITH_QUARANTINE -> UPDATED -> completedAt preserved', async () => {
      const id = await seedBatch('PENDING');
      
      // Need valid counters for completed invariants
      await prisma.marketDataImportBatch.update({
        where: { id },
        data: { parsedRowCount: 100, acceptedRowCount: 90, quarantinedRowCount: 10 }
      });

      const completedAt = new Date('2026-08-01T12:00:00Z');
      const cmd: TransitionImportBatchCommand = { id, targetStatus: 'COMPLETED_WITH_QUARANTINE', completedAt, failedAt: null, failureCode: null };
      const res = await repo.transitionConditional(cmd);
      
      expect(res.outcome).toBe('UPDATED');
      if (res.outcome === 'UPDATED') {
        expect(res.record.status).toBe('COMPLETED_WITH_QUARANTINE');
        const check = await prisma.marketDataImportBatch.findUnique({ where: { id } });
        expect(check?.completedAt).toEqual(completedAt);
      }
    });

    it('PENDING -> FAILED -> UPDATED -> failedAt preserved -> failureCode preserved', async () => {
      const id = await seedBatch('PENDING');
      const failedAt = new Date('2026-08-01T12:00:00Z');
      const cmd: TransitionImportBatchCommand = { id, targetStatus: 'FAILED', completedAt: null, failedAt, failureCode: 'SOME_ERROR' };
      const res = await repo.transitionConditional(cmd);
      
      expect(res.outcome).toBe('UPDATED');
      if (res.outcome === 'UPDATED') {
        expect(res.record.status).toBe('FAILED');
        const check = await prisma.marketDataImportBatch.findUnique({ where: { id } });
        expect(check?.failedAt).toEqual(failedAt);
        expect(check?.failureCode).toBe('SOME_ERROR');
      }
    });

    it('FAILED with empty-string failureCode -> persisted successfully if DB frozen constraint permits it', async () => {
      const id = await seedBatch('PENDING');
      const failedAt = new Date('2026-08-01T12:00:00Z');
      const cmd: TransitionImportBatchCommand = { id, targetStatus: 'FAILED', completedAt: null, failedAt, failureCode: '' };
      const res = await repo.transitionConditional(cmd);
      
      expect(res.outcome).toBe('UPDATED');
      if (res.outcome === 'UPDATED') {
        expect(res.record.status).toBe('FAILED');
        const check = await prisma.marketDataImportBatch.findUnique({ where: { id } });
        expect(check?.failureCode).toBe('');
      }
    });

    it('transition on terminal row -> NO_MATCH', async () => {
      const id = await seedBatch('FAILED');
      const failedAt = new Date('2026-08-01T12:00:00Z');
      const cmd: TransitionImportBatchCommand = { id, targetStatus: 'FAILED', completedAt: null, failedAt, failureCode: 'ERROR' };
      const res = await repo.transitionConditional(cmd);
      expect(res.outcome).toBe('NO_MATCH');
    });

    it('same-target terminal conditional attempt -> NO_MATCH', async () => {
      const id = await seedBatch('COMPLETED');
      const cmd: TransitionImportBatchCommand = { id, targetStatus: 'COMPLETED', completedAt: new Date(), failedAt: null, failureCode: null };
      const res = await repo.transitionConditional(cmd);
      expect(res.outcome).toBe('NO_MATCH');
    });

    it('immutable provenance fields unchanged', async () => {
      const id = await seedBatch('PENDING');
      const cmd: TransitionImportBatchCommand = { id, targetStatus: 'FAILED', completedAt: null, failedAt: new Date(), failureCode: 'ERROR' };
      await repo.transitionConditional(cmd);
      
      const check = await prisma.marketDataImportBatch.findUnique({ where: { id } });
      expect(check?.sourceObjectKey).toBe(`obj-${id}`);
      expect(check?.creationRequestHash).toBe(`req-${id}`);
    });
  });

  describe('Completed counter invariant DB rejection', () => {
    it('DB rejection -> MarketDataIntegrityError', async () => {
      const id = await seedBatch('PENDING');
      
      // parsedRowCount = 100, acceptedRowCount = 0 -> violates the sum constraint!
      await prisma.marketDataImportBatch.update({
        where: { id },
        data: { parsedRowCount: 100, acceptedRowCount: 0, flaggedRowCount: 0, quarantinedRowCount: 0 }
      });
      
      const completedAt = new Date('2026-08-01T12:00:00Z');
      const cmd: TransitionImportBatchCommand = { id, targetStatus: 'COMPLETED', completedAt, failedAt: null, failureCode: null };
      
      await expect(repo.transitionConditional(cmd)).rejects.toThrow(MarketDataIntegrityError);
    });
  });
});

describe('PrismaImportBatchMutationRepository Error-Injection / Adapter Contract Tests', () => {
  let fakePrisma: any;
  let repo: PrismaImportBatchMutationRepository;

  beforeEach(() => {
    fakePrisma = {
      marketDataImportBatch: {}
    };
    repo = new PrismaImportBatchMutationRepository(fakePrisma as unknown as PrismaClient);
  });

  it('P2034 -> exact concurrency error', async () => {
    fakePrisma.marketDataImportBatch.updateManyAndReturn = async () => {
      throw new Prisma.PrismaClientKnownRequestError('Concurrency', { code: 'P2034', clientVersion: 'test' });
    };

    const promise = repo.applyProgressDeltaConditional('id', { parsedDelta: 0, acceptedDelta: 0, flaggedDelta: 0, quarantinedDelta: 0 });
    await expect(promise).rejects.toThrow(MarketDataConcurrencyConflictError);
    
    try {
      await promise;
    } catch (e: any) {
      expect(e.code).toBe('MARKET_DATA_CONCURRENCY_CONFLICT');
      expect(e.category).toBe('CONCURRENCY');
      expect(e.retryable).toBe(true);
      expect(e.message).toBe('Concurrent market-data operation conflict.');
      expect(e.safeMessage).toBe('Concurrent market-data operation conflict.');
    }
  });

  it('unexpected P2025 -> integrity', async () => {
    fakePrisma.marketDataImportBatch.updateManyAndReturn = async () => {
      throw new Prisma.PrismaClientKnownRequestError('Not Found', { code: 'P2025', clientVersion: 'test' });
    };

    await expect(repo.applyProgressDeltaConditional('id', { parsedDelta: 0, acceptedDelta: 0, flaggedDelta: 0, quarantinedDelta: 0 }))
      .rejects.toThrow(MarketDataIntegrityError);
  });

  it('remaining P2* -> integrity', async () => {
    fakePrisma.marketDataImportBatch.updateManyAndReturn = async () => {
      throw new Prisma.PrismaClientKnownRequestError('Unique constraint', { code: 'P2002', clientVersion: 'test' });
    };

    await expect(repo.applyProgressDeltaConditional('id', { parsedDelta: 0, acceptedDelta: 0, flaggedDelta: 0, quarantinedDelta: 0 }))
      .rejects.toThrow(MarketDataIntegrityError);
  });

  it('ordinary Error -> SAME object', async () => {
    const errorObj = new Error('Network error');
    fakePrisma.marketDataImportBatch.updateManyAndReturn = async () => {
      throw errorObj;
    };

    await expect(repo.applyProgressDeltaConditional('id', { parsedDelta: 0, acceptedDelta: 0, flaggedDelta: 0, quarantinedDelta: 0 }))
      .rejects.toThrow(errorObj);
  });

  it('typed MarketDataDomainError -> SAME object', async () => {
    const customError = new MarketDataIntegrityError('Custom error');
    fakePrisma.marketDataImportBatch.updateManyAndReturn = async () => {
      throw customError;
    };

    await expect(repo.applyProgressDeltaConditional('id', { parsedDelta: 0, acceptedDelta: 0, flaggedDelta: 0, quarantinedDelta: 0 }))
      .rejects.toThrow(customError);
  });
});
