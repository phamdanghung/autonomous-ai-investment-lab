import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaPortfolioLedgerVerificationRepository } from '../../../src/infrastructure/repositories/portfolio-ledger/PrismaPortfolioLedgerVerificationRepository';
import { PrismaPortfolioLedgerInitializationRepository } from '../../../src/infrastructure/repositories/portfolio-ledger/PrismaPortfolioLedgerInitializationRepository';
import { PrismaPortfolioPostingRepository } from '../../../src/infrastructure/repositories/portfolio-ledger/PrismaPortfolioPostingRepository';
import { setupIsolatedTestSchema, IsolatedTestSchema } from '../../utils/database';
import { randomUUID, randomBytes } from 'crypto';

describe('PrismaPortfolioLedgerVerificationRepository (Concurrency)', () => {
  let ctx: IsolatedTestSchema;
  let prismaA: PrismaClient;
  let prismaB: PrismaClient;
  let initRepo: PrismaPortfolioLedgerInitializationRepository;
  let postRepoB: PrismaPortfolioPostingRepository;

  beforeEach(async () => {
    ctx = await setupIsolatedTestSchema('verify_race');

    prismaA = new PrismaClient({ datasourceUrl: ctx.databaseUrl });
    prismaB = new PrismaClient({ datasourceUrl: ctx.databaseUrl });
    await prismaA.$connect();
    await prismaB.$connect();

    const pidA: any = await prismaA.$queryRaw`SELECT pg_backend_pid() AS pid`;
    const pidB: any = await prismaB.$queryRaw`SELECT pg_backend_pid() AS pid`;
    expect(pidA[0].pid).not.toEqual(pidB[0].pid);

    initRepo = new PrismaPortfolioLedgerInitializationRepository(prismaA);
    postRepoB = new PrismaPortfolioPostingRepository(prismaB);

    // Create instrument
    await prismaA.marketInstrument.create({
      data: { businessKey: 'VN|HOSE|AAA|EQUITY|2026-08-01', exchange: 'HOSE', canonicalSymbol: 'AAA', securityType: 'EQUITY', currency: 'VND', effectiveFrom: new Date('2026-08-01'), sealedAt: new Date('2026-08-01') }
    });
  });

  afterEach(async () => {
    await prismaA.$disconnect();
    await prismaB.$disconnect();
    await ctx.teardown();
  });

  async function createRun() {
    const config = await prismaA.runCoreConfigVersion.create({
      data: {
        contentHash: randomUUID().replace(/-/g, ''),
        mode: 'HISTORICAL_REPLAY',
        initialCapital: 100000000n,
        codeVersion: '1.0.0',
        rngSeed: 1234n,
        fillPolicyVersionKey: 'fill_policy_1',
        orchestrationVersionKey: 'orch_1',
        sealedAt: new Date()
      }
    });

    const run = await prismaA.simulationRun.create({
      data: {
        creationIdempotencyKey: randomUUID(),
        creationRequestHash: randomUUID().replace(/-/g, ''),
        configVersionId: config.id,
        mode: 'HISTORICAL_REPLAY',
        status: 'CONFIGURED',
        dataOriginHash: randomUUID().replace(/-/g, ''),
        canonicalStartDate: new Date('2026-08-01T00:00:00Z'),
        runBusinessKey: randomBytes(32).toString('hex')
      }
    });
    return run;
  }

  it('R1: verify while append commits -> consistent old snapshot only', async () => {
    const run = await createRun();
    await initRepo.initialize({ runId: run.id });
    await prismaA.simulationRun.update({ where: { id: run.id }, data: { status: 'RUNNING', version: { increment: 1 } } });
    const ledger = await prismaA.portfolioLedger.findUnique({ where: { runId: run.id }});

    let resolveVerifierSnapshotEstablished!: () => void;
    const verifierSnapshotEstablished = new Promise<void>(r => resolveVerifierSnapshotEstablished = r);

    let resolveHoldVerifier!: () => void;
    const holdVerifier = new Promise<void>(r => resolveHoldVerifier = r);

    const extA = prismaA.$extends({
      query: {
        simulationRun: {
          async findUnique({ args, query }: any) {
            const result = await query(args);
            resolveVerifierSnapshotEstablished();
            await holdVerifier;
            return result;
          }
        }
      }
    });

    const verifyRepoA = new PrismaPortfolioLedgerVerificationRepository(extA as any);
    const verifyPromise = verifyRepoA.verify({ runId: run.id });

    await verifierSnapshotEstablished;

    await postRepoB.append({
      ledgerId: ledger!.id,
      settlement: {
        sourceExecutionHash: randomBytes(32).toString('hex'),
        instrumentBusinessKey: 'VN|HOSE|AAA|EQUITY|2026-08-01',
        quantityDelta: 100n,
        grossCashDeltaVnd: -1000000n,
        feeVnd: 1000n,
        taxVnd: 0n,
      },
      effectiveDate: '2026-08-02'
    });

    resolveHoldVerifier();

    const snapshotA = await verifyPromise;
    expect(snapshotA.postingCount).toBe(0);
    expect(snapshotA.currentCashBalanceVnd).toBe(100000000n);
    expect(snapshotA.positions.length).toBe(0);
  });

  it('R2: new verification after append commit', async () => {
    const run = await createRun();
    await initRepo.initialize({ runId: run.id });
    await prismaA.simulationRun.update({ where: { id: run.id }, data: { status: 'RUNNING', version: { increment: 1 } } });
    const ledger = await prismaA.portfolioLedger.findUnique({ where: { runId: run.id }});

    await postRepoB.append({
      ledgerId: ledger!.id,
      settlement: {
        sourceExecutionHash: randomBytes(32).toString('hex'),
        instrumentBusinessKey: 'VN|HOSE|AAA|EQUITY|2026-08-01',
        quantityDelta: 100n,
        grossCashDeltaVnd: -1000000n,
        feeVnd: 1000n,
        taxVnd: 0n,
      },
      effectiveDate: '2026-08-02'
    });

    const verifyRepoA = new PrismaPortfolioLedgerVerificationRepository(prismaA);
    const snapshotA = await verifyRepoA.verify({ runId: run.id });
    
    expect(snapshotA.postingCount).toBe(1);
    expect(snapshotA.currentCashBalanceVnd).toBe(98999000n);
    expect(snapshotA.positions.length).toBe(1);
    expect(snapshotA.positions[0].quantity).toBe(100n);
  });

});
