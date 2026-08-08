import { describe, expect, beforeAll, afterAll } from 'vitest';
import { setupIsolatedTestSchema, IsolatedTestSchema } from '../../../tests/utils/database';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaTradingCalendarRepository } from '../../../src/infrastructure/repositories/market-data/PrismaTradingCalendarRepository';
import { runAdapterConformanceSuite } from '../../contract/market-data/prisma-adapter-conformance';

describe('TradingCalendar Adapter Contract', () => {
  let isolatedSchema: IsolatedTestSchema;
  let prisma: PrismaClient;
  let repo: PrismaTradingCalendarRepository;

  
  beforeAll(async () => {
    isolatedSchema = await setupIsolatedTestSchema('cal_contract');
    prisma = new PrismaClient({ datasourceUrl: isolatedSchema.databaseUrl });
    repo = new PrismaTradingCalendarRepository(prisma);
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
    const validateSpy = (repo as any).getTx;
    (repo as any).getTx = () => ({
      tradingCalendarDay: { create: () => Promise.reject(rawError) }
    });
    try {
      await repo.runTransaction(async (ctx) => {
        await repo.insertCalendarDay(ctx, { marketDate: '2023-01-01' } as any);
      });
    } finally {
      (repo as any).getTx = validateSpy;
    }
  };

  const triggerP2034 = async () => {
    const rawError = new Prisma.PrismaClientKnownRequestError('RAW PRISMA ENGINE MESSAGE', {
      code: 'P2034',
      clientVersion: 'test-client-version',
      meta: { target: ['secret_database_target'] }
    });
    const validateSpy = (repo as any).getTx;
    (repo as any).getTx = () => ({
      tradingCalendarDay: { create: () => Promise.reject(rawError) }
    });
    try {
      await repo.runTransaction(async (ctx) => {
        await repo.insertCalendarDay(ctx, { marketDate: '2023-01-01' } as any);
      });
    } finally {
      (repo as any).getTx = validateSpy;
    }
  };

  runAdapterConformanceSuite({
    executeSuccessTransaction: async (cb) => {
      await repo.runTransaction(async (ctx) => {
        await cb(ctx);
      });
    },
    executeFailingTransaction: async (cb) => {
      await repo.runTransaction(async (ctx) => {
        await cb(ctx);
      });
    },
    assertCrossFamilyRejects: async (ctx) => {
      await expect(repo.insertCalendarDay(ctx, { marketDate: '2023-01-01' } as any)).rejects.toThrow('Invalid context');
    },
    assertFakeContextRejects: async (ctx) => {
      await expect(repo.insertCalendarDay(ctx, { marketDate: '2023-01-01' } as any)).rejects.toThrow('Invalid context');
    },
    assertExpiredContextRejects: async (ctx) => {
      await expect(repo.insertCalendarDay(ctx, { marketDate: '2023-01-01' } as any)).rejects.toThrow('Transaction context has expired and cannot be used');
    },
    triggerInsertP2025: triggerP2025,
    triggerInsertP2034: triggerP2034
  });
});
