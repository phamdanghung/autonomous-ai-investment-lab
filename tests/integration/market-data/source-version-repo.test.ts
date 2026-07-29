import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaMarketDataSourceRepository } from '../../../src/infrastructure/repositories/market-data/PrismaMarketDataSourceRepository';
import { SourceVersionUniqueCollisionError } from '../../../src/application/ports/market-data/MarketDataSourcePorts';
import { MarketDatasetKind, MarketAdapterKind, MarketPriceUnit, SourceEncoding } from '../../../src/domain/contracts/MarketDataContracts';
import { MarketDataConcurrencyConflictError, MarketDataDomainError } from '../../../src/domain/market-data/MarketDataErrors';

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

    const domainErr = new MarketDataDomainError('TestDomain');
    await expect(repo.transaction('TEST_FAM', async (ctx) => {
      throw domainErr;
    })).rejects.toThrow(domainErr);

    try {
      await repo.transaction('TEST_FAM', async (ctx) => {
        throw 'non-error-value';
      });
    } catch(e) {
      expect(e).toBe('non-error-value');
    }
  });

  it('should map P2034 exactly', async () => {
    await repo.transaction('TEST_FAM', async (ctx) => {
      // Mock inside transaction tx object
      const oldFind = (ctx as any).tx?.marketDataSourceVersion?.findUnique;
      if (oldFind) {
         // this is not safe if we cannot access tx! We CANNOT access tx because it's hidden in a WeakMap!
      }
    });

    // Instead mock the prisma client method globally
    const err = new Prisma.PrismaClientKnownRequestError('Concurrency error', { code: 'P2034', clientVersion: '4.0.0' });
    const validateSpy = vi.spyOn(repo as any, 'validateContext').mockReturnValue({
      marketDataSourceVersion: {
        create: vi.fn().mockRejectedValue(err)
      }
    } as any);
    
    const validVersion = {
      id: 'id3',
      sourceKey: 'key3',
      contractHash: 'hash3',
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
    
    // We don't use transaction here because we mocked validateContext to just return the fake tx.
    // wait, repo.insert requires ctx to be passed, validateContext extracts tx.
    // Since we mocked validateContext, we can pass a dummy context.
    await expect(repo.insert({} as any, validVersion)).rejects.toThrow(MarketDataConcurrencyConflictError);
    
    validateSpy.mockRestore();
  });
});
