import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { setupIsolatedTestSchema, IsolatedTestSchema } from '../../utils/database';
import { PrismaPortfolioPostingRepository } from '../../../src/infrastructure/repositories/portfolio-ledger/PrismaPortfolioPostingRepository';
import { 
  PortfolioLedgerNotFoundError,
  PortfolioInstrumentNotFoundError,
  PortfolioPostingIdempotencyCollisionError,
  PortfolioPostingChainConflictError,
  PortfolioPostingIntegrityError,
  PortfolioPostingConcurrencyError
} from '../../../src/application/ports/portfolio-ledger/PortfolioPostingRepositoryPorts';
import { PortfolioLedgerPostingInvalidError } from '../../../src/domain/portfolio-ledger/PortfolioLedgerPosting';
import * as crypto from 'crypto';

describe('Portfolio Posting Repository Integration', () => {
  let isolated: IsolatedTestSchema;
  let prisma: PrismaClient;
  let repo: PrismaPortfolioPostingRepository;

  let ledgerId: string;
  let validInstrumentBusinessKey: string = 'VN|HOSE|VND|EQUITY|2025-01-01';
  let otherInstrumentBusinessKey: string = 'VN|HOSE|FPT|EQUITY|2025-01-01';

  beforeAll(async () => {
    isolated = await setupIsolatedTestSchema('portfolio_repo');
    prisma = new PrismaClient({ datasourceUrl: isolated.databaseUrl });
    repo = new PrismaPortfolioPostingRepository(prisma);

    // Setup Instruments
    await prisma.marketInstrument.create({
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

    await prisma.marketInstrument.create({
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
    await prisma.$disconnect();
    await isolated.teardown();
  });

  beforeEach(async () => {
    // Create a fresh ledger for each test
    const runId = crypto.randomUUID();
    const configId = crypto.randomUUID();
    const runBusinessKey = crypto.createHash('sha256').update(runId).digest('hex');
    const dataOriginHash = crypto.createHash('sha256').update(runBusinessKey).digest('hex');

    await prisma.runCoreConfigVersion.create({
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

    await prisma.simulationRun.create({
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
    
    const ledger = await prisma.portfolioLedger.create({
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
    
    ledgerId = ledger.id;
  });

  it('A: valid BUY -> CREATED and C, D, E, B: exact projections and audit', async () => {
    const srcExecHash = crypto.createHash('sha256').update('valid_buy').digest('hex');
    
    const result = await repo.append({
      ledgerId,
      effectiveDate: '2025-01-02',
      settlement: {
        sourceExecutionHash: srcExecHash,
        instrumentBusinessKey: validInstrumentBusinessKey,
        quantityDelta: 1000n,
        grossCashDeltaVnd: -20000000n,
        feeVnd: 20000n,
        taxVnd: 0n
      }
    });

    expect(result.disposition).toBe('CREATED');
    expect(result.posting.transition.cashBalanceAfterVnd).toBe('79980000');
    expect(result.posting.transition.positionQuantityAfter).toBe('1000');
    expect(result.posting.entry.entrySequence).toBe(1);

    // Audit DB
    const ledgerHead = await prisma.portfolioLedger.findUnique({ where: { id: ledgerId } });
    expect(ledgerHead!.currentCashBalanceVnd).toBe(79980000n);
    expect(ledgerHead!.lastEntrySequence).toBe(1n);
    expect(ledgerHead!.lastEntryHash).toBe(result.posting.entry.entryHash);
    expect(ledgerHead!.version).toBe(2);

    const pos = await prisma.portfolioLedgerPosition.findUnique({
      where: { ledgerId_instrumentBusinessKey: { ledgerId, instrumentBusinessKey: validInstrumentBusinessKey } }
    });
    expect(pos!.quantity).toBe(1000n);
    expect(pos!.version).toBe(1);

    const postRow = await prisma.portfolioLedgerPosting.findUnique({
      where: { ledgerId_sourceExecutionHash: { ledgerId, sourceExecutionHash: srcExecHash } }
    });
    expect(postRow!.quantityDelta).toBe(1000n);
    expect(postRow!.netCashDeltaVnd).toBe(-20020000n);
  });

  it('F, G: valid SELL -> CREATED, zero position retained', async () => {
    // Buy first
    const buyHash = crypto.createHash('sha256').update('buy_before_sell').digest('hex');
    await repo.append({
      ledgerId,
      effectiveDate: '2025-01-02',
      settlement: {
        sourceExecutionHash: buyHash,
        instrumentBusinessKey: validInstrumentBusinessKey,
        quantityDelta: 1000n,
        grossCashDeltaVnd: -20000000n,
        feeVnd: 0n,
        taxVnd: 0n
      }
    });

    const sellHash = crypto.createHash('sha256').update('valid_sell').digest('hex');
    const result = await repo.append({
      ledgerId,
      effectiveDate: '2025-01-03',
      settlement: {
        sourceExecutionHash: sellHash,
        instrumentBusinessKey: validInstrumentBusinessKey,
        quantityDelta: -1000n,
        grossCashDeltaVnd: 25000000n,
        feeVnd: 25000n,
        taxVnd: 25000n
      }
    });

    expect(result.disposition).toBe('CREATED');
    expect(result.posting.transition.positionQuantityAfter).toBe('0');

    const pos = await prisma.portfolioLedgerPosition.findUnique({
      where: { ledgerId_instrumentBusinessKey: { ledgerId, instrumentBusinessKey: validInstrumentBusinessKey } }
    });
    expect(pos!.quantity).toBe(0n); // zero retained
    expect(pos!.version).toBe(2);
  });

  it('H: insufficient cash (NO MARGIN)', async () => {
    const srcExecHash = crypto.createHash('sha256').update('no_margin').digest('hex');
    await expect(repo.append({
      ledgerId,
      effectiveDate: '2025-01-02',
      settlement: {
        sourceExecutionHash: srcExecHash,
        instrumentBusinessKey: validInstrumentBusinessKey,
        quantityDelta: 1000000n,
        grossCashDeltaVnd: -110000000n, // over 100M opening
        feeVnd: 0n,
        taxVnd: 0n
      }
    })).rejects.toThrow(PortfolioLedgerPostingInvalidError);

    // Verify zero writes
    const postCount = await prisma.portfolioLedgerPosting.count({ where: { ledgerId } });
    expect(postCount).toBe(0);
    const posCount = await prisma.portfolioLedgerPosition.count({ where: { ledgerId } });
    expect(posCount).toBe(0);
  });

  it('I: oversell (NO SHORT SELLING)', async () => {
    const srcExecHash = crypto.createHash('sha256').update('no_short').digest('hex');
    await expect(repo.append({
      ledgerId,
      effectiveDate: '2025-01-02',
      settlement: {
        sourceExecutionHash: srcExecHash,
        instrumentBusinessKey: validInstrumentBusinessKey,
        quantityDelta: -10n,
        grossCashDeltaVnd: 200000n,
        feeVnd: 0n,
        taxVnd: 0n
      }
    })).rejects.toThrow(PortfolioLedgerPostingInvalidError);
    
    const postCount = await prisma.portfolioLedgerPosting.count({ where: { ledgerId } });
    expect(postCount).toBe(0);
  });

  it('J: missing ledger', async () => {
    const srcExecHash = crypto.createHash('sha256').update('missing_ledger').digest('hex');
    await expect(repo.append({
      ledgerId: crypto.randomUUID(),
      effectiveDate: '2025-01-02',
      settlement: {
        sourceExecutionHash: srcExecHash,
        instrumentBusinessKey: validInstrumentBusinessKey,
        quantityDelta: 100n,
        grossCashDeltaVnd: -10000n,
        feeVnd: 0n,
        taxVnd: 0n
      }
    })).rejects.toThrow(PortfolioLedgerNotFoundError);
  });

  it('K: missing instrument', async () => {
    const srcExecHash = crypto.createHash('sha256').update('missing_inst').digest('hex');
    await expect(repo.append({
      ledgerId,
      effectiveDate: '2025-01-02',
      settlement: {
        sourceExecutionHash: srcExecHash,
        instrumentBusinessKey: 'VN|HOSE|MISSING|EQUITY|2025-01-01',
        quantityDelta: 100n,
        grossCashDeltaVnd: -10000n,
        feeVnd: 0n,
        taxVnd: 0n
      }
    })).rejects.toThrow(PortfolioInstrumentNotFoundError);
  });

  it('L, P: equivalent retry REPLAYED, rebuilt/verified', async () => {
    const srcExecHash = crypto.createHash('sha256').update('replay').digest('hex');
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
    
    const res1 = await repo.append(cmd);
    expect(res1.disposition).toBe('CREATED');
    
    const res2 = await repo.append(cmd);
    expect(res2.disposition).toBe('REPLAYED');
    expect(res2.posting.entry.entryHash).toBe(res1.posting.entry.entryHash);
    
    // M: Ensure no double mutate
    const ledgerHead = await prisma.portfolioLedger.findUnique({ where: { id: ledgerId } });
    expect(ledgerHead!.lastEntrySequence).toBe(1n); // remains 1
  });

  it('N: same source + different effectiveDate -> IdempotencyCollision', async () => {
    const srcExecHash = crypto.createHash('sha256').update('diff_date').digest('hex');
    const cmd = {
      ledgerId,
      effectiveDate: '2025-01-02',
      settlement: {
        sourceExecutionHash: srcExecHash,
        instrumentBusinessKey: validInstrumentBusinessKey,
        quantityDelta: 100n,
        grossCashDeltaVnd: -2000n,
        feeVnd: 0n,
        taxVnd: 0n
      }
    };
    await repo.append(cmd);
    
    cmd.effectiveDate = '2025-01-03';
    await expect(repo.append(cmd)).rejects.toThrow(PortfolioPostingIdempotencyCollisionError);
  });

  it('O: same source + different settlement -> IdempotencyCollision', async () => {
    const srcExecHash = crypto.createHash('sha256').update('diff_set').digest('hex');
    const cmd = {
      ledgerId,
      effectiveDate: '2025-01-02',
      settlement: {
        sourceExecutionHash: srcExecHash,
        instrumentBusinessKey: validInstrumentBusinessKey,
        quantityDelta: 100n,
        grossCashDeltaVnd: -2000n,
        feeVnd: 0n,
        taxVnd: 0n
      }
    };
    await repo.append(cmd);
    
    cmd.settlement.grossCashDeltaVnd = -3000n; // modify
    await expect(repo.append(cmd)).rejects.toThrow(PortfolioPostingIdempotencyCollisionError);
  });

  it('Q: invalid effectiveDate rejected BEFORE I/O', async () => {
    const srcExecHash = crypto.createHash('sha256').update('inv_date').digest('hex');
    await expect(repo.append({
      ledgerId,
      effectiveDate: ' 2025-01-01', // space
      settlement: {
        sourceExecutionHash: srcExecHash,
        instrumentBusinessKey: validInstrumentBusinessKey,
        quantityDelta: 100n,
        grossCashDeltaVnd: -2000n,
        feeVnd: 0n,
        taxVnd: 0n
      }
    })).rejects.toThrow(PortfolioLedgerPostingInvalidError);
  });

  it('R: invalid settlement rejected BEFORE I/O', async () => {
    const srcExecHash = crypto.createHash('sha256').update('inv_set').digest('hex');
    await expect(repo.append({
      ledgerId,
      effectiveDate: '2025-01-02',
      settlement: {
        sourceExecutionHash: srcExecHash,
        instrumentBusinessKey: validInstrumentBusinessKey,
        quantityDelta: 100n,
        grossCashDeltaVnd: 2000n, // BUY but gross is positive -> invalid domain
        feeVnd: 0n,
        taxVnd: 0n
      }
    })).rejects.toThrow();
  });

  it('S: settlementContractVersion persisted', async () => {
    const srcExecHash = crypto.createHash('sha256').update('scv').digest('hex');
    await repo.append({
      ledgerId,
      effectiveDate: '2025-01-02',
      settlement: {
        sourceExecutionHash: srcExecHash,
        instrumentBusinessKey: validInstrumentBusinessKey,
        quantityDelta: 100n,
        grossCashDeltaVnd: -2000n,
        feeVnd: 0n,
        taxVnd: 0n
      }
    });
    
    const row = await prisma.portfolioLedgerPosting.findUnique({
      where: { ledgerId_sourceExecutionHash: { ledgerId, sourceExecutionHash: srcExecHash } }
    });
    expect(row!.settlementContractVersion).toBe('1.0');
  });

  it('U: forced failure AFTER posting INSERT rolls back completely', async () => {
    const srcExecHash = crypto.createHash('sha256').update('rb_test').digest('hex');
    
    // Inject error into ledger update via $extends
    const faultyPrisma = prisma.$extends({
      query: {
        portfolioLedger: {
          update({ args, query }) {
            throw new Error('Injected failure during ledger update');
          }
        }
      }
    });
    
    const faultyRepo = new PrismaPortfolioPostingRepository(faultyPrisma as PrismaClient);
    
    await expect(faultyRepo.append({
      ledgerId,
      effectiveDate: '2025-01-02',
      settlement: {
        sourceExecutionHash: srcExecHash,
        instrumentBusinessKey: validInstrumentBusinessKey,
        quantityDelta: 100n,
        grossCashDeltaVnd: -2000n,
        feeVnd: 0n,
        taxVnd: 0n
      }
    })).rejects.toThrow('Injected failure during ledger update');
    
    // Verify rollback
    const postCount = await prisma.portfolioLedgerPosting.count({ where: { ledgerId } });
    expect(postCount).toBe(0);
    
    const posCount = await prisma.portfolioLedgerPosition.count({ where: { ledgerId } });
    expect(posCount).toBe(0);
    
    const head = await prisma.portfolioLedger.findUnique({ where: { id: ledgerId } });
    expect(head!.lastEntrySequence).toBe(0n);
    expect(head!.version).toBe(1);
    expect(head!.currentCashBalanceVnd).toBe(100000000n);
  });
  
  it('T: no raw Prisma error leakage (covers unexpected P2002)', async () => {
    // We can simulate an unknown P2002 by creating an entry sequence violation
    const srcExecHash1 = crypto.createHash('sha256').update('seq_v_1').digest('hex');
    await repo.append({
      ledgerId,
      effectiveDate: '2025-01-02',
      settlement: {
        sourceExecutionHash: srcExecHash1,
        instrumentBusinessKey: validInstrumentBusinessKey,
        quantityDelta: 100n,
        grossCashDeltaVnd: -2000n,
        feeVnd: 0n,
        taxVnd: 0n
      }
    });

    const srcExecHash2 = crypto.createHash('sha256').update('seq_v_2').digest('hex');
    const faultyPrisma = prisma.$extends({
      query: {
        portfolioLedgerPosting: {
          create({ args, query }) {
            // Force it to use an existing entrySequence
            args.data.entrySequence = 1n;
            return query(args);
          }
        }
      }
    });
    const faultyRepo = new PrismaPortfolioPostingRepository(faultyPrisma as PrismaClient);

    await expect(faultyRepo.append({
      ledgerId,
      effectiveDate: '2025-01-02',
      settlement: {
        sourceExecutionHash: srcExecHash2,
        instrumentBusinessKey: validInstrumentBusinessKey,
        quantityDelta: 100n,
        grossCashDeltaVnd: -2000n,
        feeVnd: 0n,
        taxVnd: 0n
      }
    })).rejects.toThrow(PortfolioPostingChainConflictError);
  });

  // T is also achieved by handling P2003
  it('T: FK violation throws IntegrityError', async () => {
    const srcExecHash = crypto.createHash('sha256').update('fk_v').digest('hex');
    const faultyPrisma = prisma.$extends({
      query: {
        marketInstrument: {
          findUnique({ args, query }) {
            // Mock instrument check to return a fake instrument to bypass check,
            // but the DB insert will fail FK.
            return Promise.resolve({ businessKey: args.where.businessKey } as any);
          }
        }
      }
    });
    const faultyRepo = new PrismaPortfolioPostingRepository(faultyPrisma as PrismaClient);

    await expect(faultyRepo.append({
      ledgerId,
      effectiveDate: '2025-01-02',
      settlement: {
        sourceExecutionHash: srcExecHash,
        instrumentBusinessKey: 'VN|HOSE|MISSING|EQUITY|2025-01-01',
        quantityDelta: 100n,
        grossCashDeltaVnd: -2000n,
        feeVnd: 0n,
        taxVnd: 0n
      }
    })).rejects.toThrow(PortfolioPostingIntegrityError);
  });
});
