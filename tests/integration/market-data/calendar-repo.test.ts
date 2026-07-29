import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaTradingCalendarRepository } from '../../../src/infrastructure/repositories/market-data/PrismaTradingCalendarRepository';
import { PrismaClient, Prisma } from '@prisma/client';
import { MarketDataConcurrencyConflictError, MarketDataDomainError } from '../../../src/domain/market-data/MarketDataErrors';
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

  it('should map P2034 exactly', async () => {
    const err = new Prisma.PrismaClientKnownRequestError('Concurrency error', { code: 'P2034', clientVersion: '4.0.0' });
    const getTxSpy = vi.spyOn(repo as any, 'getTx').mockReturnValue({
      tradingCalendarDay: {
        create: vi.fn().mockRejectedValue(err)
      }
    } as any);
    
    await expect(repo.insertCalendarDay({} as any, { marketDate: '2023-01-01' } as any)).rejects.toThrow(MarketDataConcurrencyConflictError);
    
    getTxSpy.mockRestore();
  });
});
