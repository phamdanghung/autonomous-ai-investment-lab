import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaImportBatchRepository } from '../../../src/infrastructure/repositories/market-data/PrismaImportBatchRepository';
import { RegisterImportBatchCommand } from '../../../src/application/ports/market-data/ImportBatchPorts';
import { MarketDataConcurrencyConflictError, MarketDataIntegrityError, MarketImportIdempotencyConflictError, MarketImportBusinessKeyConflictError, MarketDataDomainError } from '../../../src/domain/market-data/MarketDataErrors';
import { setupIsolatedTestSchema, IsolatedTestSchema } from '../../utils/database';

describe('PrismaImportBatchRepository Integration', () => {
  let prisma: PrismaClient;
  let repo: PrismaImportBatchRepository;
  let isolatedSchema: IsolatedTestSchema;

  // We need a valid source version ID to satisfy the FK constraint
  const testSourceVersionId = `sv-${Date.now()}`;

  beforeAll(async () => {
    isolatedSchema = await setupIsolatedTestSchema('ib_repo');
    prisma = new PrismaClient({ datasourceUrl: isolatedSchema.databaseUrl });
    await prisma.$connect();
    repo = new PrismaImportBatchRepository(prisma);

    // Seed a valid source version so we can test FKs safely
    await prisma.marketDataSourceVersion.create({
      data: {
        id: testSourceVersionId,
        sourceKey: `sk-${Date.now()}`,
        contractHash: `ch-${Date.now()}`,
        providerCode: 'TEST',
        datasetKind: 'EOD_MARKET_DATA',
        adapterKind: 'REPOSITORY_CSV_FIXTURE',
        adapterVersion: '1.0',
        schemaVersion: '1.0',
        canonicalizationVersion: '1.0',
        priceUnit: 'VND_PER_SHARE',
        encoding: 'UTF8',
        sealedAt: new Date(),
      }
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    if (isolatedSchema) {
      await isolatedSchema.teardown();
    }
  });

  const createBaseCommand = (): RegisterImportBatchCommand => {
    const suffix = Date.now().toString() + Math.random().toString().slice(2, 6);
    return {
      creationIdempotencyKey: `idemp-${suffix}`,
      creationRequestHash: `req-hash-${suffix}`,
      batchBusinessKey: `biz-${suffix}`,
      sourceVersionId: testSourceVersionId,
      sourceObjectKey: `obj-${suffix}`,
      sourceContentHash: 'a'.repeat(64),
      sourceByteSize: '100',
      declaredRowCount: 50,
      importMode: 'INITIAL',
      startedAt: new Date(),
    };
  };

  it('should return null when findByCreationIdempotencyKey misses', async () => {
    const result = await repo.findByCreationIdempotencyKey('missing-idemp');
    expect(result).toBeNull();
  });

  it('should return null when findByBatchBusinessKey misses', async () => {
    const result = await repo.findByBatchBusinessKey('missing-biz');
    expect(result).toBeNull();
  });

  it('should create successfully and map physical fields', async () => {
    const command = createBaseCommand();
    const result = await repo.create(command);

    expect(result).toBeDefined();
    expect(result.id).toBeDefined();
    expect(result.creationIdempotencyKey).toBe(command.creationIdempotencyKey);
    expect(result.batchBusinessKey).toBe(command.batchBusinessKey);
    expect(result.creationRequestHash).toBe(command.creationRequestHash);
    expect(result.sourceVersionId).toBe(testSourceVersionId);
    expect(result.status).toBe('PENDING');
    expect(result.importMode).toBe('INITIAL');
    expect(result.parsedRowCount).toBe(0);
    expect(result.acceptedRowCount).toBe(0);
    expect(result.flaggedRowCount).toBe(0);
    expect(result.quarantinedRowCount).toBe(0);

    // Verify it is found by both find methods
    const byIdemp = await repo.findByCreationIdempotencyKey(command.creationIdempotencyKey);
    expect(byIdemp?.id).toBe(result.id);

    const byBiz = await repo.findByBatchBusinessKey(command.batchBusinessKey);
    expect(byBiz?.id).toBe(result.id);
  });

  it('should handle sequential direct-repository idempotency replay', async () => {
    const command = createBaseCommand();
    const result1 = await repo.create(command);
    const result2 = await repo.create(command);
    
    expect(result2.id).toBe(result1.id);
  });

  it('should handle sequential direct-repository idempotency conflict', async () => {
    const command = createBaseCommand();
    await repo.create(command);
    
    // Change hash to trigger conflict
    const conflictingCommand = { ...command, creationRequestHash: 'different-hash' };
    
    await expect(repo.create(conflictingCommand))
      .rejects.toThrow(MarketImportIdempotencyConflictError);
  });

  it('should handle sequential direct-repository business-key replay', async () => {
    const command = createBaseCommand();
    const result1 = await repo.create(command);
    
    // Second call with different idempotency key but same business key to trigger fallback
    const cmd2 = { ...command, creationIdempotencyKey: `idemp-other-${Date.now()}` };
    const result2 = await repo.create(cmd2);
    expect(result2.id).toBe(result1.id);
  });

  it('should handle sequential direct-repository business-key conflict', async () => {
    const command = createBaseCommand();
    await repo.create(command);
    
    // Second call with different idempotency key and different hash
    const cmd2 = { 
      ...command, 
      creationIdempotencyKey: `idemp-other-${Date.now()}`,
      creationRequestHash: 'different-hash' 
    };
    await expect(repo.create(cmd2))
      .rejects.toThrow(MarketImportBusinessKeyConflictError);
  });

  it('should throw MarketDataIntegrityError on real P2003 FK violation', async () => {
    const command = createBaseCommand();
    command.sourceVersionId = 'does-not-exist';
    
    let caughtError: any;
    try {
      await repo.create(command);
    } catch (e) {
      caughtError = e;
    }
    
    expect(caughtError).toBeInstanceOf(MarketDataIntegrityError);
    expect(caughtError.code).toBe('MARKET_DATA_INTEGRITY_ERROR');
    expect(caughtError.category).toBe('SYSTEM_INTEGRITY');
    expect(caughtError.retryable).toBe(false);
  });

  it('should map injected P2034 exactly and not leak Prisma messages', async () => {
    const command = createBaseCommand();
    const rawError = new Prisma.PrismaClientKnownRequestError('RAW PRISMA ENGINE MESSAGE', {
      code: 'P2034',
      clientVersion: 'test-client-version',
      meta: { target: ['secret_database_target'] }
    });
    
    // Inject via a spy on prisma.marketDataImportBatch.create
    const createSpy = vi.spyOn(prisma.marketDataImportBatch, 'create').mockRejectedValue(rawError);
    
    let caughtError: any;
    try {
      await repo.create(command);
    } catch (e) {
      caughtError = e;
    } finally {
      createSpy.mockRestore();
    }
    
    expect(caughtError).toBeInstanceOf(MarketDataConcurrencyConflictError);
    expect(caughtError.code).toBe('MARKET_DATA_CONCURRENCY_CONFLICT');
    expect(caughtError.category).toBe('CONCURRENCY');
    expect(caughtError.retryable).toBe(true);
    expect(caughtError.message).toBe('Concurrent market-data operation conflict.');
    expect(caughtError.safeMessage).toBe('Concurrent market-data operation conflict.');
    
    const msg = caughtError.message + caughtError.safeMessage;
    expect(msg).not.toContain('RAW PRISMA ENGINE MESSAGE');
    expect(msg).not.toContain('P2034');
    expect(msg).not.toContain('clientVersion');
    expect(msg).not.toContain('Prisma');
  });

  it('should map injected unexplained P2002 to integrity error', async () => {
    const command = createBaseCommand();
    const rawError = new Prisma.PrismaClientKnownRequestError('RAW PRISMA P2002', {
      code: 'P2002',
      clientVersion: 'test',
    });
    
    const createSpy = vi.spyOn(prisma.marketDataImportBatch, 'create').mockRejectedValue(rawError);
    // Since neither find by idemp or biz will return anything (unexplained P2002)
    
    let caughtError: any;
    try {
      await repo.create(command);
    } catch (e) {
      caughtError = e;
    } finally {
      createSpy.mockRestore();
    }
    
    expect(caughtError).toBeInstanceOf(MarketDataIntegrityError);
    expect(caughtError.message).toContain('Database integrity error.');
  });

  it('should map remaining P2 errors (e.g. P2025) to MarketDataIntegrityError without leaking Prisma messages', async () => {
    const command = createBaseCommand();
    const rawError = new Prisma.PrismaClientKnownRequestError('RAW PRISMA ENGINE MESSAGE', {
      code: 'P2025',
      clientVersion: 'test-client-version',
      meta: { target: ['secret_database_target'] }
    });
    const createSpy = vi.spyOn(prisma.marketDataImportBatch, 'create').mockRejectedValue(rawError);
    
    let caughtError: any;
    try {
      await repo.create(command);
    } catch (e) {
      caughtError = e;
    } finally {
      createSpy.mockRestore();
    }
    
    expect(caughtError).toBeInstanceOf(MarketDataIntegrityError);
    expect(caughtError.code).toBe('MARKET_DATA_INTEGRITY_ERROR');
    
    const msg = caughtError.message + caughtError.safeMessage;
    expect(msg).not.toContain('RAW PRISMA ENGINE MESSAGE');
    expect(msg).not.toContain('P2025');
  });

  it('should preserve ordinary Error identity', async () => {
    class CustomError extends Error {}
    const err = new CustomError('Test');
    const createSpy = vi.spyOn(prisma.marketDataImportBatch, 'create').mockRejectedValue(err);
    
    await expect(repo.create(createBaseCommand())).rejects.toThrow(err);
    createSpy.mockRestore();
  });

  it('should preserve typed Domain error identity', async () => {
    const domainErr = new MarketDataIntegrityError('TestDomain');
    const createSpy = vi.spyOn(prisma.marketDataImportBatch, 'create').mockRejectedValue(domainErr);
    
    try {
      await repo.create(createBaseCommand());
      throw new Error('Expected to reject.');
    } catch (caught) {
      expect(caught).toBe(domainErr);
    } finally {
      createSpy.mockRestore();
    }
  });
});
