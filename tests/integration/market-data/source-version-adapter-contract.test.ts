import { describe, expect, beforeAll, afterAll } from 'vitest';
import { setupIsolatedTestSchema, IsolatedTestSchema } from '../../../tests/utils/database';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaMarketDataSourceRepository } from '../../../src/infrastructure/repositories/market-data/PrismaMarketDataSourceRepository';
import { runAdapterConformanceSuite } from '../../contract/market-data/prisma-adapter-conformance';

describe('SourceVersion Adapter Contract', () => {
  let isolatedSchema: IsolatedTestSchema;
  let prisma: PrismaClient;
  let repo: PrismaMarketDataSourceRepository;

  
  beforeAll(async () => {
    isolatedSchema = await setupIsolatedTestSchema('sv_contract');
    prisma = new PrismaClient({ datasourceUrl: isolatedSchema.databaseUrl });
    repo = new PrismaMarketDataSourceRepository(prisma, 'TEST_FAM');
  });

  
  afterAll(async () => {
    await prisma.$disconnect();
    if (isolatedSchema) await isolatedSchema.teardown();
  });

  const triggerP2025 = async () => {
    const rawError = new Prisma.PrismaClientKnownRequestError('RAW PRISMA ENGINE MESSAGE', {
      code: 'P2025',
      clientVersion: 'test-client-version',
      meta: { target: ['secret_database_target'] }
    });
    const validateSpy = (repo as any).validateContext;
    (repo as any).validateContext = () => ({
      marketDataSourceVersion: { create: () => Promise.reject(rawError) }
    });
    try {
      await repo.insert({} as any, {} as any);
    } finally {
      (repo as any).validateContext = validateSpy;
    }
  };

  const triggerP2034 = async () => {
    const rawError = new Prisma.PrismaClientKnownRequestError('RAW PRISMA ENGINE MESSAGE', {
      code: 'P2034',
      clientVersion: 'test-client-version',
      meta: { target: ['secret_database_target'] }
    });
    const validateSpy = (repo as any).validateContext;
    (repo as any).validateContext = () => ({
      marketDataSourceVersion: { create: () => Promise.reject(rawError) }
    });
    try {
      await repo.insert({} as any, {} as any);
    } finally {
      (repo as any).validateContext = validateSpy;
    }
  };

  runAdapterConformanceSuite({
    executeSuccessTransaction: async (cb) => {
      await repo.transaction('TEST_FAM', async (ctx) => {
        await cb(ctx);
      });
    },
    executeFailingTransaction: async (cb) => {
      await repo.transaction('TEST_FAM', async (ctx) => {
        await cb(ctx);
      });
    },
    assertCrossFamilyRejects: async (ctx) => {
      await expect(repo.insert(ctx, {} as any)).rejects.toThrow('Invalid context');
    },
    assertFakeContextRejects: async (ctx) => {
      await expect(repo.insert(ctx, {} as any)).rejects.toThrow('Invalid context');
    },
    assertExpiredContextRejects: async (ctx) => {
      await expect(repo.insert(ctx, {} as any)).rejects.toThrow('Transaction context has expired and cannot be used');
    },
    triggerInsertP2025: triggerP2025,
    triggerInsertP2034: triggerP2034
  });
});
