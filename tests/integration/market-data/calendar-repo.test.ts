import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaTradingCalendarRepository } from '../../../src/infrastructure/repositories/market-data/PrismaTradingCalendarRepository';
import { PrismaClient, Prisma } from '@prisma/client';
import { MarketDataConcurrencyConflictError, MarketDataDomainError, MarketDataIntegrityError } from '../../../src/domain/market-data/MarketDataErrors';
import { CalendarUniqueCollisionError, CalendarSourceFkViolationError } from '../../../src/application/ports/market-data/TradingCalendarPorts';

describe('PrismaTradingCalendarRepository', () => {
  let prisma: PrismaClient;
  let repo: PrismaTradingCalendarRepository;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    repo = new PrismaTradingCalendarRepository(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('should initialize successfully', () => {
    expect(repo).toBeDefined();
  });

  it('should not expose tx on context object', async () => {
    await repo.runTransaction(async (ctx) => {
      const keys = Object.keys(ctx);
      const props = Object.getOwnPropertyNames(ctx);
      
      expect(keys).not.toContain('_tx');
      expect(props).not.toContain('_tx');
      expect(props).not.toContain('tx');
      
      const desc = Object.getOwnPropertyDescriptors(ctx);
      expect(desc._tx).toBeUndefined();
      
      const str = JSON.stringify(ctx);
      expect(str).not.toContain('_tx');
    });
  });

  it('should preserve error identity and values', async () => {
    class CustomError extends Error {}
    const err = new CustomError('Test');
    await expect(repo.runTransaction(async (ctx) => {
      throw err;
    })).rejects.toThrow(err);

    const domainErr = new MarketDataDomainError('TestDomain');
    await expect(repo.runTransaction(async (ctx) => {
      throw domainErr;
    })).rejects.toThrow(domainErr);

    try {
      await repo.runTransaction(async (ctx) => {
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
    // Mock the actual method
    const getTxSpy = vi.spyOn(repo as any, 'getTx').mockReturnValue({
      tradingCalendarDay: { create: vi.fn().mockRejectedValue(rawError) }
    } as any);
    
    let caughtError: any;
    try {
      await repo.runTransaction(async (ctx) => {
        await repo.insertCalendarDay(ctx, { marketDate: '2023-01-01' } as any);
      });
    } catch (e) {
      caughtError = e;
    } finally {
      getTxSpy.mockRestore();
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
    const getTxSpy = vi.spyOn(repo as any, 'getTx').mockReturnValue({
      tradingCalendarDay: { create: vi.fn().mockRejectedValue(rawError) }
    } as any);
    
    let caughtError: any;
    try {
      await repo.runTransaction(async (ctx) => {
        await repo.insertCalendarDay(ctx, { marketDate: '2023-01-01' } as any);
      });
    } catch (e) {
      caughtError = e;
    } finally {
      getTxSpy.mockRestore();
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
    const { PrismaMarketDataSourceRepository } = await import('../../../src/infrastructure/repositories/market-data/PrismaMarketDataSourceRepository');
    const sourceRepo = new PrismaMarketDataSourceRepository(prisma, 'TEST_FAM');
    
    let sourceCtx: any;
    await sourceRepo.transaction('TEST_FAM', async (ctx) => {
      sourceCtx = ctx;
    });
    
    await expect(repo.findSourceVersionIdByKey(sourceCtx, 'test')).rejects.toThrow('Invalid context');
  });

  it('should throw on fake context', async () => {
    await expect(repo.findSourceVersionIdByKey({} as any, 'test')).rejects.toThrow('Invalid context');
    await expect(repo.findSourceVersionIdByKey(Object.create(null), 'test')).rejects.toThrow('Invalid context');
    await expect(repo.findSourceVersionIdByKey(new class {}(), 'test')).rejects.toThrow('Invalid context');
  });

  it('should reject context after commit deactivation', async () => {
    let capturedCtx: any;
    await repo.runTransaction(async (ctx) => {
      capturedCtx = ctx;
    });
    await expect(repo.findSourceVersionIdByKey(capturedCtx, 'test')).rejects.toThrow('expired');
  });

  it('should reject context after rollback deactivation', async () => {
    let capturedCtx: any;
    class ControlledError extends Error {}
    const err = new ControlledError('rollback');
    
    await expect(repo.runTransaction(async (ctx) => {
      capturedCtx = ctx;
      throw err;
    })).rejects.toThrow(err);
    
    await expect(repo.findSourceVersionIdByKey(capturedCtx, 'test')).rejects.toThrow('expired');
  });

  it('should ensure runtime invisibility of context internals', async () => {
    await repo.runTransaction(async (ctx) => {
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
