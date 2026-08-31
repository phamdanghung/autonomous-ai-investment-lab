import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { setupIsolatedTestSchema, IsolatedTestSchema } from '../../utils/database';
import { PrismaPortfolioPostingRepository } from '../../../src/infrastructure/repositories/portfolio-ledger/PrismaPortfolioPostingRepository';
import { 
  PortfolioPostingIdempotencyCollisionError
} from '../../../src/application/ports/portfolio-ledger/PortfolioPostingRepositoryPorts';
import { PortfolioLedgerPostingInvalidError } from '../../../src/domain/portfolio-ledger/PortfolioLedgerPosting';
import * as crypto from 'crypto';

async function expectIndependentPostgresSessions(clientA: PrismaClient, clientB: PrismaClient) {
  const resA = await clientA.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
  const resB = await clientB.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
  const pidA = resA[0].pid;
  const pidB = resB[0].pid;
  expect(pidA).toBeDefined();
  expect(pidB).toBeDefined();
  expect(pidA).not.toBe(pidB);
}

describe('Portfolio Posting Concurrency Race', () => {
  let isolated: IsolatedTestSchema;
  let adminPrisma: PrismaClient;

  let validInstrumentBusinessKey: string = 'VN|HOSE|VND|EQUITY|2025-01-01';
  let otherInstrumentBusinessKey: string = 'VN|HOSE|FPT|EQUITY|2025-01-01';

  beforeAll(async () => {
    isolated = await setupIsolatedTestSchema('portfolio_race');
    adminPrisma = new PrismaClient({ datasourceUrl: isolated.databaseUrl });

    // Setup Instruments
    await adminPrisma.marketInstrument.create({
      data: {
        businessKey: validInstrumentBusinessKey,
        exchange: 'HOSE',
        canonicalSymbol: 'VND',
        securityType: 'EQUITY',
        currency: 'VND',
        effectiveFrom: new Date('2025-01-01'),
        sealedAt: new Date()
      }
    });
    
    await adminPrisma.marketInstrument.create({
      data: {
        businessKey: otherInstrumentBusinessKey,
        exchange: 'HOSE',
        canonicalSymbol: 'FPT',
        securityType: 'EQUITY',
        currency: 'VND',
        effectiveFrom: new Date('2025-01-01'),
        sealedAt: new Date()
      }
    });
  });

  afterAll(async () => {
    await adminPrisma.$disconnect();
    await isolated.teardown();
  });

  const createLedger = async () => {
    const runId = crypto.randomUUID();
    const configId = crypto.randomUUID();
    const runBusinessKey = crypto.createHash('sha256').update(runId).digest('hex');
    const dataOriginHash = crypto.createHash('sha256').update(runBusinessKey).digest('hex');

    await adminPrisma.runCoreConfigVersion.create({
      data: {
        id: configId,
        contentHash: crypto.createHash('sha256').update(configId).digest('hex'),
        mode: 'HISTORICAL_REPLAY',
        codeVersion: '1.0.0',
        rngSeed: 12345n,
        fillPolicyVersionKey: 'FILL_1',
        orchestrationVersionKey: 'ORCH_1',
        initialCapital: 100000000n, // 100M VND
        createdAt: new Date(),
      }
    });

    await adminPrisma.simulationRun.create({
      data: {
        id: runId,
        creationIdempotencyKey: 'idk_' + runId,
        creationRequestHash: crypto.createHash('sha256').update(runId).digest('hex'),
        runBusinessKey,
        configVersionId: configId,
        mode: 'HISTORICAL_REPLAY',
        status: 'CONFIGURED',
        canonicalStartDate: new Date('2025-01-01T00:00:00Z'),
        dataOriginHash,
        createdAt: new Date(),
      }
    });

    const genesisHash = crypto.createHash('sha256').update('gen_' + runId).digest('hex');
    
    const ledger = await adminPrisma.portfolioLedger.create({
      data: {
        runId: runId,
        runBusinessKey: runBusinessKey,
        contractVersion: '1.0',
        ledgerKind: 'SIMULATION_PORTFOLIO',
        canonicalStartDate: new Date('2025-01-01T00:00:00Z'),
        currency: 'VND',
        openingCashVnd: 100000000n,
        openingPositionCount: 0,
        genesisHash: genesisHash,
        currentCashBalanceVnd: 100000000n,
        lastEntrySequence: 0n,
        lastEntryHash: genesisHash,
        version: 1
      }
    });
    
    return ledger.id;
  };

  const createBarrierClients = (targetOperations = 2) => {
    let arrived = 0;
    let release: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });

    const clients: PrismaClient[] = [];
    for (let i = 0; i < targetOperations; i++) {
      const client = new PrismaClient({ datasourceUrl: isolated.databaseUrl }).$extends({
        query: {
          $queryRaw(params) {
            // Intercept the FOR UPDATE query
            const sqlStr = typeof params.args === 'string' ? params.args : JSON.stringify(params.args);
            if (sqlStr.includes('FOR UPDATE')) {
              arrived++;
              if (arrived === targetOperations) {
                release();
              }
              return barrier.then(() => params.query(params.args));
            }
            // Also intercept findUnique for precheck so they both get there if precheck hits DB
            return params.query(params.args);
          },
          portfolioLedgerPosting: {
            findUnique(params) {
              arrived++;
              if (arrived === targetOperations) release();
              return barrier.then(() => params.query(params.args));
            }
          }
        }
      }) as PrismaClient;
      clients.push(client);
    }

    return { clients, release: () => { release(); } };
  };

  it('R1: same ledger, same source, equivalent setup', async () => {
    const ledgerId = await createLedger();
    const srcExecHash = crypto.createHash('sha256').update('r1').digest('hex');
    
    const { clients } = createBarrierClients(2);
    await expectIndependentPostgresSessions(clients[0] as PrismaClient, clients[1] as PrismaClient);
    const repo1 = new PrismaPortfolioPostingRepository(clients[0]);
    const repo2 = new PrismaPortfolioPostingRepository(clients[1]);

    const cmd = {
      ledgerId,
      effectiveDate: '2025-01-02',
      settlement: {
        sourceExecutionHash: srcExecHash,
        instrumentBusinessKey: validInstrumentBusinessKey,
        quantityDelta: 1000n,
        grossCashDeltaVnd: -20000000n,
        feeVnd: 0n,
        taxVnd: 0n
      }
    };

    const results = await Promise.allSettled([
      repo1.append(cmd),
      repo2.append(cmd)
    ]);

    await clients[0].$disconnect();
    await clients[1].$disconnect();

    const successes = results.filter(r => r.status === 'fulfilled').map(r => (r as any).value);
    expect(successes.length).toBe(2);
    
    const created = successes.find(s => s.disposition === 'CREATED');
    const replayed = successes.find(s => s.disposition === 'REPLAYED');
    
    expect(created).toBeDefined();
    expect(replayed).toBeDefined();

    const postCount = await adminPrisma.portfolioLedgerPosting.count({ where: { ledgerId } });
    expect(postCount).toBe(1);

    const head = await adminPrisma.portfolioLedger.findUnique({ where: { id: ledgerId } });
    expect(head!.lastEntrySequence).toBe(1n);
    expect(head!.version).toBe(2);
    expect(head!.currentCashBalanceVnd).toBe(80000000n); // 100M - 20M

    const pos = await adminPrisma.portfolioLedgerPosition.findUnique({ where: { ledgerId_instrumentBusinessKey: { ledgerId, instrumentBusinessKey: validInstrumentBusinessKey } } });
    expect(pos!.quantity).toBe(1000n);
    expect(pos!.version).toBe(1);
  });

  it('R2: same ledger, same source, diff settlement -> collision', async () => {
    const ledgerId = await createLedger();
    const srcExecHash = crypto.createHash('sha256').update('r2').digest('hex');
    
    const { clients } = createBarrierClients(2);
    await expectIndependentPostgresSessions(clients[0] as PrismaClient, clients[1] as PrismaClient);
    const repo1 = new PrismaPortfolioPostingRepository(clients[0]);
    const repo2 = new PrismaPortfolioPostingRepository(clients[1]);

    const results = await Promise.allSettled([
      repo1.append({
        ledgerId,
        effectiveDate: '2025-01-02',
        settlement: {
          sourceExecutionHash: srcExecHash,
          instrumentBusinessKey: validInstrumentBusinessKey,
          quantityDelta: 1000n,
          grossCashDeltaVnd: -20000000n,
          feeVnd: 0n,
          taxVnd: 0n
        }
      }),
      repo2.append({
        ledgerId,
        effectiveDate: '2025-01-02',
        settlement: {
          sourceExecutionHash: srcExecHash,
          instrumentBusinessKey: validInstrumentBusinessKey,
          quantityDelta: 2000n, // Diff
          grossCashDeltaVnd: -40000000n,
          feeVnd: 0n,
          taxVnd: 0n
        }
      })
    ]);

    await clients[0].$disconnect();
    await clients[1].$disconnect();

    const successes = results.filter(r => r.status === 'fulfilled');
    const failures = results.filter(r => r.status === 'rejected');
    
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    expect((successes[0] as any).value.disposition).toBe('CREATED');
    expect((failures[0] as any).reason).toBeInstanceOf(PortfolioPostingIdempotencyCollisionError);

    const postCount = await adminPrisma.portfolioLedgerPosting.count({ where: { ledgerId } });
    expect(postCount).toBe(1);

    const head = await adminPrisma.portfolioLedger.findUnique({ where: { id: ledgerId } });
    expect(head!.version).toBe(2);
  });

  it('R3: same ledger, competing BUYs, sufficient for only one', async () => {
    const ledgerId = await createLedger();
    const srcExecHash1 = crypto.createHash('sha256').update('r3_1').digest('hex');
    const srcExecHash2 = crypto.createHash('sha256').update('r3_2').digest('hex');
    
    const { clients } = createBarrierClients(2);
    await expectIndependentPostgresSessions(clients[0] as PrismaClient, clients[1] as PrismaClient);
    const repo1 = new PrismaPortfolioPostingRepository(clients[0]);
    const repo2 = new PrismaPortfolioPostingRepository(clients[1]);

    const results = await Promise.allSettled([
      repo1.append({
        ledgerId,
        effectiveDate: '2025-01-02',
        settlement: {
          sourceExecutionHash: srcExecHash1,
          instrumentBusinessKey: validInstrumentBusinessKey,
          quantityDelta: 1000n,
          grossCashDeltaVnd: -80000000n,
          feeVnd: 0n,
          taxVnd: 0n
        }
      }),
      repo2.append({
        ledgerId,
        effectiveDate: '2025-01-02',
        settlement: {
          sourceExecutionHash: srcExecHash2,
          instrumentBusinessKey: validInstrumentBusinessKey,
          quantityDelta: 1000n,
          grossCashDeltaVnd: -80000000n,
          feeVnd: 0n,
          taxVnd: 0n
        }
      })
    ]);

    await clients[0].$disconnect();
    await clients[1].$disconnect();

    const successes = results.filter(r => r.status === 'fulfilled');
    const failures = results.filter(r => r.status === 'rejected');
    
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    expect((failures[0] as any).reason).toBeInstanceOf(PortfolioLedgerPostingInvalidError);
    
    const head = await adminPrisma.portfolioLedger.findUnique({ where: { id: ledgerId } });
    expect(head!.currentCashBalanceVnd).toBe(20000000n);
    expect(head!.version).toBe(2);

    const postCount = await adminPrisma.portfolioLedgerPosting.count({ where: { ledgerId } });
    expect(postCount).toBe(1);
  });

  it('R4: same ledger/instrument, competing SELLs', async () => {
    const ledgerId = await createLedger();
    const buyHash = crypto.createHash('sha256').update('r4_buy').digest('hex');
    
    // Setup initial position of 100
    const setupRepo = new PrismaPortfolioPostingRepository(adminPrisma);
    await setupRepo.append({
      ledgerId,
      effectiveDate: '2025-01-02',
      settlement: {
        sourceExecutionHash: buyHash,
        instrumentBusinessKey: validInstrumentBusinessKey,
        quantityDelta: 100n,
        grossCashDeltaVnd: -1000000n,
        feeVnd: 0n,
        taxVnd: 0n
      }
    });

    const srcExecHash1 = crypto.createHash('sha256').update('r4_1').digest('hex');
    const srcExecHash2 = crypto.createHash('sha256').update('r4_2').digest('hex');
    
    const { clients } = createBarrierClients(2);
    await expectIndependentPostgresSessions(clients[0] as PrismaClient, clients[1] as PrismaClient);
    const repo1 = new PrismaPortfolioPostingRepository(clients[0]);
    const repo2 = new PrismaPortfolioPostingRepository(clients[1]);

    const results = await Promise.allSettled([
      repo1.append({
        ledgerId,
        effectiveDate: '2025-01-03',
        settlement: {
          sourceExecutionHash: srcExecHash1,
          instrumentBusinessKey: validInstrumentBusinessKey,
          quantityDelta: -100n, // Sell all
          grossCashDeltaVnd: 1000000n,
          feeVnd: 0n,
          taxVnd: 0n
        }
      }),
      repo2.append({
        ledgerId,
        effectiveDate: '2025-01-03',
        settlement: {
          sourceExecutionHash: srcExecHash2,
          instrumentBusinessKey: validInstrumentBusinessKey,
          quantityDelta: -100n, // Sell all
          grossCashDeltaVnd: 1000000n,
          feeVnd: 0n,
          taxVnd: 0n
        }
      })
    ]);

    await clients[0].$disconnect();
    await clients[1].$disconnect();

    const successes = results.filter(r => r.status === 'fulfilled');
    const failures = results.filter(r => r.status === 'rejected');
    
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    expect((failures[0] as any).reason).toBeInstanceOf(PortfolioLedgerPostingInvalidError);

    const pos = await adminPrisma.portfolioLedgerPosition.findUnique({ where: { ledgerId_instrumentBusinessKey: { ledgerId, instrumentBusinessKey: validInstrumentBusinessKey } } });
    expect(pos!.quantity).toBe(0n);
    expect(pos!.version).toBe(2);

    const postCount = await adminPrisma.portfolioLedgerPosting.count({ where: { ledgerId } });
    expect(postCount).toBe(2);
  });

  it('R5: different instruments competing for shared cash', async () => {
    const ledgerId = await createLedger();
    const srcExecHash1 = crypto.createHash('sha256').update('r5_1').digest('hex');
    const srcExecHash2 = crypto.createHash('sha256').update('r5_2').digest('hex');
    
    const { clients } = createBarrierClients(2);
    await expectIndependentPostgresSessions(clients[0] as PrismaClient, clients[1] as PrismaClient);
    const repo1 = new PrismaPortfolioPostingRepository(clients[0]);
    const repo2 = new PrismaPortfolioPostingRepository(clients[1]);

    const results = await Promise.allSettled([
      repo1.append({
        ledgerId,
        effectiveDate: '2025-01-02',
        settlement: {
          sourceExecutionHash: srcExecHash1,
          instrumentBusinessKey: validInstrumentBusinessKey,
          quantityDelta: 1000n,
          grossCashDeltaVnd: -80000000n, // Leaves 20M
          feeVnd: 0n,
          taxVnd: 0n
        }
      }),
      repo2.append({
        ledgerId,
        effectiveDate: '2025-01-02',
        settlement: {
          sourceExecutionHash: srcExecHash2,
          instrumentBusinessKey: otherInstrumentBusinessKey,
          quantityDelta: 1000n,
          grossCashDeltaVnd: -30000000n, // Needs 30M
          feeVnd: 0n,
          taxVnd: 0n
        }
      })
    ]);

    await clients[0].$disconnect();
    await clients[1].$disconnect();

    const successes = results.filter(r => r.status === 'fulfilled');
    const failures = results.filter(r => r.status === 'rejected');
    
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1); // One should fail due to cash lock serialization

    const head = await adminPrisma.portfolioLedger.findUnique({ where: { id: ledgerId } });
    const successfulPosting = (successes[0] as any).value.posting;
    expect(head!.currentCashBalanceVnd).toBe(BigInt(successfulPosting.transition.cashBalanceAfterVnd));

    const postCount = await adminPrisma.portfolioLedgerPosting.count({ where: { ledgerId } });
    expect(postCount).toBe(1);
  });

  it('R6: different ledgers same source -> both succeed independently', async () => {
    const ledger1 = await createLedger();
    const ledger2 = await createLedger();
    const srcExecHash = crypto.createHash('sha256').update('r6').digest('hex');
    
    const { clients, release } = createBarrierClients(2);
    
    await expectIndependentPostgresSessions(clients[0] as PrismaClient, clients[1] as PrismaClient);
    const repo1 = new PrismaPortfolioPostingRepository(clients[0]);
    const repo2 = new PrismaPortfolioPostingRepository(clients[1]);

    const results = await Promise.allSettled([
      repo1.append({
        ledgerId: ledger1,
        effectiveDate: '2025-01-02',
        settlement: {
          sourceExecutionHash: srcExecHash,
          instrumentBusinessKey: validInstrumentBusinessKey,
          quantityDelta: 100n,
          grossCashDeltaVnd: -1000000n,
          feeVnd: 0n,
          taxVnd: 0n
        }
      }),
      repo2.append({
        ledgerId: ledger2,
        effectiveDate: '2025-01-02',
        settlement: {
          sourceExecutionHash: srcExecHash,
          instrumentBusinessKey: validInstrumentBusinessKey,
          quantityDelta: 100n,
          grossCashDeltaVnd: -1000000n,
          feeVnd: 0n,
          taxVnd: 0n
        }
      })
    ]);
    
    await clients[0].$disconnect();
    await clients[1].$disconnect();

    const successes = results.filter(r => r.status === 'fulfilled');
    expect(successes.length).toBe(2);
    expect((successes[0] as any).value.disposition).toBe('CREATED');
    expect((successes[1] as any).value.disposition).toBe('CREATED');

    const postCount1 = await adminPrisma.portfolioLedgerPosting.count({ where: { ledgerId: ledger1 } });
    const postCount2 = await adminPrisma.portfolioLedgerPosting.count({ where: { ledgerId: ledger2 } });
    expect(postCount1).toBe(1);
    expect(postCount2).toBe(1);
  });

  it('R7: second derives fresh head and becomes N+1', async () => {
    const ledgerId = await createLedger();
    const srcExecHash1 = crypto.createHash('sha256').update('r7_1').digest('hex');
    const srcExecHash2 = crypto.createHash('sha256').update('r7_2').digest('hex');
    
    const { clients } = createBarrierClients(2);
    await expectIndependentPostgresSessions(clients[0] as PrismaClient, clients[1] as PrismaClient);
    const repo1 = new PrismaPortfolioPostingRepository(clients[0]);
    const repo2 = new PrismaPortfolioPostingRepository(clients[1]);

    const results = await Promise.allSettled([
      repo1.append({
        ledgerId,
        effectiveDate: '2025-01-02',
        settlement: {
          sourceExecutionHash: srcExecHash1,
          instrumentBusinessKey: validInstrumentBusinessKey,
          quantityDelta: 100n,
          grossCashDeltaVnd: -1000000n,
          feeVnd: 0n,
          taxVnd: 0n
        }
      }),
      repo2.append({
        ledgerId,
        effectiveDate: '2025-01-02',
        settlement: {
          sourceExecutionHash: srcExecHash2,
          instrumentBusinessKey: validInstrumentBusinessKey,
          quantityDelta: 100n,
          grossCashDeltaVnd: -1000000n,
          feeVnd: 0n,
          taxVnd: 0n
        }
      })
    ]);

    await clients[0].$disconnect();
    await clients[1].$disconnect();

    const successes = results.filter(r => r.status === 'fulfilled').map(r => (r as any).value);
    expect(successes.length).toBe(2);
    expect(successes[0].disposition).toBe('CREATED');
    expect(successes[1].disposition).toBe('CREATED');
    
    const seq1 = successes.find(s => s.posting.entry.entrySequence === 1);
    const seq2 = successes.find(s => s.posting.entry.entrySequence === 2);
    
    expect(seq1).toBeDefined();
    expect(seq2).toBeDefined();
    
    expect(seq2!.posting.entry.previousHash).toBe(seq1!.posting.entry.entryHash);
    
    const head = await adminPrisma.portfolioLedger.findUnique({ where: { id: ledgerId } });
    expect(head!.lastEntrySequence).toBe(2n);

    const postCount = await adminPrisma.portfolioLedgerPosting.count({ where: { ledgerId } });
    expect(postCount).toBe(2);
  });
});
