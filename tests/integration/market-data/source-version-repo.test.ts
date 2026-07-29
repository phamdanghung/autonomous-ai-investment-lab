import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaMarketDataSourceRepository, SourceVersionUniqueCollisionError } from '../../../src/infrastructure/repositories/market-data/PrismaMarketDataSourceRepository';
import { MarketDatasetKind, MarketAdapterKind, MarketPriceUnit, SourceEncoding } from '../../../src/domain/contracts/MarketDataContracts';

describe('PrismaMarketDataSourceRepository', () => {
  let prisma: PrismaClient;
  let repo: PrismaMarketDataSourceRepository;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    repo = new PrismaMarketDataSourceRepository(prisma, 'TEST_FAM');
    
  });

  afterAll(async () => {
    await prisma.$disconnect();
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

      const listed = await repo.listVersions(ctx, 100);
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
});
