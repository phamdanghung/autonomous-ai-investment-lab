import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaMarketDataSourceRepository } from '../../../src/infrastructure/repositories/market-data/PrismaMarketDataSourceRepository';
import { SourceVersionUniqueCollisionError, IMarketDataSourceContext } from '../../../src/application/ports/market-data/MarketDataSourcePorts';
import { MarketDatasetKind, MarketAdapterKind, MarketPriceUnit, SourceEncoding } from '../../../src/domain/contracts/MarketDataContracts';
import { MarketDataConcurrencyConflictError, MarketDataDomainError, MarketDataIntegrityError } from '../../../src/domain/market-data/MarketDataErrors';
import { setupIsolatedTestSchema, IsolatedTestSchema } from '../../utils/database';
describe('PrismaMarketDataSourceRepository', () => {
  let prisma: PrismaClient;
  let repo: PrismaMarketDataSourceRepository;
  let isolatedSchema: IsolatedTestSchema;

  beforeAll(async () => {
    isolatedSchema = await setupIsolatedTestSchema('source-version-repo');
    prisma = new PrismaClient({ datasourceUrl: isolatedSchema.databaseUrl });
    await prisma.$connect();
    repo = new PrismaMarketDataSourceRepository(prisma, 'TEST_FAM');
    
  });

  afterAll(async () => {
    await prisma.$disconnect();
    if (isolatedSchema) {
      await isolatedSchema.teardown();
    }
  });

  it('should insert and list', async () => {
    const testId = `id-${Date.now()}`;
    const testKey = `key-${Date.now()}`;
    const testHash = `hash-${Date.now()}`;

    const version = {
      id: testId,
      sourceKey: testKey,
      contractHash: testHash,
      providerCode: 'TEST',
      datasetKind: "EOD_MARKET_DATA" as any,
      sealedAt: new Date(),
      adapterKind: "REPOSITORY_CSV_FIXTURE" as any,
      adapterVersion: '1.0',
      schemaVersion: '1.0',
      canonicalizationVersion: '1.0',
      priceUnit: "VND_PER_SHARE" as any,
      encoding: "UTF8" as any,
    };

    await repo.transaction('TEST_FAM', async (ctx) => {
      await repo.insert(ctx, version);
    });

    await repo.transaction('TEST_FAM', async (ctx) => {
      const found = await repo.findBySourceKey(ctx, testKey);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(testId);

      const listed = await repo.listVersions(ctx, 10000);
      expect(listed.length).toBeGreaterThan(0);
      expect(listed.some(x => x.sourceVersion.id === testId)).toBe(true);
    });
  });

  it('should reject fake contexts', async () => {
    const testKey = `key-${Date.now()}`;

    await expect(repo.findBySourceKey({ _family: 'TEST_FAM' } as any, testKey)).rejects.toThrow('Invalid context');
  });

  it('should throw SourceVersionUniqueCollisionError on P2002', async () => {
    const testId = `id2-${Date.now()}`;
    const testKey = `key2-${Date.now()}`;
    const testHash = `hash2-${Date.now()}`;

    const version = {
      id: testId,
      sourceKey: testKey,
      contractHash: testHash,
      providerCode: 'TEST',
      datasetKind: "EOD_MARKET_DATA" as any,
      sealedAt: new Date(),
      adapterKind: "REPOSITORY_CSV_FIXTURE" as any,
      adapterVersion: '1.0',
      schemaVersion: '1.0',
      canonicalizationVersion: '1.0',
      priceUnit: "VND_PER_SHARE" as any,
      encoding: "UTF8" as any,
    };

    await repo.transaction('TEST_FAM', async (ctx) => {
      await repo.insert(ctx, version);
    });

    await expect(
      repo.transaction('TEST_FAM', async (ctx) => {
        // use same key, different id
        await repo.insert(ctx, { ...version, id: testId });
      })
    ).rejects.toThrow(SourceVersionUniqueCollisionError);
  });

  it('should not expose tx or family on context object', async () => {
    await repo.transaction('TEST_FAM', async (ctx) => {
      const keys = Object.keys(ctx);
      const props = Object.getOwnPropertyNames(ctx);
      const syms = Object.getOwnPropertySymbols(ctx);
      
      expect(keys).not.toContain('_tx');
      expect(keys).not.toContain('_family');
      expect(props).not.toContain('_tx');
      expect(props).not.toContain('_family');
      expect(props).not.toContain('tx');
      
      const desc = Object.getOwnPropertyDescriptors(ctx);
      expect(desc._tx).toBeUndefined();
      expect(desc._family).toBeUndefined();
      
      const str = JSON.stringify(ctx);
      expect(str).not.toContain('_tx');
      expect(str).not.toContain('_family');
    });
  });

  it('should preserve error identity and values', async () => {
    class CustomError extends Error {}
    const err = new CustomError('Test');
    await expect(repo.transaction('TEST_FAM', async (ctx) => {
      throw err;
    })).rejects.toThrow(err);

    const domainErr = new MarketDataIntegrityError('TestDomain');
    try {
      await repo.transaction('TEST_FAM', async (ctx) => {
        throw domainErr;
      });
      throw new Error('Expected transaction to reject.');
    } catch (caught) {
      expect(caught).toBe(domainErr);
    }

    try {
      await repo.transaction('TEST_FAM', async (ctx) => {
        throw 'non-error-value';
      });
    } catch(e) {
      expect(e).toBe('non-error-value');
    }
  });

  it('should map remaining P2 errors to MarketDataIntegrityError without leaking Prisma messages', async () => {
    const rawError = new Prisma.PrismaClientKnownRequestError('RAW PRISMA ENGINE MESSAGE', {
      code: 'P2025',
      clientVersion: 'test-client-version',
      meta: { target: ['secret_database_target'] }
    });
    const validateSpy = vi.spyOn(repo as any, 'validateContext').mockReturnValue({
      marketDataSourceVersion: { create: vi.fn().mockRejectedValue(rawError) }
    } as any);
    
    let caughtError: any;
    try {
      await repo.insert({} as any, {} as any);
    } catch (e) {
      caughtError = e;
    } finally {
      validateSpy.mockRestore();
    }
    
    expect(caughtError).toBeInstanceOf(MarketDataIntegrityError);
    expect(caughtError.code).toBe('MARKET_DATA_INTEGRITY_ERROR');
    expect(caughtError.category).toBe('SYSTEM_INTEGRITY');
    expect(caughtError.retryable).toBe(false);
    expect(caughtError.safeMessage).toBe('A data integrity error occurred.');
    
    const msg = caughtError.message + caughtError.safeMessage;
    expect(msg).not.toContain('RAW PRISMA ENGINE MESSAGE');
    expect(msg).not.toContain('P2025');
    expect(msg).not.toContain('test-client-version');
    expect(msg).not.toContain('secret_database_target');
    expect(msg).not.toContain('Prisma');
  });

  it('should map P2034 exactly and not leak Prisma messages', async () => {
    const rawError = new Prisma.PrismaClientKnownRequestError('RAW PRISMA ENGINE MESSAGE', {
      code: 'P2034',
      clientVersion: 'test-client-version',
      meta: { target: ['secret_database_target'] }
    });
    const validateSpy = vi.spyOn(repo as any, 'validateContext').mockReturnValue({
      marketDataSourceVersion: { create: vi.fn().mockRejectedValue(rawError) }
    } as any);
    
    let caughtError: any;
    try {
      await repo.insert({} as any, {} as any);
    } catch (e) {
      caughtError = e;
    } finally {
      validateSpy.mockRestore();
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
    expect(msg).not.toContain('meta');
    expect(msg).not.toContain('target');
    expect(msg).not.toContain('Prisma');
  });

  it('should throw on cross-family context', async () => {
    const { PrismaTradingCalendarRepository } = await import('../../../src/infrastructure/repositories/market-data/PrismaTradingCalendarRepository');
    const calendarRepo = new PrismaTradingCalendarRepository(prisma);
    
    let calendarCtx: any;
    await calendarRepo.runTransaction(async (ctx) => {
      calendarCtx = ctx;
    });
    
    await expect(repo.findBySourceKey(calendarCtx, 'test')).rejects.toThrow('Invalid context');
  });

  it('should throw on fake context', async () => {
    await expect(repo.findBySourceKey({} as any, 'test')).rejects.toThrow('Invalid context');
    await expect(repo.findBySourceKey(Object.create(null), 'test')).rejects.toThrow('Invalid context');
    await expect(repo.findBySourceKey(new class {}() as unknown as IMarketDataSourceContext, 'test')).rejects.toThrow('Invalid context');
  });

  it('should reject context after commit deactivation', async () => {
    let capturedCtx: any;
    await repo.transaction('TEST_FAM', async (ctx) => {
      capturedCtx = ctx;
    });
    await expect(repo.findBySourceKey(capturedCtx, 'test')).rejects.toThrow('expired');
  });

  it('should reject context after rollback deactivation', async () => {
    let capturedCtx: any;
    class ControlledError extends Error {}
    const err = new ControlledError('rollback');
    
    await expect(repo.transaction('TEST_FAM', async (ctx) => {
      capturedCtx = ctx;
      throw err;
    })).rejects.toThrow(err);
    
    await expect(repo.findBySourceKey(capturedCtx, 'test')).rejects.toThrow('expired');
  });

  it('should ensure runtime invisibility of context internals', async () => {
    await repo.transaction('TEST_FAM', async (ctx) => {
      expect(Object.keys(ctx)).toEqual([]);
      expect(Object.getOwnPropertyNames(ctx)).toEqual([]);
      expect(Object.getOwnPropertySymbols(ctx)).toEqual([]);
      expect(Object.getOwnPropertyDescriptors(ctx)).toEqual({});
      expect(JSON.stringify(ctx)).toBe('{}');
      
      const str = String(ctx) + JSON.stringify(ctx);
      expect(str).not.toContain('_tx');
      expect(str).not.toContain('_family');
      expect(str).not.toContain('_ownerToken');
      expect(str).not.toContain('_active');
      expect(str).not.toContain('tx');
      expect(str).not.toContain('client');
      expect(str).not.toContain('prisma');
      expect(str).not.toContain('token');
      expect(str).not.toContain('active');
    });
  });
});
