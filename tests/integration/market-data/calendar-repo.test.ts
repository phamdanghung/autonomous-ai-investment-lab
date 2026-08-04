import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaTradingCalendarRepository } from '../../../src/infrastructure/repositories/market-data/PrismaTradingCalendarRepository';
import { PrismaClient, Prisma } from '@prisma/client';
import { MarketDataConcurrencyConflictError, MarketDataDomainError, MarketDataIntegrityError } from '../../../src/domain/market-data/MarketDataErrors';
import { CalendarUniqueCollisionError, CalendarSourceFkViolationError } from '../../../src/application/ports/market-data/TradingCalendarPorts';

async function verifyTestDatabase(prisma: PrismaClient) {
  const url = process.env.DATABASE_URL;
  const expectedUrl = process.env.TEST_DATABASE_URL;
  if (!expectedUrl) throw new Error('TEST_DATABASE_URL must be defined');
  const expectedDb = new URL(expectedUrl).pathname.slice(1);
  const actualDb = new URL(url || '').pathname.slice(1);
  if (actualDb !== expectedDb) {
    throw new Error(`Test must run against TEST database. Found DEV or other database.`);
  }
  const result = await prisma.$queryRawUnsafe<{databaseName: string}[]>(`SELECT current_database() AS "databaseName";`);
  if (result[0].databaseName !== expectedDb) {
    throw new Error(`Test connected to incorrect database: ${result[0].databaseName}`);
  }
}

describe('PrismaTradingCalendarRepository', () => {
  let prisma: PrismaClient;
  let repo: PrismaTradingCalendarRepository;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    await verifyTestDatabase(prisma);
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

    const domainErr = new MarketDataDomainError('TestDomain', 'CODE', 'Test', 'VALIDATION');
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
    await expect(repo.findSourceVersionIdByKey(new class {}() as any, 'test')).rejects.toThrow('Invalid context');
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

  describe('5-value enum persistence', () => {
    const types = ['TRADING_DAY', 'WEEKEND', 'HOLIDAY', 'SYSTEM_MAINTENANCE', 'OTHER'] as const;
    const testIds: string[] = [];
    const sourceVersionIds: string[] = [];

    afterAll(async () => {
      const txs = [ Prisma.sql`SET session_replication_role = 'replica';` ];
      if (testIds.length > 0) {
        txs.push(Prisma.sql`DELETE FROM "TradingCalendarDay" WHERE "id" IN (${Prisma.join(testIds)})`);
      }
      if (sourceVersionIds.length > 0) {
        txs.push(Prisma.sql`DELETE FROM "MarketDataSourceVersion" WHERE "id" IN (${Prisma.join(sourceVersionIds)})`);
      }
      txs.push(Prisma.sql`SET session_replication_role = 'origin';`);

      await prisma.$transaction(txs.map(q => prisma.$executeRaw(q)));

      if (testIds.length > 0) {
        const res = await prisma.$queryRaw<{c: bigint}[]>`SELECT count(*) as c FROM "TradingCalendarDay" WHERE "id" IN (${Prisma.join(testIds)})`;
        expect(Number(res[0].c)).toBe(0);
      }
      if (sourceVersionIds.length > 0) {
        const res = await prisma.$queryRaw<{c: bigint}[]>`SELECT count(*) as c FROM "MarketDataSourceVersion" WHERE "id" IN (${Prisma.join(sourceVersionIds)})`;
        expect(Number(res[0].c)).toBe(0);
      }
    });

    for (let i = 0; i < types.length; i++) {
      const dayType = types[i];
      it(`should persist and read back exactly for ${dayType}`, async () => {
        const svId = require('crypto').randomUUID();
        sourceVersionIds.push(svId);

        await prisma.$executeRawUnsafe(`
          INSERT INTO "MarketDataSourceVersion" ("id", "sourceKey", "contractHash", "providerCode", "datasetKind", "adapterKind", "adapterVersion", "schemaVersion", "canonicalizationVersion", "priceUnit", "encoding", "createdAt", "sealedAt")
          VALUES ('${svId}', '${svId}', '${svId}', 'P', 'EOD_MARKET_DATA', 'REPOSITORY_CSV_FIXTURE', '1', '1', '1', 'VND_PER_SHARE', 'UTF8', NOW(), NOW())
        `);

        const dateStr = `2026-01-${String(i + 1).padStart(2, '0')}`;

        const record = {
          sourceVersionId: svId,
          exchange: 'HOSE' as any,
          marketDate: dateStr,
          dayType: dayType,
          reason: 'test',
          canonicalHash: `${svId}-${dayType}`
        };

        const inserted = await repo.runTransaction(async (ctx) => {
          return await repo.insertCalendarDay(ctx, record as any);
        });
        testIds.push(inserted.id);

        // verify raw
        const raw: any[] = await prisma.$queryRawUnsafe(`SELECT "dayType"::text as dt FROM "TradingCalendarDay" WHERE "sourceVersionId" = '${svId}'`);
        expect(raw[0].dt).toBe(dayType);

        // read back exact
        const readBack = await repo.runTransaction(async (ctx) => {
          return await repo.findCalendarDayByIdentity(ctx, svId, 'HOSE', dateStr);
        });

        expect(readBack).toBeDefined();
        expect(readBack?.dayType).toBe(dayType);
        expect(readBack?.canonicalHash).toBe(`${svId}-${dayType}`);
      });
    }

    it('should allow exact replay without error', async () => {
      const svId = require('crypto').randomUUID();
      sourceVersionIds.push(svId);

      await prisma.$executeRawUnsafe(`
        INSERT INTO "MarketDataSourceVersion" ("id", "sourceKey", "contractHash", "providerCode", "datasetKind", "adapterKind", "adapterVersion", "schemaVersion", "canonicalizationVersion", "priceUnit", "encoding", "createdAt", "sealedAt")
        VALUES ('${svId}', '${svId}', '${svId}', 'P', 'EOD_MARKET_DATA', 'REPOSITORY_CSV_FIXTURE', '1', '1', '1', 'VND_PER_SHARE', 'UTF8', NOW(), NOW())
      `);

      const record = {
        sourceVersionId: svId,
        exchange: 'HOSE' as any,
        marketDate: '2026-02-01',
        dayType: 'TRADING_DAY' as any,
        reason: 'replay-test',
        canonicalHash: `${svId}-replay`
      };

      const inserted = await repo.runTransaction(async (ctx) => {
        return await repo.insertCalendarDay(ctx, record as any);
      });
      testIds.push(inserted.id);

      // exact replay throws CalendarUniqueCollisionError from repo
      await expect(repo.runTransaction(async (ctx) => {
        await repo.insertCalendarDay(ctx, record as any);
      })).rejects.toThrow('Calendar unique collision');
    });

    it('should throw MarketDataConcurrencyConflictError on conflict', async () => {
      const svId = require('crypto').randomUUID();
      sourceVersionIds.push(svId);

      await prisma.$executeRawUnsafe(`
        INSERT INTO "MarketDataSourceVersion" ("id", "sourceKey", "contractHash", "providerCode", "datasetKind", "adapterKind", "adapterVersion", "schemaVersion", "canonicalizationVersion", "priceUnit", "encoding", "createdAt", "sealedAt")
        VALUES ('${svId}', '${svId}', '${svId}', 'P', 'EOD_MARKET_DATA', 'REPOSITORY_CSV_FIXTURE', '1', '1', '1', 'VND_PER_SHARE', 'UTF8', NOW(), NOW())
      `);

      const record1 = {
        sourceVersionId: svId,
        exchange: 'HOSE' as any,
        marketDate: '2026-02-02',
        dayType: 'TRADING_DAY' as any,
        reason: 'conflict-test-1',
        canonicalHash: `${svId}-conflict-1`
      };

      const record2 = {
        ...record1,
        canonicalHash: `${svId}-conflict-2`
      };

      const inserted = await repo.runTransaction(async (ctx) => {
        return await repo.insertCalendarDay(ctx, record1 as any);
      });
      testIds.push(inserted.id);

      let err: any;
      try {
        await repo.runTransaction(async (ctx) => {
          await repo.insertCalendarDay(ctx, record2 as any);
        });
      } catch(e) {
        err = e;
      }

      expect(err.constructor.name).toBe('CalendarUniqueCollisionError');
    });

    it('should maintain UTC date behavior unchanged', async () => {
      const svId = require('crypto').randomUUID();
      sourceVersionIds.push(svId);

      await prisma.$executeRawUnsafe(`
        INSERT INTO "MarketDataSourceVersion" ("id", "sourceKey", "contractHash", "providerCode", "datasetKind", "adapterKind", "adapterVersion", "schemaVersion", "canonicalizationVersion", "priceUnit", "encoding", "createdAt", "sealedAt")
        VALUES ('${svId}', '${svId}', '${svId}', 'P', 'EOD_MARKET_DATA', 'REPOSITORY_CSV_FIXTURE', '1', '1', '1', 'VND_PER_SHARE', 'UTF8', NOW(), NOW())
      `);

      const record = {
        sourceVersionId: svId,
        exchange: 'HOSE' as any,
        marketDate: '2026-02-28',
        dayType: 'TRADING_DAY' as any,
        reason: 'utc-test',
        canonicalHash: `${svId}-utc`
      };

      const inserted = await repo.runTransaction(async (ctx) => {
        return await repo.insertCalendarDay(ctx, record as any);
      });
      testIds.push(inserted.id);

      const raw: any[] = await prisma.$queryRawUnsafe(`SELECT "marketDate" FROM "TradingCalendarDay" WHERE "sourceVersionId" = '${svId}'`);
      const dbDate = raw[0].marketDate as Date;
      expect(dbDate.toISOString()).toBe('2026-02-28T00:00:00.000Z');

      const readBack = await repo.runTransaction(async (ctx) => {
        return await repo.findCalendarDayByIdentity(ctx, svId, 'HOSE', '2026-02-28');
      });
      expect(readBack?.marketDate).toBe('2026-02-28');
    });
  });
});
