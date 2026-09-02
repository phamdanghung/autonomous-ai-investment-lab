import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPortfolioLedgerInitializationRepository } from '../../../src/infrastructure/repositories/portfolio-ledger/PrismaPortfolioLedgerInitializationRepository';
import { PrismaPortfolioPostingRepository } from '../../../src/infrastructure/repositories/portfolio-ledger/PrismaPortfolioPostingRepository';
import { PortfolioLedgerPostingDomain } from '../../../src/domain/portfolio-ledger/PortfolioLedgerPosting';
import {
  PortfolioLedgerInitializationRunNotFoundError,
  PortfolioLedgerInitializationRunNotReadyError,
  PortfolioLedgerInitializationIntegrityError,
  PortfolioLedgerInitializationConcurrencyError
} from '../../../src/application/ports/portfolio-ledger/PortfolioLedgerInitializationRepositoryPorts';
import { setupIsolatedTestSchema, IsolatedTestSchema } from '../../utils/database';
import { randomUUID, randomBytes } from 'crypto';
import { PortfolioLedgerGenesisDomain } from '../../../src/domain/portfolio-ledger/PortfolioLedgerGenesis';

describe('PrismaPortfolioLedgerInitializationRepository (Integration)', () => {
  let ctx: IsolatedTestSchema;
  let prisma: PrismaClient;
  let repo: PrismaPortfolioLedgerInitializationRepository;

  beforeEach(async () => {
    ctx = await setupIsolatedTestSchema('init_ledger');
    prisma = new PrismaClient({ datasourceUrl: ctx.databaseUrl });
    repo = new PrismaPortfolioLedgerInitializationRepository(prisma);
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  async function createConfig() {
    const config = await prisma.runCoreConfigVersion.create({
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
    return config;
  }

  async function createRun(configId: string, status: any = 'CONFIGURED') {
    const cDate = '2026-08-01';
    const run = await prisma.simulationRun.create({
      data: {
        creationIdempotencyKey: randomUUID(),
        creationRequestHash: randomBytes(32).toString('hex'),
        configVersionId: configId,
        mode: 'HISTORICAL_REPLAY',
        status: status,
        dataOriginHash: randomBytes(32).toString('hex'),
        canonicalStartDate: status !== 'INITIALIZED' ? new Date(`${cDate}T00:00:00Z`) : null,
        runBusinessKey: status !== 'INITIALIZED' ? randomBytes(32).toString('hex') : null,
      }
    });
    return { run, cDate };
  }

  it('A: valid CONFIGURED run -> CREATED', async () => {
    const config = await createConfig();
    const { run } = await createRun(config.id);

    const result = await repo.initialize({ runId: run.id });

    expect(result.disposition).toBe('CREATED');
    expect(result.runId).toBe(run.id);
    expect(result.ledgerId).toBeDefined();

    const dbRow = await prisma.portfolioLedger.findUnique({ where: { id: result.ledgerId } });
    expect(dbRow).not.toBeNull();
  });

  it('B: exact genesis hash matches frozen domain expectation', async () => {
    const config = await createConfig();
    const { run, cDate } = await createRun(config.id);

    const result = await repo.initialize({ runId: run.id });

    const expectedGenesis = PortfolioLedgerGenesisDomain.build({
      runBusinessKey: run.runBusinessKey!,
      canonicalStartDate: cDate,
      initialCapitalVnd: config.initialCapital
    });

    expect(result.genesis.genesisHash).toBe(expectedGenesis.genesisHash);
    expect(result.genesis.contractVersion).toBe(expectedGenesis.contractVersion);
  });

  it('C: exact immutable root mapping', async () => {
    const config = await createConfig();
    const { run, cDate } = await createRun(config.id);

    const result = await repo.initialize({ runId: run.id });
    const row = await prisma.portfolioLedger.findUnique({ where: { id: result.ledgerId } });

    expect(row!.runId).toBe(run.id);
    expect(row!.runBusinessKey).toBe(run.runBusinessKey);
    expect(row!.contractVersion).toBe(result.genesis.contractVersion);
    expect(row!.ledgerKind).toBe(result.genesis.ledgerKind);
    expect(row!.canonicalStartDate.toISOString().slice(0, 10)).toBe(cDate);
    expect(row!.currency).toBe(result.genesis.currency);
    expect(row!.openingCashVnd).toBe(BigInt(result.genesis.openingCashVnd));
    expect(row!.openingPositionCount).toBe(result.genesis.openingPositionCount);
    expect(row!.genesisHash).toBe(result.genesis.genesisHash);
  });

  it('D: initial currentCash matches openingCash exactly', async () => {
    const config = await createConfig();
    const { run } = await createRun(config.id);

    const result = await repo.initialize({ runId: run.id });
    const row = await prisma.portfolioLedger.findUnique({ where: { id: result.ledgerId } });

    expect(row!.currentCashBalanceVnd).toBe(row!.openingCashVnd);
  });

  it('E: initial lastEntrySequence = 0', async () => {
    const config = await createConfig();
    const { run } = await createRun(config.id);

    const result = await repo.initialize({ runId: run.id });
    const row = await prisma.portfolioLedger.findUnique({ where: { id: result.ledgerId } });

    expect(row!.lastEntrySequence).toBe(0n);
  });

  it('F: initial lastEntryHash = genesisHash', async () => {
    const config = await createConfig();
    const { run } = await createRun(config.id);

    const result = await repo.initialize({ runId: run.id });
    const row = await prisma.portfolioLedger.findUnique({ where: { id: result.ledgerId } });

    expect(row!.lastEntryHash).toBe(row!.genesisHash);
  });

  it('G: initial version = 1', async () => {
    const config = await createConfig();
    const { run } = await createRun(config.id);

    const result = await repo.initialize({ runId: run.id });
    const row = await prisma.portfolioLedger.findUnique({ where: { id: result.ledgerId } });

    expect(row!.version).toBe(1);
  });

  it('H: creates 0 positions', async () => {
    const config = await createConfig();
    const { run } = await createRun(config.id);

    const result = await repo.initialize({ runId: run.id });
    const count = await prisma.portfolioLedgerPosition.count({ where: { ledgerId: result.ledgerId } });
    expect(count).toBe(0);
  });

  it('I: creates 0 postings', async () => {
    const config = await createConfig();
    const { run } = await createRun(config.id);

    const result = await repo.initialize({ runId: run.id });
    const count = await prisma.portfolioLedgerPosting.count({ where: { ledgerId: result.ledgerId } });
    expect(count).toBe(0);
  });

  it('J: immediate equivalent retry -> REPLAYED', async () => {
    const config = await createConfig();
    const { run } = await createRun(config.id);

    const r1 = await repo.initialize({ runId: run.id });
    expect(r1.disposition).toBe('CREATED');

    const r2 = await repo.initialize({ runId: run.id });
    expect(r2.disposition).toBe('REPLAYED');
  });

  it('K: replay returns exactly the same ledgerId and genesisHash', async () => {
    const config = await createConfig();
    const { run } = await createRun(config.id);

    const r1 = await repo.initialize({ runId: run.id });
    const r2 = await repo.initialize({ runId: run.id });

    expect(r2.ledgerId).toBe(r1.ledgerId);
    expect(r2.genesis.genesisHash).toBe(r1.genesis.genesisHash);
  });

  it('L: replay does NOT mutate the mutable head (cash/sequence/hash)', async () => {
    const config = await createConfig();
    const { run } = await createRun(config.id);

    const r1 = await repo.initialize({ runId: run.id });
    const before = await prisma.portfolioLedger.findUnique({ where: { id: r1.ledgerId } });

    await repo.initialize({ runId: run.id });
    const after = await prisma.portfolioLedger.findUnique({ where: { id: r1.ledgerId } });

    expect(after!.currentCashBalanceVnd).toBe(before!.currentCashBalanceVnd);
    expect(after!.lastEntrySequence).toBe(before!.lastEntrySequence);
    expect(after!.lastEntryHash).toBe(before!.lastEntryHash);
    expect(after!.version).toBe(before!.version);
  });

  it('M: run missing -> throws typed RunNotFound error', async () => {
    await expect(repo.initialize({ runId: randomUUID() }))
      .rejects.toThrowError(PortfolioLedgerInitializationRunNotFoundError);
  });

  it('N: INITIALIZED run -> throws RunNotReady error', async () => {
    const config = await createConfig();
    const { run } = await createRun(config.id, 'INITIALIZED');

    await expect(repo.initialize({ runId: run.id }))
      .rejects.toThrowError(PortfolioLedgerInitializationRunNotReadyError);
  });

  it('O: CONFIGURED but missing runBusinessKey/canonicalStartDate -> IntegrityError', async () => {
    const config = await createConfig();
    const { run } = await createRun(config.id);

    const tamperedPrisma = prisma.$extends({
      query: {
        async $queryRaw({ args, query }: any) {
          const res = await query(args);
          if (Array.isArray(res) && res.length > 0 && res[0].status === 'CONFIGURED') {
            res[0].canonicalStartDate = null;
          }
          return res;
        }
      }
    }) as any;

    const tamperedRepo = new PrismaPortfolioLedgerInitializationRepository(tamperedPrisma);
    await expect(tamperedRepo.initialize({ runId: run.id }))
      .rejects.toThrowError(PortfolioLedgerInitializationIntegrityError);
  });

  it('P: opening capital maps exactly from RunCoreConfigVersion', async () => {
    const config = await createConfig();
    const { run } = await createRun(config.id);

    const r = await repo.initialize({ runId: run.id });
    expect(r.genesis.openingCashVnd).toBe(config.initialCapital.toString());
  });

  it('Q: existing ledger after real posting -> REPLAYED cleanly without resetting mutable head', async () => {
    const config = await createConfig();
    const { run } = await createRun(config.id);

    const r1 = await repo.initialize({ runId: run.id });

    const instrument = await prisma.marketInstrument.create({
      data: {
        businessKey: 'VN|HOSE|VNM|EQUITY|2020-01-01',
        exchange: 'HOSE',
        canonicalSymbol: 'VNM',
        securityType: 'EQUITY',
        currency: 'VND',
        effectiveFrom: new Date('2020-01-01T00:00:00Z'),
        sealedAt: new Date(),
      }
    });

    const postingRepo = new PrismaPortfolioPostingRepository(prisma);

    const appendResult = await postingRepo.append({
      ledgerId: r1.ledgerId,
      effectiveDate: '2026-08-01',
      settlement: {
        sourceExecutionHash: randomBytes(32).toString('hex'),
        instrumentBusinessKey: 'VN|HOSE|VNM|EQUITY|2020-01-01',
        quantityDelta: 100n,
        grossCashDeltaVnd: -5000000n,
        feeVnd: 0n,
        taxVnd: 0n
      }
    });

    const posting = appendResult.posting;

    const before = await prisma.portfolioLedger.findUnique({ where: { id: r1.ledgerId } });
    expect(before!.lastEntrySequence).toBe(1n);
    expect(before!.lastEntryHash).toBe(posting.entry.entryHash);
    expect(before!.version).toBe(2);

    const positions = await prisma.portfolioLedgerPosition.findMany({ where: { ledgerId: r1.ledgerId } });
    expect(positions.length).toBe(1);

    const postingsCount = await prisma.portfolioLedgerPosting.count({ where: { ledgerId: r1.ledgerId } });
    expect(postingsCount).toBe(1);

    const r2 = await repo.initialize({ runId: run.id });
    expect(r2.disposition).toBe('REPLAYED');

    const after = await prisma.portfolioLedger.findUnique({ where: { id: r1.ledgerId } });
    expect(after!.currentCashBalanceVnd).toBe(before!.currentCashBalanceVnd);
    expect(after!.lastEntrySequence).toBe(before!.lastEntrySequence);
    expect(after!.lastEntryHash).toBe(before!.lastEntryHash);
    expect(after!.version).toBe(before!.version);

    const afterPositions = await prisma.portfolioLedgerPosition.findMany({ where: { ledgerId: r1.ledgerId } });
    expect(afterPositions.length).toBe(1);
    expect(afterPositions[0].quantity).toBe(positions[0].quantity);
    expect(afterPositions[0].version).toBe(positions[0].version);

    const afterPostingsCount = await prisma.portfolioLedgerPosting.count({ where: { ledgerId: r1.ledgerId } });
    expect(afterPostingsCount).toBe(1);
  });

  it('R: later legitimate Run status + existing ledger -> REPLAYED allowed', async () => {
    const config = await createConfig();
    const { run } = await createRun(config.id);

    await repo.initialize({ runId: run.id });

    await prisma.simulationRun.update({
      where: { id: run.id },
      data: { status: 'RUNNING', version: { increment: 1 } }
    });

    const r2 = await repo.initialize({ runId: run.id });
    expect(r2.disposition).toBe('REPLAYED');
  });

  it('S: persisted root tampering -> IntegrityError', async () => {
    const config = await createConfig();
    const { run } = await createRun(config.id);

    const r1 = await repo.initialize({ runId: run.id });

    // Use Prisma extension to tamper with the returned row
    const tamperedPrisma = prisma.$extends({
      result: {
        portfolioLedger: {
          openingCashVnd: {
            needs: { openingCashVnd: true },
            compute(ledger: any) {
              return 999n;
            },
          },
        },
      },
    }) as any;

    const tamperedRepo = new PrismaPortfolioLedgerInitializationRepository(tamperedPrisma);

    await expect(tamperedRepo.initialize({ runId: run.id }))
      .rejects.toThrowError(PortfolioLedgerInitializationIntegrityError);
  });

  it('T: exact raw Prisma error encapsulation (no leaks of Prisma instances)', async () => {
    // Inject a P2034 by extending client and mocking queryRaw
    const faultyPrisma = prisma.$extends({
      query: {
        $queryRaw({ args, query }) {
          throw new Prisma.PrismaClientKnownRequestError('Lock wait timeout', {
            code: 'P2034',
            clientVersion: 'x'
          });
        }
      }
    }) as any;

    const faultyRepo = new PrismaPortfolioLedgerInitializationRepository(faultyPrisma);

    await expect(faultyRepo.initialize({ runId: randomUUID() }))
      .rejects.toThrow('Portfolio ledger initialization concurrency error.');
  });

  it('U: IMPOSSIBLE INITIALIZED + EXISTING LEDGER -> IntegrityError', async () => {
    const config = await createConfig();
    const { run } = await createRun(config.id);

    await repo.initialize({ runId: run.id });

    const tamperedPrisma = prisma.$extends({
      query: {
        async $queryRaw({ args, query }: any) {
          const res = await query(args);
          if (Array.isArray(res) && res.length > 0 && res[0].runBusinessKey) {
            res[0].status = 'INITIALIZED';
          }
          return res;
        }
      }
    }) as any;

    const tamperedRepo = new PrismaPortfolioLedgerInitializationRepository(tamperedPrisma);
    await expect(tamperedRepo.initialize({ runId: run.id }))
      .rejects.toThrowError(PortfolioLedgerInitializationIntegrityError);
  });

  it('V: P2002 RECOVERY SUCCESS TEST', async () => {
    const config = await createConfig();
    const { run } = await createRun(config.id);

    // Initial creation normal
    const r1 = await repo.initialize({ runId: run.id });

    // Mock initial findUnique to return null, forcing a create which throws P2002
    let fakeCount = 0;
    const tamperedPrisma = prisma.$extends({
      query: {
        async $queryRaw({ args, query }: any) {
           return await query(args);
        },
        portfolioLedger: {
          async findUnique({ args, query }: any) {
            // we ONLY want to fake it missing on the FIRST call (which happens in executeInitializeTransaction)
            // The retry transaction will call it again, and we must return the real one
            if (fakeCount === 0) {
              fakeCount = 1;
              return null;
            }
            return await query(args);
          }
        }
      }
    }) as any;

    const tamperedRepo = new PrismaPortfolioLedgerInitializationRepository(tamperedPrisma);
    const result = await tamperedRepo.initialize({ runId: run.id });

    expect(result.disposition).toBe('REPLAYED');
    expect(result.ledgerId).toBe(r1.ledgerId);
    expect(result.genesis.genesisHash).toBe(r1.genesis.genesisHash);

    const count = await prisma.portfolioLedger.count({ where: { runId: run.id }});
    expect(count).toBe(1);
  });

  it('W: P2002 RECOVERY NO-WINNER TEST', async () => {
    const config = await createConfig();
    const { run } = await createRun(config.id);

    const tamperedPrisma = prisma.$extends({
      query: {
        portfolioLedger: {
          async create({ args, query }: any) {
            throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
              code: 'P2002',
              clientVersion: 'x',
              meta: { target: ['runId'] }
            });
          }
        }
      }
    }) as any;

    const tamperedRepo = new PrismaPortfolioLedgerInitializationRepository(tamperedPrisma);

    await expect(tamperedRepo.initialize({ runId: run.id }))
      .rejects.toThrowError(PortfolioLedgerInitializationIntegrityError);
  });

  it('X: P2002 RECOVERY PRISMA ERROR-MAPPING TEST', async () => {
    const config = await createConfig();
    const { run } = await createRun(config.id);

    let queryCount = 0;
    const tamperedPrisma = prisma.$extends({
      query: {
        portfolioLedger: {
          async create({ args, query }: any) {
            throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
              code: 'P2002',
              clientVersion: 'x',
              meta: { target: ['runId'] }
            });
          }
        },
        async $queryRaw({ args, query }: any) {
          // Inside the recovery tx, we want to throw a raw Prisma error during SimulationRun lock
          // We can detect it's the recovery because we track calls
          queryCount++;
          // First queryRaw is SimulationRun FOR UPDATE in first TX
          // Second is RunCoreConfigVersion FOR SHARE in first TX
          // Third is SimulationRun FOR UPDATE in recovery TX!
          if (queryCount === 3) {
            throw new Prisma.PrismaClientKnownRequestError('Lock wait timeout', {
              code: 'P2034',
              clientVersion: 'x'
            });
          }
          return await query(args);
        }
      }
    }) as any;

    const tamperedRepo = new PrismaPortfolioLedgerInitializationRepository(tamperedPrisma);

    await expect(tamperedRepo.initialize({ runId: run.id }))
      .rejects.toThrowError(PortfolioLedgerInitializationConcurrencyError);
  });

  it('Y: READINESS CORRUPTION - missing dataOriginHash', async () => {
    const config = await createConfig();
    const { run } = await createRun(config.id);

    const tamperedPrisma = prisma.$extends({
      query: {
        async $queryRaw({ args, query }: any) {
          const res = await query(args);
          if (Array.isArray(res) && res.length > 0 && res[0].status === 'CONFIGURED') {
            res[0].dataOriginHash = null;
          }
          return res;
        }
      }
    }) as any;
    const repo = new PrismaPortfolioLedgerInitializationRepository(tamperedPrisma);


    await expect(repo.initialize({ runId: run.id }))
      .rejects.toThrowError(PortfolioLedgerInitializationIntegrityError);
  });

  it('Z: READINESS CORRUPTION - negative initialCapital', async () => {
    const config = await createConfig();
    const { run } = await createRun(config.id);

    const tamperedPrisma = prisma.$extends({
      query: {
        async $queryRaw({ args, query }: any) {
          const res = await query(args);
          if (Array.isArray(res) && res.length > 0 && res[0].initialCapital !== undefined) {
            res[0].initialCapital = -100n;
          }
          return res;
        }
      }
    }) as any;
    const repo = new PrismaPortfolioLedgerInitializationRepository(tamperedPrisma);


    await expect(repo.initialize({ runId: run.id }))
      .rejects.toThrowError(PortfolioLedgerInitializationIntegrityError);
  });
});
