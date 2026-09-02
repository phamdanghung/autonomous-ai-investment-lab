import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaPortfolioLedgerInitializationRepository } from '../../../src/infrastructure/repositories/portfolio-ledger/PrismaPortfolioLedgerInitializationRepository';
import { setupIsolatedTestSchema, IsolatedTestSchema } from '../../utils/database';
import { randomUUID, randomBytes } from 'crypto';
import { PortfolioLedgerInitializationRunNotReadyError } from '../../../src/application/ports/portfolio-ledger/PortfolioLedgerInitializationRepositoryPorts';

describe('PrismaPortfolioLedgerInitializationRepository (Concurrency)', () => {
  let ctx: IsolatedTestSchema;
  let prismaA: PrismaClient;
  let prismaB: PrismaClient;
  let repoA: PrismaPortfolioLedgerInitializationRepository;
  let repoB: PrismaPortfolioLedgerInitializationRepository;

  beforeEach(async () => {
    ctx = await setupIsolatedTestSchema('init_race');

    prismaA = new PrismaClient({ datasourceUrl: ctx.databaseUrl });
    prismaB = new PrismaClient({ datasourceUrl: ctx.databaseUrl });

    await prismaA.$connect();
    await prismaB.$connect();

    const pidA: any = await prismaA.$queryRaw`SELECT pg_backend_pid() AS pid`;
    const pidB: any = await prismaB.$queryRaw`SELECT pg_backend_pid() AS pid`;
    expect(pidA[0].pid).not.toEqual(pidB[0].pid);

    repoA = new PrismaPortfolioLedgerInitializationRepository(prismaA);
    repoB = new PrismaPortfolioLedgerInitializationRepository(prismaB);
  });

  afterEach(async () => {
    await prismaA.$disconnect();
    await prismaB.$disconnect();
    await ctx.teardown();
  });

  async function createConfig() {
    return prismaA.runCoreConfigVersion.create({
      data: {
        contentHash: randomUUID().replace(/-/g, ''),
        mode: 'HISTORICAL_REPLAY',
        initialCapital: 100000000n,
        codeVersion: '1.0.0',
        rngSeed: 12345n,
        fillPolicyVersionKey: 'fill_policy_1',
        orchestrationVersionKey: 'orch_1',
        sealedAt: new Date()
      }
    });
  }

  async function createRun(configId: string, status: any = 'CONFIGURED') {
    return prismaA.simulationRun.create({
      data: {
        creationIdempotencyKey: randomUUID(),
        creationRequestHash: randomUUID().replace(/-/g, ''),
        configVersionId: configId,
        mode: 'HISTORICAL_REPLAY',
        status: status,
        dataOriginHash: randomUUID().replace(/-/g, ''),
        canonicalStartDate: new Date('2026-08-01T00:00:00Z'),
        runBusinessKey: randomBytes(32).toString('hex'),
      }
    });
  }

  class QueryBarrier {
    private arrived = 0;
    private readonly target: number;

    private resolveReady!: () => void;
    readonly readyPromise: Promise<void>;

    private resolveRelease!: () => void;
    readonly releasePromise: Promise<void>;

    constructor(target: number) {
      this.target = target;
      this.readyPromise = new Promise((resolve) => { this.resolveReady = resolve; });
      this.releasePromise = new Promise((resolve) => { this.resolveRelease = resolve; });
    }

    async arriveAndWait(): Promise<void> {
      this.arrived++;
      if (this.arrived === this.target) {
        this.resolveReady();
      }
      await this.releasePromise;
    }

    waitUntilReady(): Promise<void> {
      return this.readyPromise;
    }

    release(): void {
      this.resolveRelease();
    }
  }

  it('R1: Same Run Race - One CREATED, one REPLAYED', async () => {
    const config = await createConfig();
    const run = await createRun(config.id);

    const barrier = new QueryBarrier(2);

    const extendedA = prismaA.$extends({
      query: {
        async $queryRaw({ args, query }: any) {
          const sql = args.values ? args.strings.join('?') : args.sql || args.strings?.join('');
          if (sql && sql.includes('FOR UPDATE') && sql.includes('SimulationRun')) {
            await barrier.arriveAndWait();
          }
          return await query(args);
        }
      }
    }) as any;

    const extendedB = prismaB.$extends({
      query: {
        async $queryRaw({ args, query }: any) {
          const sql = args.values ? args.strings.join('?') : args.sql || args.strings?.join('');
          if (sql && sql.includes('FOR UPDATE') && sql.includes('SimulationRun')) {
            await barrier.arriveAndWait();
          }
          return await query(args);
        }
      }
    }) as any;

    const repoExtA = new PrismaPortfolioLedgerInitializationRepository(extendedA);
    const repoExtB = new PrismaPortfolioLedgerInitializationRepository(extendedB);

    const pA = repoExtA.initialize({ runId: run.id });
    const pB = repoExtB.initialize({ runId: run.id });

    await barrier.waitUntilReady();
    barrier.release();

    const results = await Promise.all([pA, pB]);
    const created = results.find(r => r.disposition === 'CREATED');
    const replayed = results.find(r => r.disposition === 'REPLAYED');

    expect(created).toBeDefined();
    expect(replayed).toBeDefined();
    expect(created!.ledgerId).toBe(replayed!.ledgerId);
  });

  it('R2: Different Runs Race - Both CREATED', async () => {
    const config = await createConfig();
    const run1 = await createRun(config.id);
    const run2 = await createRun(config.id);

    const barrier = new QueryBarrier(2);

    const extendedA = prismaA.$extends({
      query: {
        async $queryRaw({ args, query }: any) {
          const sql = args.values ? args.strings.join('?') : args.sql || args.strings?.join('');
          if (sql && sql.includes('FOR SHARE') && sql.includes('RunCoreConfigVersion')) {
            await barrier.arriveAndWait();
          }
          return await query(args);
        }
      }
    }) as any;

    const extendedB = prismaB.$extends({
      query: {
        async $queryRaw({ args, query }: any) {
          const sql = args.values ? args.strings.join('?') : args.sql || args.strings?.join('');
          if (sql && sql.includes('FOR SHARE') && sql.includes('RunCoreConfigVersion')) {
            await barrier.arriveAndWait();
          }
          return await query(args);
        }
      }
    }) as any;

    const repoExtA = new PrismaPortfolioLedgerInitializationRepository(extendedA);
    const repoExtB = new PrismaPortfolioLedgerInitializationRepository(extendedB);

    const pA = repoExtA.initialize({ runId: run1.id });
    const pB = repoExtB.initialize({ runId: run2.id });

    await barrier.waitUntilReady();
    barrier.release();

    const results = await Promise.all([pA, pB]);
    expect(results[0].disposition).toBe('CREATED');
    expect(results[1].disposition).toBe('CREATED');
  });

  it('R3-A: Initializer wins', async () => {
    const config = await createConfig();
    const run = await createRun(config.id);

    const barrier = new QueryBarrier(1);

    const extendedA = prismaA.$extends({
      query: {
        async $queryRaw({ args, query }: any) {
          const sql = args.values ? args.strings.join('?') : args.sql || args.strings?.join('');
          if (sql && sql.includes('FOR SHARE') && sql.includes('RunCoreConfigVersion')) {
            await barrier.arriveAndWait();
          }
          return await query(args);
        }
      }
    }) as any;

    const repoExtA = new PrismaPortfolioLedgerInitializationRepository(extendedA);

    // Start initializer
    const pA = repoExtA.initialize({ runId: run.id });

    // Wait until initializer has acquired Run lock and arrived at Config lock
    await barrier.waitUntilReady();

    // Now start the competing status transition in B (it will block because A holds the Run lock)
    // Using safe tagged Prisma SQL
    const pB = prismaB.$executeRaw`
      UPDATE "SimulationRun"
      SET "status" = 'RUNNING', "version" = "version" + 1
      WHERE "id" = ${run.id} AND "status" = 'CONFIGURED' AND "version" = 1
    `;

    // Release A to finish
    barrier.release();

    const rA = await pA;
    expect(rA.disposition).toBe('CREATED');

    await pB; // Transition completes AFTER A

    const count = await prismaA.portfolioLedger.count({ where: { runId: run.id } });
    expect(count).toBe(1);

    const checkRun = await prismaA.simulationRun.findUnique({ where: { id: run.id } });
    expect(checkRun!.status).toBe('RUNNING');
  });

  it('R3-B: Status Transition wins', async () => {
    const config = await createConfig();
    const run = await createRun(config.id);

    let resolveTransitionHasRunLock!: () => void;
    const transitionHasRunLock = new Promise<void>(r => { resolveTransitionHasRunLock = r; });

    let resolveInitializerAttemptedRunLock!: () => void;
    const initializerAttemptedRunLock = new Promise<void>(r => { resolveInitializerAttemptedRunLock = r; });

    // Start Transition B
    const pB = prismaB.$transaction(async (tx) => {
      // 1. B locks the run using safe tagged query
      await tx.$queryRaw`
        SELECT "id"
        FROM "SimulationRun"
        WHERE "id" = ${run.id}
        FOR UPDATE
      `;

      // 2. Signal that B has locked
      resolveTransitionHasRunLock();

      // 3. Wait until A has tried to lock and is blocking
      await initializerAttemptedRunLock;

      // 4. Perform the transition using CAS tagged query
      const affected = await tx.$executeRaw`
        UPDATE "SimulationRun"
        SET "status" = 'RUNNING', "version" = "version" + 1
        WHERE "id" = ${run.id} AND "status" = 'CONFIGURED' AND "version" = 1
      `;
      expect(affected).toBe(1);
    });

    // Wait for B to lock
    await transitionHasRunLock;

    const extendedA = prismaA.$extends({
      query: {
        async $queryRaw({ args, query }: any) {
          const sql = args.values ? args.strings.join('?') : args.sql || args.strings?.join('');
          if (sql && sql.includes('FOR UPDATE') && sql.includes('SimulationRun')) {
            // Signal before executing query (which will block)
            resolveInitializerAttemptedRunLock();
          }
          return await query(args);
        }
      }
    }) as any;

    const repoExtA = new PrismaPortfolioLedgerInitializationRepository(extendedA);

    // Now start initializer in A (it will block)
    const pA = repoExtA.initialize({ runId: run.id });

    await pB; // B completes

    await expect(pA).rejects.toThrowError(PortfolioLedgerInitializationRunNotReadyError);

    const count = await prismaA.portfolioLedger.count({ where: { runId: run.id } });
    expect(count).toBe(0);

    const checkRun = await prismaA.simulationRun.findUnique({ where: { id: run.id } });
    expect(checkRun!.status).toBe('RUNNING');
  });

});
