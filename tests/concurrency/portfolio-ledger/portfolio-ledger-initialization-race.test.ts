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

    // Verify separate connections
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
        contentHash: randomBytes(32).toString('hex'),
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
        creationRequestHash: randomBytes(32).toString('hex'),
        configVersionId: configId,
        mode: 'HISTORICAL_REPLAY',
        status: status,
        dataOriginHash: randomBytes(32).toString('hex'),
        canonicalStartDate: new Date('2026-08-01T00:00:00Z'),
        runBusinessKey: randomBytes(32).toString('hex'),
      }
    });
  }

  it('R1 (Same Run Race): One CREATED, one REPLAYED', async () => {
    const config = await createConfig();
    const run = await createRun(config.id);

    // We can simulate race using standard promise all without barriers as well since PG will block on row lock.
    const results = await Promise.all([
      repoA.initialize({ runId: run.id }),
      repoB.initialize({ runId: run.id })
    ]);

    const created = results.find(r => r.disposition === 'CREATED');
    const replayed = results.find(r => r.disposition === 'REPLAYED');

    expect(created).toBeDefined();
    expect(replayed).toBeDefined();

    expect(created!.ledgerId).toBe(replayed!.ledgerId);
    expect(created!.genesis.genesisHash).toBe(replayed!.genesis.genesisHash);

    const count = await prismaA.portfolioLedger.count({ where: { runId: run.id } });
    expect(count).toBe(1);
  });

  it('R2 (Different Runs Race): Both CREATED', async () => {
    const config = await createConfig();
    const run1 = await createRun(config.id);
    const run2 = await createRun(config.id);

    const results = await Promise.all([
      repoA.initialize({ runId: run1.id }),
      repoB.initialize({ runId: run2.id })
    ]);

    expect(results[0].disposition).toBe('CREATED');
    expect(results[1].disposition).toBe('CREATED');

    const count = await prismaA.portfolioLedger.count();
    expect(count).toBe(2);
  });


  
  it('R3 proper', async () => {
    const config = await createConfig();
    const run = await createRun(config.id);
    let promiseA: Promise<any>;

    await prismaB.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM "SimulationRun" WHERE "id" = ${run.id} FOR UPDATE`;
      
      promiseA = repoA.initialize({ runId: run.id });

      await new Promise(r => setTimeout(r, 200));
      
      await tx.$executeRaw`UPDATE "SimulationRun" SET "status" = 'RUNNING', "version" = "version" + 1 WHERE "id" = ${run.id}`;
    });
    
    await expect(promiseA!).rejects.toThrowError(PortfolioLedgerInitializationRunNotReadyError);
  });
});
