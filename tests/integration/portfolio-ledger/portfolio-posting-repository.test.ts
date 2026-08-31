import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
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
import { PortfolioLedgerTradeSettlementDomain } from '../../../src/domain/portfolio-ledger/PortfolioLedgerTradeSettlement';
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
    
    // Capture state before replay
    const preReplayCount = await prisma.portfolioLedgerPosting.count({ where: { ledgerId } });
    const preReplayLedger = await prisma.portfolioLedger.findUnique({ where: { id: ledgerId } });
    const preReplayPosition = await prisma.portfolioLedgerPosition.findUnique({
      where: { ledgerId_instrumentBusinessKey: { ledgerId, instrumentBusinessKey: validInstrumentBusinessKey } }
    });

    const res2 = await repo.append(cmd);
    expect(res2.disposition).toBe('REPLAYED');
    expect(res2.posting.entry.entryHash).toBe(res1.posting.entry.entryHash);
    
    // Capture state after replay
    const postReplayCount = await prisma.portfolioLedgerPosting.count({ where: { ledgerId } });
    const postReplayLedger = await prisma.portfolioLedger.findUnique({ where: { id: ledgerId } });
    const postReplayPosition = await prisma.portfolioLedgerPosition.findUnique({
      where: { ledgerId_instrumentBusinessKey: { ledgerId, instrumentBusinessKey: validInstrumentBusinessKey } }
    });

    // M: Ensure no double mutate
    expect(postReplayCount).toBe(preReplayCount);
    expect(postReplayLedger!.currentCashBalanceVnd).toBe(preReplayLedger!.currentCashBalanceVnd);
    expect(postReplayLedger!.lastEntrySequence).toBe(preReplayLedger!.lastEntrySequence);
    expect(postReplayLedger!.lastEntryHash).toBe(preReplayLedger!.lastEntryHash);
    expect(postReplayLedger!.version).toBe(preReplayLedger!.version);
    expect(postReplayPosition!.quantity).toBe(preReplayPosition!.quantity);
    expect(postReplayPosition!.version).toBe(preReplayPosition!.version);
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
    const noIoPrisma = prisma.$extends({
      query: {
        $allModels: {
          $allOperations({ model, operation, args, query }) {
            throw new Error('I/O occurred when it should not have');
          }
        }
      }
    }) as PrismaClient;
    const noIoRepo = new PrismaPortfolioPostingRepository(noIoPrisma);

    await expect(noIoRepo.append({
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
    const noIoPrisma = prisma.$extends({
      query: {
        $allModels: {
          $allOperations({ model, operation, args, query }) {
            throw new Error('I/O occurred when it should not have');
          }
        }
      }
    }) as PrismaClient;
    const noIoRepo = new PrismaPortfolioPostingRepository(noIoPrisma);

    await expect(noIoRepo.append({
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

  it('V: ROOT precheck error mapping', async () => {
    const srcExecHash = crypto.createHash('sha256').update('root_precheck').digest('hex');
    const faultyPrisma = prisma.$extends({
      query: {
        portfolioLedgerPosting: {
          findUnique({ args, query }) {
            throw new Prisma.PrismaClientUnknownRequestError('Forced root error', { clientVersion: '4' });
          }
        }
      }
    }) as PrismaClient;
    const faultyRepo = new PrismaPortfolioPostingRepository(faultyPrisma);

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
    })).rejects.toThrow(PortfolioPostingIntegrityError);
  });

  it('W: P2002 recovery query error mapping', async () => {
    const srcExecHash = crypto.createHash('sha256').update('p2002_recovery').digest('hex');
    let findUniqueCount = 0;
    const faultyPrisma = prisma.$extends({
      query: {
        portfolioLedgerPosting: {
          findUnique({ args, query }) {
            findUniqueCount++;
            if (findUniqueCount === 2) {
              throw new Prisma.PrismaClientUnknownRequestError('Forced reread error', { clientVersion: '4' });
            }
            return query(args);
          },
          create({ args, query }) {
            throw new Prisma.PrismaClientKnownRequestError('P2002 injected', {
              code: 'P2002',
              meta: { target: ['sourceExecutionHash'] },
              clientVersion: '4'
            });
          }
        }
      }
    }) as PrismaClient;
    const faultyRepo = new PrismaPortfolioPostingRepository(faultyPrisma);

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
    })).rejects.toThrow(PortfolioPostingIntegrityError);
  });

  it('X: EXACT AUDIT MAPPING TEST', async () => {
    const srcExecHash = crypto.createHash('sha256').update('exact_audit').digest('hex');
    const cmd = {
      ledgerId,
      effectiveDate: '2025-01-02',
      settlement: {
        sourceExecutionHash: srcExecHash,
        instrumentBusinessKey: validInstrumentBusinessKey,
        quantityDelta: 100n,
        grossCashDeltaVnd: -2000n,
        feeVnd: 10n,
        taxVnd: 5n
      }
    };
    const res = await repo.append(cmd);
    expect(res.disposition).toBe('CREATED');
    const domainPosting = res.posting;
    const canonicalSettlement = PortfolioLedgerTradeSettlementDomain.build(cmd.settlement);

    const row = await prisma.portfolioLedgerPosting.findUnique({
      where: { ledgerId_sourceExecutionHash: { ledgerId, sourceExecutionHash: srcExecHash } }
    });
    expect(row).toBeDefined();

    expect(row!.ledgerGenesisHash).toBe(domainPosting.entry.ledgerGenesisHash);
    expect(row!.settlementContractVersion).toBe(canonicalSettlement.contractVersion);
    expect(row!.postingKind).toBe(canonicalSettlement.postingKind);
    expect(row!.sourceExecutionHash).toBe(canonicalSettlement.sourceExecutionHash);
    expect(row!.instrumentBusinessKey).toBe(canonicalSettlement.instrumentBusinessKey);
    expect(row!.side).toBe(canonicalSettlement.side);
    expect(row!.quantityDelta).toBe(BigInt(canonicalSettlement.quantityDelta));
    expect(row!.grossCashDeltaVnd).toBe(BigInt(canonicalSettlement.grossCashDeltaVnd));
    expect(row!.feeVnd).toBe(BigInt(canonicalSettlement.feeVnd));
    expect(row!.taxVnd).toBe(BigInt(canonicalSettlement.taxVnd));
    expect(row!.netCashDeltaVnd).toBe(BigInt(canonicalSettlement.netCashDeltaVnd));
    expect(row!.settlementPayloadHash).toBe(canonicalSettlement.payloadHash);

    expect(row!.transitionContractVersion).toBe(domainPosting.transition.contractVersion);
    expect(row!.transitionKind).toBe(domainPosting.transition.transitionKind);
    expect(row!.cashBalanceBeforeVnd).toBe(BigInt(domainPosting.transition.cashBalanceBeforeVnd));
    expect(row!.cashDeltaVnd).toBe(BigInt(domainPosting.transition.cashDeltaVnd));
    expect(row!.cashBalanceAfterVnd).toBe(BigInt(domainPosting.transition.cashBalanceAfterVnd));
    expect(row!.positionQuantityBefore).toBe(BigInt(domainPosting.transition.positionQuantityBefore));
    expect(row!.positionQuantityAfter).toBe(BigInt(domainPosting.transition.positionQuantityAfter));
    expect(row!.transitionHash).toBe(domainPosting.transition.transitionHash);

    expect(row!.entryContractVersion).toBe(domainPosting.entry.contractVersion);
    expect(row!.entryType).toBe(domainPosting.entry.entryType);
    expect(row!.entrySequence).toBe(BigInt(domainPosting.entry.entrySequence));
    expect(row!.effectiveDate.toISOString().slice(0, 10)).toBe(domainPosting.entry.effectiveDate);
    expect(row!.previousHash).toBe(domainPosting.entry.previousHash);
    expect(row!.entryHash).toBe(domainPosting.entry.entryHash);
  });

  it('Y1: successful SELL audit check', async () => {
    const srcExecHash = crypto.createHash('sha256').update('sell_audit').digest('hex');
    const cmd = {
      ledgerId,
      effectiveDate: '2025-01-02',
      settlement: {
        sourceExecutionHash: srcExecHash,
        instrumentBusinessKey: otherInstrumentBusinessKey,
        quantityDelta: -50n,
        grossCashDeltaVnd: 50000n,
        feeVnd: 10n,
        taxVnd: 5n
      }
    };
    
    // Setup initial position
    await prisma.portfolioLedgerPosition.create({
      data: {
        ledgerId,
        instrumentBusinessKey: otherInstrumentBusinessKey,
        quantity: 100n,
        version: 1
      }
    });
    
    const res = await repo.append(cmd);
    expect(res.disposition).toBe('CREATED');
    expect(res.posting.transition.positionQuantityBefore).toBe('100'); // string encoded
    expect(res.posting.transition.positionQuantityAfter).toBe('50'); // string encoded
  });

  it('Y2: P2002 recovery differing payloadHash -> IdempotencyCollision', async () => {
    const srcExecHash = crypto.createHash('sha256').update('p2002_diff_payload').digest('hex');
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

    const faultyPrisma = prisma.$extends({
      query: {
        portfolioLedgerPosting: {
          findUnique({ args, query }) {
            // First findUnique (precheck) returns null
            return query(args);
          },
          create({ args, query }) {
            // Force P2002 on create
            throw new Prisma.PrismaClientKnownRequestError('P2002 injected', {
              code: 'P2002',
              meta: { target: ['sourceExecutionHash'] },
              clientVersion: '4'
            });
          }
        }
      }
    }) as PrismaClient;
    const faultyRepo = new PrismaPortfolioPostingRepository(faultyPrisma);

    // Call with DIFFERENT settlement
    await expect(faultyRepo.append({
      ledgerId,
      effectiveDate: '2025-01-02',
      settlement: {
        sourceExecutionHash: srcExecHash,
        instrumentBusinessKey: validInstrumentBusinessKey,
        quantityDelta: 200n, // different
        grossCashDeltaVnd: -4000n,
        feeVnd: 0n,
        taxVnd: 0n
      }
    })).rejects.toThrow(PortfolioPostingIdempotencyCollisionError);
  });

  it('Y3: mapAndVerifyPersistedPosting detects invalid persisted data', async () => {
    const srcExecHash = crypto.createHash('sha256').update('invalid_persisted').digest('hex');
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

    const faultyPrisma = prisma.$extends({
      query: {
        portfolioLedgerPosting: {
          async findUnique({ args, query }) {
            const result = await query(args);
            if (result && result.sourceExecutionHash === srcExecHash) {
              result.quantityDelta = 999n;
            }
            return result;
          }
        }
      }
    }) as PrismaClient;
    const faultyRepo = new PrismaPortfolioPostingRepository(faultyPrisma);

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
    })).rejects.toThrow(PortfolioPostingIntegrityError);
  });
});
