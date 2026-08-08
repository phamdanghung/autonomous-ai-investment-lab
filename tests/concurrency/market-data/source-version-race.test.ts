import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { setupIsolatedTestSchema, IsolatedTestSchema } from '../../../tests/utils/database';
import { PrismaClient } from '@prisma/client';
import { PrismaMarketDataSourceRepository } from '../../../src/infrastructure/repositories/market-data/PrismaMarketDataSourceRepository';
import { RegisterMarketDataSourceVersionService } from '../../../src/application/services/market-data/source-version/RegisterMarketDataSourceVersionService';
import { randomUUID } from 'crypto';

describe('SourceVersion Concurrency', () => {
  let basePrismaA: PrismaClient;
  let basePrismaB: PrismaClient;
  
  
  let isolatedSchema: IsolatedTestSchema;

  beforeEach(async () => {
    isolatedSchema = await setupIsolatedTestSchema('sv_race');
  });

  afterEach(async () => {
    if (basePrismaA) await basePrismaA.$disconnect();
    if (basePrismaB) await basePrismaB.$disconnect();
    if (isolatedSchema) await isolatedSchema.teardown();
  });

  
  it('should handle duplicate race exactly', async () => {
    const url = isolatedSchema.databaseUrl;
    const separator = url.includes('?') ? '&' : '?';
    basePrismaA = new PrismaClient({ datasources: { db: { url: url + separator + 'application_name=race_client_A' } } });
    basePrismaB = new PrismaClient({ datasources: { db: { url: url + separator + 'application_name=race_client_B' } } });

    let readyCount = 0;
    let releaseBarrier: () => void;
    const barrier = new Promise<void>(resolve => { releaseBarrier = resolve; });

    const prismaA = basePrismaA.$extends({
      query: {
        marketDataSourceVersion: {
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
        marketDataSourceVersion: {
          async create({ args, query }) {
            readyCount++;
            if (readyCount === 2) releaseBarrier();
            await barrier;
            return query(args);
          }
        }
      }
    });

    const repoA = new PrismaMarketDataSourceRepository(prismaA as any, 'TEST_FAM');
    const repoB = new PrismaMarketDataSourceRepository(prismaB as any, 'TEST_FAM');
    
    const mockClock = { now: () => new Date('2023-01-01T00:00:00Z') };

    const serviceA = new RegisterMarketDataSourceVersionService(repoA, mockClock, 'TEST_FAM');
    const serviceB = new RegisterMarketDataSourceVersionService(repoB, mockClock, 'TEST_FAM');

    const uniqueHash = randomUUID();
    const request = {
      providerCode: `PROV-${uniqueHash}`,
      datasetKind: 'EOD_MARKET_DATA' as const,
      adapterKind: 'REPOSITORY_CSV_FIXTURE' as const,
      adapterVersion: '1.0',
      schemaVersion: '1.0',
      canonicalizationVersion: '1.0',
      priceUnit: 'VND_PER_SHARE' as const,
      encoding: 'UTF8' as const
    };

    let contractHash: string | undefined;

    const p1 = serviceA.execute(request);
    const p2 = serviceB.execute(request);
    
    const [res1, res2] = await Promise.all([p1, p2]);
    
    expect(readyCount).toBe(2);
    
    const created = [res1, res2].find(r => r.outcome === 'CREATED');
    const replayed = [res1, res2].find(r => r.outcome === 'REPLAYED');
    
    expect(created).toBeDefined();
    expect(replayed).toBeDefined();
    expect(created!.record.sourceKey).toBe(replayed!.record.sourceKey);
    expect(created!.record.contractHash).toBe(replayed!.record.contractHash);
    expect(created!.record.sealedAt).toStrictEqual(replayed!.record.sealedAt);
    
    contractHash = created!.record.contractHash;

    const rows = await basePrismaA.marketDataSourceVersion.findMany({
      where: { contractHash }
    });
    expect(rows.length).toBe(1);
  });
});
