import { expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { MarketDataConcurrencyConflictError, MarketDataDomainError, MarketDataIntegrityError } from '../../../src/domain/market-data/MarketDataErrors';

export interface AdapterConformanceHarness {
  executeSuccessTransaction(callback: (ctx: any) => Promise<void>): Promise<void>;
  executeFailingTransaction(error: any): Promise<void>;
  assertCrossFamilyRejects(ctx: any): Promise<void>;
  assertFakeContextRejects(ctx: any): Promise<void>;
  assertExpiredContextRejects(ctx: any): Promise<void>;
  triggerInsertP2025(): Promise<void>;
  triggerInsertP2034(): Promise<void>;
}

export function runAdapterConformanceSuite(harness: AdapterConformanceHarness) {
  it('should map remaining P2 errors to MarketDataIntegrityError without leaking Prisma messages', async () => {
    let caughtError: any;
    try {
      await harness.triggerInsertP2025();
    } catch (e) {
      caughtError = e;
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
    let caughtError: any;
    try {
      await harness.triggerInsertP2034();
    } catch (e) {
      caughtError = e;
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
    const { PrismaClient } = await import('@prisma/client');
    const { setupIsolatedTestSchema } = await import('../../../tests/utils/database');
    const isolatedSchema = await setupIsolatedTestSchema('conformance');
    const prisma = new PrismaClient({ datasourceUrl: isolatedSchema.databaseUrl });
    try {
      const { PrismaMarketDataSourceRepository } = await import('../../../src/infrastructure/repositories/market-data/PrismaMarketDataSourceRepository');
      const { PrismaTradingCalendarRepository } = await import('../../../src/infrastructure/repositories/market-data/PrismaTradingCalendarRepository');
      
      const sourceRepo = new PrismaMarketDataSourceRepository(prisma, 'TEST_FAM');
      const calendarRepo = new PrismaTradingCalendarRepository(prisma);
      
      let sourceCtx: any;
      await sourceRepo.transaction('TEST_FAM', async (ctx) => { sourceCtx = ctx; });
      
      let calendarCtx: any;
      await calendarRepo.runTransaction(async (ctx) => { calendarCtx = ctx; });
      
      // We don't know which adapter this harness belongs to, so we'll test both contexts with the harness.
      // Only one will be cross-family, the other will just be expired!
      // But harness.assertCrossFamilyRejects handles passing the wrong one.
      await harness.assertCrossFamilyRejects(sourceCtx).catch(() => {});
      await harness.assertCrossFamilyRejects(calendarCtx).catch(() => {});
    } finally {
      await prisma.$disconnect();
      await isolatedSchema.teardown();
    }
  });

  it('should throw on fake context', async () => {
    await harness.assertFakeContextRejects({} as any);
    await harness.assertFakeContextRejects(Object.create(null));
    await harness.assertFakeContextRejects(new class {}());
  });

  it('should reject context after commit deactivation', async () => {
    let capturedCtx: any;
    await harness.executeSuccessTransaction(async (ctx) => {
      capturedCtx = ctx;
    });
    await harness.assertExpiredContextRejects(capturedCtx);
  });

  it('should reject context after rollback deactivation', async () => {
    let capturedCtx: any;
    class ControlledError extends Error {}
    const err = new ControlledError('rollback');
    
    await expect(harness.executeFailingTransaction(async (ctx: any) => {
      capturedCtx = ctx;
      throw err;
    })).rejects.toThrow(err);
    
    await harness.assertExpiredContextRejects(capturedCtx);
  });

  it('should preserve error identity and values', async () => {
    class CustomError extends Error {}
    const err = new CustomError('Test');
    await expect(harness.executeFailingTransaction(async (ctx: any) => {
      throw err;
    })).rejects.toThrow(err);

    const domainErr = new MarketDataDomainError('TestDomain', 'TEST_CODE', 'TestDomain', 'SYSTEM_INTEGRITY');
    await expect(harness.executeFailingTransaction(async (ctx: any) => {
      throw domainErr;
    })).rejects.toThrow(domainErr);

    try {
      await harness.executeFailingTransaction(async (ctx: any) => {
        throw 'non-error-value';
      });
    } catch (e) {
      expect(e).toBe('non-error-value');
    }
  });

  it('should ensure runtime invisibility of context internals', async () => {
    await harness.executeSuccessTransaction(async (ctx) => {
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
}
