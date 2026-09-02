import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPortfolioLedgerVerificationRepository } from '../../../src/infrastructure/repositories/portfolio-ledger/PrismaPortfolioLedgerVerificationRepository';
import { PrismaPortfolioLedgerInitializationRepository } from '../../../src/infrastructure/repositories/portfolio-ledger/PrismaPortfolioLedgerInitializationRepository';
import { PrismaPortfolioPostingRepository } from '../../../src/infrastructure/repositories/portfolio-ledger/PrismaPortfolioPostingRepository';
import { setupIsolatedTestSchema, IsolatedTestSchema } from '../../utils/database';
import { randomUUID, randomBytes } from 'crypto';
import {
  PortfolioLedgerVerificationIntegrityError,
  PortfolioLedgerVerificationRunNotFoundError,
  PortfolioLedgerVerificationLedgerNotFoundError,
  PortfolioLedgerVerificationConcurrencyError
} from '../../../src/application/ports/portfolio-ledger/PortfolioLedgerVerificationRepositoryPorts';

describe('PrismaPortfolioLedgerVerificationRepository', () => {
  let ctx: IsolatedTestSchema;
  let prisma: PrismaClient;
  let verifyRepo: PrismaPortfolioLedgerVerificationRepository;
  let initRepo: PrismaPortfolioLedgerInitializationRepository;
  let postRepo: PrismaPortfolioPostingRepository;

  beforeEach(async () => {
    ctx = await setupIsolatedTestSchema('verify_ledger');
    prisma = new PrismaClient({ datasourceUrl: ctx.databaseUrl });
    await prisma.$connect();

    verifyRepo = new PrismaPortfolioLedgerVerificationRepository(prisma);
    initRepo = new PrismaPortfolioLedgerInitializationRepository(prisma);
    postRepo = new PrismaPortfolioPostingRepository(prisma);

    // Create instruments
    await prisma.marketInstrument.createMany({
      data: [
        { businessKey: 'VN|HOSE|AAA|EQUITY|2026-08-01', exchange: 'HOSE', canonicalSymbol: 'AAA', securityType: 'EQUITY', currency: 'VND', effectiveFrom: new Date('2026-08-01'), sealedAt: new Date('2026-08-01') },
        { businessKey: 'VN|HOSE|BBB|EQUITY|2026-08-01', exchange: 'HOSE', canonicalSymbol: 'BBB', securityType: 'EQUITY', currency: 'VND', effectiveFrom: new Date('2026-08-01'), sealedAt: new Date('2026-08-01') }
      ]
    });
  });

  afterEach(async () => {
    await prisma.$disconnect();
    await ctx.teardown();
  });

  async function createRun() {
    const config = await prisma.runCoreConfigVersion.create({
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

    const run = await prisma.simulationRun.create({
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

    return { config, run };
  }

  async function initialize(runId: string) {
    const res = await initRepo.initialize({ runId });
    const srun = await prisma.simulationRun.findUnique({ where: { id: runId } });
    if (srun?.status !== 'RUNNING') await prisma.simulationRun.update({ where: { id: runId }, data: { status: 'RUNNING', version: { increment: 1 } } });
    return res;
  }

  async function post(runId: string, inst: string, qty: bigint, price: bigint, reqId: string, forcedHash?: string) {
    const ledger = await prisma.portfolioLedger.findUnique({ where: { runId } });
    const gross = qty * price * -1n;
    const fee = 1000n;
    const net = gross - fee;
    const res = await postRepo.append({
      ledgerId: ledger!.id,
      settlement: {
        sourceExecutionHash: forcedHash || randomBytes(32).toString('hex'),
        instrumentBusinessKey: inst,
        quantityDelta: qty,
        grossCashDeltaVnd: gross,
        feeVnd: fee,
        taxVnd: 0n,
      },
      effectiveDate: '2026-08-02'
    });
    return res;
  }

  it('A: empty initialized ledger verifies', async () => {
    const { run } = await createRun();
    await initialize(run.id);

    const verified = await verifyRepo.verify({ runId: run.id });
    expect(verified.postingCount).toBe(0);
    expect(verified.positions.length).toBe(0);
    expect(verified.currentCashBalanceVnd).toBe(100000000n);
  });

  it('B: one BUY verifies', async () => {
    const { run } = await createRun();
    await initialize(run.id);
    await post(run.id, 'VN|HOSE|AAA|EQUITY|2026-08-01', 100n, 10000n, 'req-1');

    const verified = await verifyRepo.verify({ runId: run.id });
    expect(verified.postingCount).toBe(1);
    expect(verified.positions.length).toBe(1);
    expect(verified.positions[0].instrumentBusinessKey).toBe('VN|HOSE|AAA|EQUITY|2026-08-01');
    expect(verified.positions[0].quantity).toBe(100n);
    expect(verified.positions[0].version).toBe(1);
  });

  it('C: BUY then SELL same instrument verifies', async () => {
    const { run } = await createRun();
    await initialize(run.id);
    await post(run.id, 'VN|HOSE|AAA|EQUITY|2026-08-01', 100n, 10000n, 'req-1');
    await post(run.id, 'VN|HOSE|AAA|EQUITY|2026-08-01', -50n, 11000n, 'req-2');

    const verified = await verifyRepo.verify({ runId: run.id });
    expect(verified.postingCount).toBe(2);
    expect(verified.positions.length).toBe(1);
    expect(verified.positions[0].quantity).toBe(50n);
    expect(verified.positions[0].version).toBe(2);
  });

  it('D: multiple instruments verify', async () => {
    const { run } = await createRun();
    await initialize(run.id);
    await post(run.id, 'VN|HOSE|AAA|EQUITY|2026-08-01', 100n, 10000n, 'req-1');
    await post(run.id, 'VN|HOSE|BBB|EQUITY|2026-08-01', 200n, 20000n, 'req-2');

    const verified = await verifyRepo.verify({ runId: run.id });
    expect(verified.postingCount).toBe(2);
    expect(verified.positions.length).toBe(2);
  });

  it('E: sell-to-zero retains position row and verifies', async () => {
    const { run } = await createRun();
    await initialize(run.id);
    await post(run.id, 'VN|HOSE|AAA|EQUITY|2026-08-01', 100n, 10000n, 'req-1');
    await post(run.id, 'VN|HOSE|AAA|EQUITY|2026-08-01', -100n, 11000n, 'req-2');

    const verified = await verifyRepo.verify({ runId: run.id });
    expect(verified.positions.length).toBe(1);
    expect(verified.positions[0].quantity).toBe(0n);
  });

  it('F: multiple postings same instrument: position.version equals touch count', async () => {
    const { run } = await createRun();
    await initialize(run.id);
    await post(run.id, 'VN|HOSE|AAA|EQUITY|2026-08-01', 100n, 10000n, 'req-1');
    await post(run.id, 'VN|HOSE|BBB|EQUITY|2026-08-01', 50n, 5000n, 'req-2');
    await post(run.id, 'VN|HOSE|AAA|EQUITY|2026-08-01', -50n, 10000n, 'req-3');

    const verified = await verifyRepo.verify({ runId: run.id });
    const posA = verified.positions.find(p => p.instrumentBusinessKey === 'VN|HOSE|AAA|EQUITY|2026-08-01');
    const posB = verified.positions.find(p => p.instrumentBusinessKey === 'VN|HOSE|BBB|EQUITY|2026-08-01');
    expect(posA!.version).toBe(2);
    expect(posB!.version).toBe(1);
  });

  it('G: idempotent posting REPLAYED does not increment audit count and verifies', async () => {
    const { run } = await createRun();
    await initialize(run.id);
    await post(run.id, 'VN|HOSE|AAA|EQUITY|2026-08-01', 100n, 10000n, 'req-1', '0000000000000000000000000000000000000000000000000000000000000001');
    await post(run.id, 'VN|HOSE|AAA|EQUITY|2026-08-01', 100n, 10000n, 'req-1', '0000000000000000000000000000000000000000000000000000000000000001'); // Replay

    const verified = await verifyRepo.verify({ runId: run.id });
    expect(verified.postingCount).toBe(1);
    expect(verified.ledgerVersion).toBe(2);
  });

  it('H: ledger after initialization replay verifies', async () => {
    const { run } = await createRun();
    await initialize(run.id);
    await initialize(run.id);

    const verified = await verifyRepo.verify({ runId: run.id });
    expect(verified.postingCount).toBe(0);
    expect(verified.ledgerVersion).toBe(1);
  });

  it('I: run missing -> RunNotFound', async () => {
    await expect(verifyRepo.verify({ runId: randomUUID() })).rejects.toThrow(PortfolioLedgerVerificationRunNotFoundError);
  });

  it('J: ledger missing -> LedgerNotFound', async () => {
    const { run } = await createRun();
    await expect(verifyRepo.verify({ runId: run.id })).rejects.toThrow(PortfolioLedgerVerificationLedgerNotFoundError);
  });

  it('K: bad immutable genesis root -> Integrity', async () => {
    const { run } = await createRun();
    await initialize(run.id);
    const ext = prisma.$extends({ query: { portfolioLedger: { async findUnique({ args, query }: any) { const res = await query(args); if(res) res.openingCashVnd = 0n; return res; } } } });
    const repoExt = new PrismaPortfolioLedgerVerificationRepository(ext as any);
    await expect(repoExt.verify({ runId: run.id })).rejects.toThrow(PortfolioLedgerVerificationIntegrityError);
  });

  it('L: broken settlementPayloadHash -> Integrity', async () => {
    const { run } = await createRun();
    const l = await initialize(run.id);
    await post(run.id, 'VN|HOSE|AAA|EQUITY|2026-08-01', 100n, 10000n, 'req-1');
    const ext = prisma.$extends({ query: { portfolioLedgerPosting: { async findMany({ args, query }: any) { const res = await query(args); if(res.length > 0) res[0].settlementPayloadHash = 'bad'; return res; } } } });
    const repoExt = new PrismaPortfolioLedgerVerificationRepository(ext as any);
    await expect(repoExt.verify({ runId: run.id })).rejects.toThrow(PortfolioLedgerVerificationIntegrityError);
  });

  it('M: broken transitionHash -> Integrity', async () => {
    const { run } = await createRun();
    const l = await initialize(run.id);
    await post(run.id, 'VN|HOSE|AAA|EQUITY|2026-08-01', 100n, 10000n, 'req-1');
    const ext = prisma.$extends({ query: { portfolioLedgerPosting: { async findMany({ args, query }: any) { const res = await query(args); if(res.length > 0) res[0].transitionHash = 'bad'; return res; } } } });
    const repoExt = new PrismaPortfolioLedgerVerificationRepository(ext as any);
    await expect(repoExt.verify({ runId: run.id })).rejects.toThrow(PortfolioLedgerVerificationIntegrityError);
  });

  it('N: broken entryHash -> Integrity', async () => {
    const { run } = await createRun();
    const l = await initialize(run.id);
    await post(run.id, 'VN|HOSE|AAA|EQUITY|2026-08-01', 100n, 10000n, 'req-1');
    const ext = prisma.$extends({ query: { portfolioLedgerPosting: { async findMany({ args, query }: any) { const res = await query(args); if(res.length > 0) res[0].entryHash = 'bad'; return res; } } } });
    const repoExt = new PrismaPortfolioLedgerVerificationRepository(ext as any);
    await expect(repoExt.verify({ runId: run.id })).rejects.toThrow(PortfolioLedgerVerificationIntegrityError);
  });

  it('O: broken previousHash -> Integrity', async () => {
    const { run } = await createRun();
    const l = await initialize(run.id);
    await post(run.id, 'VN|HOSE|AAA|EQUITY|2026-08-01', 100n, 10000n, 'req-1');
    await post(run.id, 'VN|HOSE|AAA|EQUITY|2026-08-01', 100n, 10000n, 'req-2');
    const ext = prisma.$extends({ query: { portfolioLedgerPosting: { async findMany({ args, query }: any) { const res = await query(args); if(res.length > 1) res[1].previousHash = 'bad'; return res; } } } });
    const repoExt = new PrismaPortfolioLedgerVerificationRepository(ext as any);
    await expect(repoExt.verify({ runId: run.id })).rejects.toThrow(PortfolioLedgerVerificationIntegrityError);
  });

  it('P: sequence gap -> Integrity', async () => {
    const { run } = await createRun();
    const l = await initialize(run.id);
    await post(run.id, 'VN|HOSE|AAA|EQUITY|2026-08-01', 100n, 10000n, 'req-1');
    const ext = prisma.$extends({ query: { portfolioLedgerPosting: { async findMany({ args, query }: any) { const res = await query(args); if(res.length > 0) res[0].entrySequence = 2n; return res; } } } });
    const repoExt = new PrismaPortfolioLedgerVerificationRepository(ext as any);
    await expect(repoExt.verify({ runId: run.id })).rejects.toThrow(PortfolioLedgerVerificationIntegrityError);
  });

  it('Q: historical cash-before mismatch -> Integrity', async () => {
    const { run } = await createRun();
    const l = await initialize(run.id);
    await post(run.id, 'VN|HOSE|AAA|EQUITY|2026-08-01', 100n, 10000n, 'req-1');
    const ext = prisma.$extends({ query: { portfolioLedgerPosting: { async findMany({ args, query }: any) { const res = await query(args); if(res.length > 0) res[0].cashBalanceBeforeVnd = 0n; return res; } } } });
    const repoExt = new PrismaPortfolioLedgerVerificationRepository(ext as any);
    await expect(repoExt.verify({ runId: run.id })).rejects.toThrow(PortfolioLedgerVerificationIntegrityError);
  });

  it('R: ledger final cash mismatch -> Integrity', async () => {
    const { run } = await createRun();
    const l = await initialize(run.id);
    await post(run.id, 'VN|HOSE|AAA|EQUITY|2026-08-01', 100n, 10000n, 'req-1');
    const ext = prisma.$extends({ query: { portfolioLedger: { async findUnique({ args, query }: any) { const res = await query(args); if(res) res.currentCashBalanceVnd = 0n; return res; } } } });
    const repoExt = new PrismaPortfolioLedgerVerificationRepository(ext as any);
    await expect(repoExt.verify({ runId: run.id })).rejects.toThrow(PortfolioLedgerVerificationIntegrityError);
  });

  it('S: ledger lastEntrySequence mismatch -> Integrity', async () => {
    const { run } = await createRun();
    const l = await initialize(run.id);
    await post(run.id, 'VN|HOSE|AAA|EQUITY|2026-08-01', 100n, 10000n, 'req-1');
    const ext = prisma.$extends({ query: { portfolioLedger: { async findUnique({ args, query }: any) { const res = await query(args); if(res) res.lastEntrySequence = 99n; return res; } } } });
    const repoExt = new PrismaPortfolioLedgerVerificationRepository(ext as any);
    await expect(repoExt.verify({ runId: run.id })).rejects.toThrow(PortfolioLedgerVerificationIntegrityError);
  });

  it('T: ledger lastEntryHash mismatch -> Integrity', async () => {
    const { run } = await createRun();
    const l = await initialize(run.id);
    await post(run.id, 'VN|HOSE|AAA|EQUITY|2026-08-01', 100n, 10000n, 'req-1');
    const ext = prisma.$extends({ query: { portfolioLedger: { async findUnique({ args, query }: any) { const res = await query(args); if(res) res.lastEntryHash = 'bad'; return res; } } } });
    const repoExt = new PrismaPortfolioLedgerVerificationRepository(ext as any);
    await expect(repoExt.verify({ runId: run.id })).rejects.toThrow(PortfolioLedgerVerificationIntegrityError);
  });

  it('U: missing position row -> Integrity', async () => {
    const { run } = await createRun();
    const l = await initialize(run.id);
    await post(run.id, 'VN|HOSE|AAA|EQUITY|2026-08-01', 100n, 10000n, 'req-1');
    const ext = prisma.$extends({ query: { portfolioLedgerPosition: { async findMany({ args, query }: any) { return []; } } } });
    const repoExt = new PrismaPortfolioLedgerVerificationRepository(ext as any);
    await expect(repoExt.verify({ runId: run.id })).rejects.toThrow(PortfolioLedgerVerificationIntegrityError);
  });

  it('V: extra position row -> Integrity', async () => {
    const { run } = await createRun();
    const l = await initialize(run.id);
    await post(run.id, 'VN|HOSE|AAA|EQUITY|2026-08-01', 100n, 10000n, 'req-1');
    
    const ext = prisma.$extends({
      query: {
        portfolioLedgerPosition: {
          async findMany({ args, query }: any) {
            const res = await query(args);
            res.push({ instrumentBusinessKey: 'FAKE', quantity: 0n, version: 1, ledgerId: l.ledgerId });
            return res;
          }
        }
      }
    });
    const repoExt = new PrismaPortfolioLedgerVerificationRepository(ext as any);
    await expect(repoExt.verify({ runId: run.id })).rejects.toThrow(PortfolioLedgerVerificationIntegrityError);
  });

  it('W: wrong position quantity -> Integrity', async () => {
    const { run } = await createRun();
    const l = await initialize(run.id);
    await post(run.id, 'VN|HOSE|AAA|EQUITY|2026-08-01', 100n, 10000n, 'req-1');
    
    const ext = prisma.$extends({
      query: {
        portfolioLedgerPosition: {
          async findMany({ args, query }: any) {
            const res = await query(args);
            if (res.length > 0) res[0].quantity = 999n;
            return res;
          }
        }
      }
    });
    const repoExt = new PrismaPortfolioLedgerVerificationRepository(ext as any);
    await expect(repoExt.verify({ runId: run.id })).rejects.toThrow(PortfolioLedgerVerificationIntegrityError);
  });

  it('X: wrong position version -> Integrity', async () => {
    const { run } = await createRun();
    const l = await initialize(run.id);
    await post(run.id, 'VN|HOSE|AAA|EQUITY|2026-08-01', 100n, 10000n, 'req-1');
    
    const ext = prisma.$extends({
      query: {
        portfolioLedgerPosition: {
          async findMany({ args, query }: any) {
            const res = await query(args);
            if (res.length > 0) res[0].version = 999;
            return res;
          }
        }
      }
    });
    const repoExt = new PrismaPortfolioLedgerVerificationRepository(ext as any);
    await expect(repoExt.verify({ runId: run.id })).rejects.toThrow(PortfolioLedgerVerificationIntegrityError);
  });

  it('Y: wrong ledger.version -> Integrity', async () => {
    const { run } = await createRun();
    const l = await initialize(run.id);
    await post(run.id, 'VN|HOSE|AAA|EQUITY|2026-08-01', 100n, 10000n, 'req-1');
    
    const ext = prisma.$extends({
      query: {
        portfolioLedger: {
          async findUnique({ args, query }: any) {
            const res = await query(args);
            if (res) res.version = 999;
            return res;
          }
        }
      }
    });
    const repoExt = new PrismaPortfolioLedgerVerificationRepository(ext as any);
    await expect(repoExt.verify({ runId: run.id })).rejects.toThrow(PortfolioLedgerVerificationIntegrityError);
  });

  it('Z: invalid persisted effectiveDate/domain reconstruction -> Integrity', async () => {
    const { run } = await createRun();
    const l = await initialize(run.id);
    await post(run.id, 'VN|HOSE|AAA|EQUITY|2026-08-01', 100n, 10000n, 'req-1');
    
    const ext = prisma.$extends({
      query: {
        portfolioLedgerPosting: {
          async findMany({ args, query }: any) {
            const res = await query(args);
            if (res.length > 0) res[0].effectiveDate = new Date('invalid');
            return res;
          }
        }
      }
    });
    const repoExt = new PrismaPortfolioLedgerVerificationRepository(ext as any);
    await expect(repoExt.verify({ runId: run.id })).rejects.toThrow(PortfolioLedgerVerificationIntegrityError);
  });

  it('AA: raw Prisma P2034 -> VerificationConcurrencyError', async () => {
    const ext = prisma.$extends({
      query: {
        simulationRun: {
          async findUnique() {
            throw new Prisma.PrismaClientKnownRequestError('conflict', { code: 'P2034', clientVersion: '4.16.2' });
          }
        }
      }
    });
    const repoExt = new PrismaPortfolioLedgerVerificationRepository(ext as any);
    await expect(repoExt.verify({ runId: randomUUID() })).rejects.toThrow(PortfolioLedgerVerificationConcurrencyError);
  });

  it('AB: raw Prisma other Prisma error -> VerificationIntegrityError', async () => {
    const ext = prisma.$extends({
      query: {
        simulationRun: {
          async findUnique() {
            throw new Prisma.PrismaClientKnownRequestError('broken', { code: 'P2022', clientVersion: '4.16.2' });
          }
        }
      }
    });
    const repoExt = new PrismaPortfolioLedgerVerificationRepository(ext as any);
    await expect(repoExt.verify({ runId: randomUUID() })).rejects.toThrow(PortfolioLedgerVerificationIntegrityError);
  });

  it('AC: unrelated error preservation -> rethrows unchanged', async () => {
    const sentinel = new Error('sentinel');
    const ext = prisma.$extends({
      query: {
        simulationRun: {
          async findUnique() {
            throw sentinel;
          }
        }
      }
    });
    const repoExt = new PrismaPortfolioLedgerVerificationRepository(ext as any);
    await expect(repoExt.verify({ runId: randomUUID() })).rejects.toBe(sentinel);

    const primitiveSentinel = 'just a string error';
    const ext2 = prisma.$extends({
      query: {
        simulationRun: {
          async findUnique() {
            throw primitiveSentinel;
          }
        }
      }
    });
    const repoExt2 = new PrismaPortfolioLedgerVerificationRepository(ext2 as any);
    await expect(repoExt2.verify({ runId: randomUUID() })).rejects.toBe(primitiveSentinel);
  });

  it('AD: INITIALIZED + NO LEDGER -> LedgerNotFoundError', async () => {
    const { run } = await createRun();
    const ext = prisma.$extends({
      query: {
        simulationRun: {
          async findUnique({ args, query }: any) {
            const res = await query(args);
            if (res) res.status = 'INITIALIZED';
            return res;
          }
        }
      }
    });
    const repoExt = new PrismaPortfolioLedgerVerificationRepository(ext as any);
    await expect(repoExt.verify({ runId: run.id })).rejects.toThrow(PortfolioLedgerVerificationLedgerNotFoundError);
  });

  it('AE: INITIALIZED + EXISTING LEDGER -> IntegrityError', async () => {
    const { run } = await createRun();
    const l = await initialize(run.id);

    // intercept to return INITIALIZED
    const ext = prisma.$extends({
      query: {
        simulationRun: {
          async findUnique({ args, query }: any) {
            const res = await query(args);
            if (res) res.status = 'INITIALIZED';
            return res;
          }
        }
      }
    });
    const repoExt = new PrismaPortfolioLedgerVerificationRepository(ext as any);
    await expect(repoExt.verify({ runId: run.id })).rejects.toThrow(PortfolioLedgerVerificationIntegrityError);
  });

  it('AF: explicit zero-write verifier evidence', async () => {
    const { run } = await createRun();
    await initialize(run.id);
    
    let writeCounter = 0;
    const sentinel = new Error('WRITE_SENTINEL');
    const ext = prisma.$extends({
      query: {
        $allModels: {
          async create() { writeCounter++; throw sentinel; },
          async createMany() { writeCounter++; throw sentinel; },
          async update() { writeCounter++; throw sentinel; },
          async updateMany() { writeCounter++; throw sentinel; },
          async delete() { writeCounter++; throw sentinel; },
          async deleteMany() { writeCounter++; throw sentinel; },
          async upsert() { writeCounter++; throw sentinel; },
        }
      }
    });

    const repoExt = new PrismaPortfolioLedgerVerificationRepository(ext as any);
    const result = await repoExt.verify({ runId: run.id });
    expect(result.runId).toBe(run.id);
    expect(writeCounter).toBe(0);
  });

});
