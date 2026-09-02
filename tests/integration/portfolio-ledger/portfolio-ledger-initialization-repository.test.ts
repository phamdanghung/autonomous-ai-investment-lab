import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPortfolioLedgerInitializationRepository } from '../../../src/infrastructure/repositories/portfolio-ledger/PrismaPortfolioLedgerInitializationRepository';
import {
  PortfolioLedgerInitializationRunNotFoundError,
  PortfolioLedgerInitializationRunNotReadyError,
  PortfolioLedgerInitializationIntegrityError
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
        businessKey: randomUUID(),
        exchange: 'HOSE',
        canonicalSymbol: 'VNM',
        securityType: 'EQUITY',
        currency: 'VND',
        effectiveFrom: new Date('2020-01-01T00:00:00Z'),
        sealedAt: new Date(),
      }
    });

    // We can simulate a posting by directly updating the head as if a posting occurred
    // because we aren't testing the posting repo here, we are testing the initialization repo
    // and we just need the head to be different from genesis.
    // wait, we can just insert a posting and update head.
    const newHash = randomBytes(32).toString('hex');
    await prisma.portfolioLedger.update({
      where: { id: r1.ledgerId },
      data: {
        currentCashBalanceVnd: 500n,
        lastEntrySequence: 1n,
        lastEntryHash: newHash,
        version: { increment: 1 }
      }
    });

    const r2 = await repo.initialize({ runId: run.id });
    expect(r2.disposition).toBe('REPLAYED');
    
    const after = await prisma.portfolioLedger.findUnique({ where: { id: r1.ledgerId } });
    expect(after!.currentCashBalanceVnd).toBe(500n);
    expect(after!.lastEntrySequence).toBe(1n);
    expect(after!.lastEntryHash).toBe(newHash);
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
});
