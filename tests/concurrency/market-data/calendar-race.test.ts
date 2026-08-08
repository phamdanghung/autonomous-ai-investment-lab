import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { setupIsolatedTestSchema, IsolatedTestSchema } from '../../../tests/utils/database';
import { PrismaClient } from '@prisma/client';
import { PrismaTradingCalendarRepository } from '../../../src/infrastructure/repositories/market-data/PrismaTradingCalendarRepository';
import { RegisterTradingCalendarDayService } from '../../../src/application/services/market-data/calendar/RegisterTradingCalendarDayService';
import { randomUUID } from 'crypto';
import { MarketDataConcurrencyConflictError } from '../../../src/domain/market-data/MarketDataErrors';
import { PrismaMarketDataSourceRepository } from '../../../src/infrastructure/repositories/market-data/PrismaMarketDataSourceRepository';

describe('TradingCalendar Concurrency', () => {
  let isolatedSchema: IsolatedTestSchema;
  let basePrismaA: PrismaClient;
  let basePrismaB: PrismaClient;
  
  // We need a real sourceVersion inside the test database to attach the calendar days to!
  let testSourceVersionKey: string;
  let testSourceVersionId: string;
  let testSourceVersionContractHash: string;

  beforeEach(async () => {
    isolatedSchema = await setupIsolatedTestSchema('calendar_race');
    const url = isolatedSchema.databaseUrl;
    const separator = url.includes('?') ? '&' : '?';
    basePrismaA = new PrismaClient({ datasources: { db: { url: url + separator + 'application_name=race_client_cal_A' } } });
    basePrismaB = new PrismaClient({ datasources: { db: { url: url + separator + 'application_name=race_client_cal_B' } } });

    testSourceVersionContractHash = 'a'.repeat(64);
    testSourceVersionKey = `VN|MARKET_DATA_SOURCE|${testSourceVersionContractHash}`;

    const inserted = await basePrismaA.marketDataSourceVersion.create({
      data: {
        sourceKey: testSourceVersionKey,
        contractHash: testSourceVersionContractHash,
        providerCode: 'TEST_PROV',
        datasetKind: 'EOD_MARKET_DATA',
        adapterKind: 'REPOSITORY_CSV_FIXTURE',
        adapterVersion: '1.0',
        schemaVersion: '1.0',
        canonicalizationVersion: '1.0',
        priceUnit: 'VND_PER_SHARE',
        encoding: 'UTF8',
        sealedAt: new Date('2023-01-01T00:00:00Z')
      }
    });
    testSourceVersionId = inserted.id;
  });
  afterEach(async () => {
    if (basePrismaA) await basePrismaA.$disconnect();
    if (basePrismaB) await basePrismaB.$disconnect();
    if (isolatedSchema) await isolatedSchema.teardown();
  });  
  it('should handle exact-duplicate race', async () => {
    let readyCount = 0;
    let releaseBarrier: () => void;
    const barrier = new Promise<void>(resolve => { releaseBarrier = resolve; });

    const prismaA = basePrismaA.$extends({
      query: {
        tradingCalendarDay: {
          async create({ args, query }) {
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
        tradingCalendarDay: {
          async create({ args, query }) {
            readyCount++;
            if (readyCount === 2) releaseBarrier();
            await barrier;
            return query(args);
          }
        }
      }
    });

    const repoA = new PrismaTradingCalendarRepository(prismaA as any);
    const repoB = new PrismaTradingCalendarRepository(prismaB as any);
    
    const serviceA = new RegisterTradingCalendarDayService(repoA);
    const serviceB = new RegisterTradingCalendarDayService(repoB);

    const request = {
      sourceVersionKey: testSourceVersionKey,
      exchange: 'HOSE' as const,
      marketDate: '2023-01-01',
      dayType: 'HOLIDAY' as const,
      reason: 'NEW_YEAR'
    };

    const p1 = serviceA.execute(request);
    const p2 = serviceB.execute(request);
    
    const [res1, res2] = await Promise.all([p1, p2]);
    
    expect(readyCount).toBe(2);
    
    const created = [res1, res2].find(r => r.outcome === 'CREATED');
    const replayed = [res1, res2].find(r => r.outcome === 'REPLAYED');
    
    expect(created).toBeDefined();
    expect(replayed).toBeDefined();
    expect(created!.record.canonicalHash).toBe(replayed!.record.canonicalHash);
    
    const rows = await basePrismaA.tradingCalendarDay.findMany({
      where: { sourceVersionId: testSourceVersionId, marketDate: new Date('2023-01-01T00:00:00Z') }
    });
    expect(rows.length).toBe(1);
  });

  it('should handle conflict race', async () => {
    let readyCount = 0;
    let releaseBarrier: () => void;
    const barrier = new Promise<void>(resolve => { releaseBarrier = resolve; });

    const prismaA = basePrismaA.$extends({
      query: {
        tradingCalendarDay: {
          async create({ args, query }) {
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
        tradingCalendarDay: {
          async create({ args, query }) {
            readyCount++;
            if (readyCount === 2) releaseBarrier();
            await barrier;
            return query(args);
          }
        }
      }
    });

    const repoA = new PrismaTradingCalendarRepository(prismaA as any);
    const repoB = new PrismaTradingCalendarRepository(prismaB as any);
    
    const serviceA = new RegisterTradingCalendarDayService(repoA);
    const serviceB = new RegisterTradingCalendarDayService(repoB);

    const request1 = {
      sourceVersionKey: testSourceVersionKey,
      exchange: 'HOSE' as const,
      marketDate: '2023-01-02',
      dayType: 'TRADING_DAY' as const,
      reason: 'REGULAR'
    };

    const request2 = {
      sourceVersionKey: testSourceVersionKey,
      exchange: 'HOSE' as const,
      marketDate: '2023-01-02',
      dayType: 'HOLIDAY' as const,
      reason: 'HOLIDAY'
    };

    const p1 = serviceA.execute(request1);
    const p2 = serviceB.execute(request2);
    
    const results = await Promise.allSettled([p1, p2]);
    
    expect(readyCount).toBe(2);
    
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');
    
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    
    expect(fulfilled[0].status).toBe('fulfilled');
    const res = (fulfilled[0] as any).value;
    expect(res.outcome).toBe('CREATED');

    const err = (rejected[0] as any).reason;
    expect(err).toBeInstanceOf(MarketDataConcurrencyConflictError);
    
    const rows = await basePrismaA.tradingCalendarDay.findMany({
      where: { sourceVersionId: testSourceVersionId, marketDate: new Date('2023-01-02T00:00:00Z') }
    });
    expect(rows.length).toBe(1);
  });
});
