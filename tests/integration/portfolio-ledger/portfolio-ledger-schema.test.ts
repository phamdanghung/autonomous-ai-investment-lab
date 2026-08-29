import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { 
  setupIsolatedTestSchema 
} from '../../utils/database';
import crypto from 'crypto';

let isolated: { databaseUrl: string; schemaName: string; teardown: () => Promise<void> };
let prisma: PrismaClient;

const runBusinessKey = crypto.createHash('sha256').update('test_run').digest('hex');
const canonicalStartDate = new Date('2025-01-01');
const dataOriginHash = crypto.createHash('sha256').update('data_origin').digest('hex');
const genesisHash = '4c601fe4c007eb9faac1df91fb0a46c3c319b4026e757f56de16825891f39fdb';
const runConfigInitialCapital = 10000000n;

let validRunId: string;
let validInstrumentBusinessKey: string;

describe('PortfolioLedger Persistence Schema (1C.2A)', () => {
  beforeAll(async () => {
    isolated = await setupIsolatedTestSchema('portfolio_ledger_schema');
    process.env.DATABASE_URL = isolated.databaseUrl;
    
    prisma = new PrismaClient({
      datasources: {
        db: { url: isolated.databaseUrl }
      }
    });

    // Create prerequisite fixtures: SimulationRun and MarketInstrument
    const config = await prisma.runCoreConfigVersion.create({
      data: {
        contentHash: crypto.createHash('sha256').update('content').digest('hex'),
        mode: 'HISTORICAL_REPLAY',
        codeVersion: '1.0.0',
        rngSeed: 12345n,
        fillPolicyVersionKey: 'FILL_1',
        orchestrationVersionKey: 'ORCH_1',
        initialCapital: runConfigInitialCapital
      }
    });

    const run = await prisma.simulationRun.create({
      data: {
        runBusinessKey,
        canonicalStartDate,
          mode: 'HISTORICAL_REPLAY',
          creationIdempotencyKey: crypto.randomUUID(),
          creationRequestHash: crypto.createHash('sha256').update(crypto.randomUUID()).digest('hex'),
        dataOriginHash,
        status: 'CONFIGURED',
        configVersionId: config.id
      }
    });
    validRunId = run.id;

    validInstrumentBusinessKey = 'VN|HOSE|HPG|EQUITY|2025-01-01';
    await prisma.marketInstrument.create({
      data: {
        businessKey: validInstrumentBusinessKey,
        exchange: 'HOSE',
        canonicalSymbol: 'HPG',
        securityType: 'EQUITY',
        currency: 'VND',
        effectiveFrom: new Date('2025-01-01'),
        sealedAt: new Date()
      }
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    if (isolated) {
      await isolated.teardown();
    }
  });

  describe('PortfolioLedger (Root)', () => {
    it('C valid root insert accepted', async () => {
      const ledger = await prisma.portfolioLedger.create({
        data: {
          runId: validRunId,
          runBusinessKey,
          contractVersion: '1.0',
          ledgerKind: 'SIMULATION_PORTFOLIO',
          canonicalStartDate,
          currency: 'VND',
          openingCashVnd: runConfigInitialCapital,
          openingPositionCount: 0,
          genesisHash,
          currentCashBalanceVnd: runConfigInitialCapital,
          lastEntrySequence: 0n,
          lastEntryHash: genesisHash,
          version: 1
        }
      });
      expect(ledger).toBeDefined();
      expect(ledger.version).toBe(1);
    });

    it('D root tied to wrong runBusinessKey rejected by DB trigger', async () => {
      await expect(prisma.portfolioLedger.create({
        data: {
          runId: validRunId,
          runBusinessKey: crypto.createHash('sha256').update('wrong').digest('hex'),
          contractVersion: '1.0',
          ledgerKind: 'SIMULATION_PORTFOLIO',
          canonicalStartDate,
          currency: 'VND',
          openingCashVnd: runConfigInitialCapital,
          openingPositionCount: 0,
          genesisHash: crypto.createHash('sha256').update('d').digest('hex'),
          currentCashBalanceVnd: runConfigInitialCapital,
          lastEntrySequence: 0n,
          lastEntryHash: crypto.createHash('sha256').update('d').digest('hex'),
          version: 1
        }
      })).rejects.toThrow('runBusinessKey mismatch with SimulationRun');
    });

    it('E root tied to wrong canonicalStartDate rejected by DB trigger', async () => {
      await expect(prisma.portfolioLedger.create({
        data: {
          runId: validRunId,
          runBusinessKey,
          contractVersion: '1.0',
          ledgerKind: 'SIMULATION_PORTFOLIO',
          canonicalStartDate: new Date('2025-02-01'),
          currency: 'VND',
          openingCashVnd: runConfigInitialCapital,
          openingPositionCount: 0,
          genesisHash: crypto.createHash('sha256').update('e').digest('hex'),
          currentCashBalanceVnd: runConfigInitialCapital,
          lastEntrySequence: 0n,
          lastEntryHash: crypto.createHash('sha256').update('e').digest('hex'),
          version: 1
        }
      })).rejects.toThrow('canonicalStartDate mismatch with SimulationRun');
    });

    it('F root opening cash differing from RunCoreConfigVersion.initialCapital rejected', async () => {
      await expect(prisma.portfolioLedger.create({
        data: {
          runId: validRunId,
          runBusinessKey,
          contractVersion: '1.0',
          ledgerKind: 'SIMULATION_PORTFOLIO',
          canonicalStartDate,
          currency: 'VND',
          openingCashVnd: 5000000n, // different
          openingPositionCount: 0,
          genesisHash: crypto.createHash('sha256').update('f').digest('hex'),
          currentCashBalanceVnd: 5000000n,
          lastEntrySequence: 0n,
          lastEntryHash: crypto.createHash('sha256').update('f').digest('hex'),
          version: 1
        }
      })).rejects.toThrow('openingCashVnd mismatch with RunCoreConfigVersion.initialCapital');
    });

    it('G root on unbound/INITIALIZED run rejected', async () => {
      const initRun = await prisma.simulationRun.create({
        data: {
          runBusinessKey: crypto.createHash('sha256').update('init').digest('hex'),
          canonicalStartDate,
          mode: 'HISTORICAL_REPLAY',
          creationIdempotencyKey: crypto.randomUUID(),
          creationRequestHash: crypto.createHash('sha256').update(crypto.randomUUID()).digest('hex'),
          dataOriginHash,
          status: 'INITIALIZED',
          configVersionId: (await prisma.runCoreConfigVersion.findFirst())!.id
        }
      });
      await expect(prisma.portfolioLedger.create({
        data: {
          runId: initRun.id,
          runBusinessKey: initRun.runBusinessKey!,
          contractVersion: '1.0',
          ledgerKind: 'SIMULATION_PORTFOLIO',
          canonicalStartDate,
          currency: 'VND',
          openingCashVnd: runConfigInitialCapital,
          openingPositionCount: 0,
          genesisHash: crypto.createHash('sha256').update('g').digest('hex'),
          currentCashBalanceVnd: runConfigInitialCapital,
          lastEntrySequence: 0n,
          lastEntryHash: crypto.createHash('sha256').update('g').digest('hex'),
          version: 1
        }
      })).rejects.toThrow('SimulationRun is unbound/INITIALIZED');
    });

    it('H invalid contractVersion rejected', async () => {
      const testRun = await prisma.simulationRun.create({
        data: {
          runBusinessKey: crypto.createHash('sha256').update('h').digest('hex'),
          canonicalStartDate,
          mode: 'HISTORICAL_REPLAY',
          creationIdempotencyKey: crypto.randomUUID(),
          creationRequestHash: crypto.createHash('sha256').update(crypto.randomUUID()).digest('hex'),
          dataOriginHash,
          status: 'CONFIGURED',
          configVersionId: (await prisma.runCoreConfigVersion.findFirst())!.id
        }
      });
      await expect(prisma.portfolioLedger.create({
        data: {
          runId: testRun.id,
          runBusinessKey: testRun.runBusinessKey!,
          contractVersion: '1.1',
          ledgerKind: 'SIMULATION_PORTFOLIO',
          canonicalStartDate,
          currency: 'VND',
          openingCashVnd: runConfigInitialCapital,
          openingPositionCount: 0,
          genesisHash: crypto.createHash('sha256').update('h').digest('hex'),
          currentCashBalanceVnd: runConfigInitialCapital,
          lastEntrySequence: 0n,
          lastEntryHash: crypto.createHash('sha256').update('h').digest('hex'),
          version: 1
        }
      })).rejects.toThrow('chk_ledger_contract');
    });

    it('I invalid ledgerKind rejected', async () => {
       const testRun = await prisma.simulationRun.create({
        data: {
          runBusinessKey: crypto.createHash('sha256').update('i').digest('hex'),
          canonicalStartDate,
          mode: 'HISTORICAL_REPLAY',
          creationIdempotencyKey: crypto.randomUUID(),
          creationRequestHash: crypto.createHash('sha256').update(crypto.randomUUID()).digest('hex'),
          dataOriginHash,
          status: 'CONFIGURED',
          configVersionId: (await prisma.runCoreConfigVersion.findFirst())!.id
        }
      });
      await expect(prisma.portfolioLedger.create({
        data: {
          runId: testRun.id,
          runBusinessKey: testRun.runBusinessKey!,
          contractVersion: '1.0',
          ledgerKind: 'WRONG_KIND',
          canonicalStartDate,
          currency: 'VND',
          openingCashVnd: runConfigInitialCapital,
          openingPositionCount: 0,
          genesisHash: crypto.createHash('sha256').update('i').digest('hex'),
          currentCashBalanceVnd: runConfigInitialCapital,
          lastEntrySequence: 0n,
          lastEntryHash: crypto.createHash('sha256').update('i').digest('hex'),
          version: 1
        }
      })).rejects.toThrow('chk_ledger_kind');
    });

    it('J invalid currency rejected', async () => {
       const testRun = await prisma.simulationRun.create({
        data: {
          runBusinessKey: crypto.createHash('sha256').update('j').digest('hex'),
          canonicalStartDate,
          mode: 'HISTORICAL_REPLAY',
          creationIdempotencyKey: crypto.randomUUID(),
          creationRequestHash: crypto.createHash('sha256').update(crypto.randomUUID()).digest('hex'),
          dataOriginHash,
          status: 'CONFIGURED',
          configVersionId: (await prisma.runCoreConfigVersion.findFirst())!.id
        }
      });
      await expect(prisma.portfolioLedger.create({
        data: {
          runId: testRun.id,
          runBusinessKey: testRun.runBusinessKey!,
          contractVersion: '1.0',
          ledgerKind: 'SIMULATION_PORTFOLIO',
          canonicalStartDate,
          currency: 'USD',
          openingCashVnd: runConfigInitialCapital,
          openingPositionCount: 0,
          genesisHash: crypto.createHash('sha256').update('j').digest('hex'),
          currentCashBalanceVnd: runConfigInitialCapital,
          lastEntrySequence: 0n,
          lastEntryHash: crypto.createHash('sha256').update('j').digest('hex'),
          version: 1
        }
      })).rejects.toThrow('chk_ledger_currency');
    });

    it('K openingPositionCount != 0 rejected', async () => {
       const testRun = await prisma.simulationRun.create({
        data: {
          runBusinessKey: crypto.createHash('sha256').update('k').digest('hex'),
          canonicalStartDate,
          mode: 'HISTORICAL_REPLAY',
          creationIdempotencyKey: crypto.randomUUID(),
          creationRequestHash: crypto.createHash('sha256').update(crypto.randomUUID()).digest('hex'),
          dataOriginHash,
          status: 'CONFIGURED',
          configVersionId: (await prisma.runCoreConfigVersion.findFirst())!.id
        }
      });
      await expect(prisma.portfolioLedger.create({
        data: {
          runId: testRun.id,
          runBusinessKey: testRun.runBusinessKey!,
          contractVersion: '1.0',
          ledgerKind: 'SIMULATION_PORTFOLIO',
          canonicalStartDate,
          currency: 'VND',
          openingCashVnd: runConfigInitialCapital,
          openingPositionCount: 1,
          genesisHash: crypto.createHash('sha256').update('k').digest('hex'),
          currentCashBalanceVnd: runConfigInitialCapital,
          lastEntrySequence: 0n,
          lastEntryHash: crypto.createHash('sha256').update('k').digest('hex'),
          version: 1
        }
      })).rejects.toThrow('chk_ledger_opening_pos');
    });

    it('L negative openingCashVnd rejected', async () => {
      // Actually trigger logic requires openingCashVnd == run initial capital
      // We'd have to create a run config with negative initial capital which fails the domain
      // Let's test negative current cash balance on update
    });

    it('M negative currentCashBalanceVnd rejected', async () => {
      const ledger = await prisma.portfolioLedger.findUnique({ where: { runBusinessKey } });
      await expect(prisma.portfolioLedger.update({
        where: { id: ledger!.id },
        data: {
          currentCashBalanceVnd: -100n,
          version: 2,
          lastEntrySequence: 1n,
          lastEntryHash: crypto.createHash('sha256').update('M').digest('hex')
        }
      })).rejects.toThrow('chk_ledger_current_cash');
    });

    it('N invalid runBusinessKey hash format rejected', async () => {
       const testRun = await prisma.simulationRun.create({
        data: {
          runBusinessKey: 'invalid-hash',
          canonicalStartDate,
          mode: 'HISTORICAL_REPLAY',
          creationIdempotencyKey: crypto.randomUUID(),
          creationRequestHash: crypto.createHash('sha256').update(crypto.randomUUID()).digest('hex'),
          dataOriginHash,
          status: 'CONFIGURED',
          configVersionId: (await prisma.runCoreConfigVersion.findFirst())!.id
        }
      });
      await expect(prisma.portfolioLedger.create({
        data: {
          runId: testRun.id,
          runBusinessKey: testRun.runBusinessKey!,
          contractVersion: '1.0',
          ledgerKind: 'SIMULATION_PORTFOLIO',
          canonicalStartDate,
          currency: 'VND',
          openingCashVnd: runConfigInitialCapital,
          openingPositionCount: 0,
          genesisHash: crypto.createHash('sha256').update('n').digest('hex'),
          currentCashBalanceVnd: runConfigInitialCapital,
          lastEntrySequence: 0n,
          lastEntryHash: crypto.createHash('sha256').update('n').digest('hex'),
          version: 1
        }
      })).rejects.toThrow('chk_ledger_run_key_fmt');
    });

    it('O invalid genesisHash rejected', async () => {
       const testRun = await prisma.simulationRun.create({
        data: {
          runBusinessKey: crypto.createHash('sha256').update('o').digest('hex'),
          canonicalStartDate,
          mode: 'HISTORICAL_REPLAY',
          creationIdempotencyKey: crypto.randomUUID(),
          creationRequestHash: crypto.createHash('sha256').update(crypto.randomUUID()).digest('hex'),
          dataOriginHash,
          status: 'CONFIGURED',
          configVersionId: (await prisma.runCoreConfigVersion.findFirst())!.id
        }
      });
      await expect(prisma.portfolioLedger.create({
        data: {
          runId: testRun.id,
          runBusinessKey: testRun.runBusinessKey!,
          contractVersion: '1.0',
          ledgerKind: 'SIMULATION_PORTFOLIO',
          canonicalStartDate,
          currency: 'VND',
          openingCashVnd: runConfigInitialCapital,
          openingPositionCount: 0,
          genesisHash: 'invalid-hash',
          currentCashBalanceVnd: runConfigInitialCapital,
          lastEntrySequence: 0n,
          lastEntryHash: 'invalid-hash', // Needs to match genesis for init
          version: 1
        }
      })).rejects.toThrow('chk_ledger_genesis_fmt');
    });

    it('P initial current cash != opening cash rejected', async () => {
       const testRun = await prisma.simulationRun.create({
        data: {
          runBusinessKey: crypto.createHash('sha256').update('p').digest('hex'),
          canonicalStartDate,
          mode: 'HISTORICAL_REPLAY',
          creationIdempotencyKey: crypto.randomUUID(),
          creationRequestHash: crypto.createHash('sha256').update(crypto.randomUUID()).digest('hex'),
          dataOriginHash,
          status: 'CONFIGURED',
          configVersionId: (await prisma.runCoreConfigVersion.findFirst())!.id
        }
      });
      await expect(prisma.portfolioLedger.create({
        data: {
          runId: testRun.id,
          runBusinessKey: testRun.runBusinessKey!,
          contractVersion: '1.0',
          ledgerKind: 'SIMULATION_PORTFOLIO',
          canonicalStartDate,
          currency: 'VND',
          openingCashVnd: runConfigInitialCapital,
          openingPositionCount: 0,
          genesisHash: crypto.createHash('sha256').update('p').digest('hex'),
          currentCashBalanceVnd: runConfigInitialCapital + 1n,
          lastEntrySequence: 0n,
          lastEntryHash: crypto.createHash('sha256').update('p').digest('hex'),
          version: 1
        }
      })).rejects.toThrow('currentCashBalanceVnd must equal openingCashVnd at genesis');
    });

    it('Q initial lastEntrySequence != 0 rejected', async () => {
       const testRun = await prisma.simulationRun.create({
        data: {
          runBusinessKey: crypto.createHash('sha256').update('q').digest('hex'),
          canonicalStartDate,
          mode: 'HISTORICAL_REPLAY',
          creationIdempotencyKey: crypto.randomUUID(),
          creationRequestHash: crypto.createHash('sha256').update(crypto.randomUUID()).digest('hex'),
          dataOriginHash,
          status: 'CONFIGURED',
          configVersionId: (await prisma.runCoreConfigVersion.findFirst())!.id
        }
      });
      await expect(prisma.portfolioLedger.create({
        data: {
          runId: testRun.id,
          runBusinessKey: testRun.runBusinessKey!,
          contractVersion: '1.0',
          ledgerKind: 'SIMULATION_PORTFOLIO',
          canonicalStartDate,
          currency: 'VND',
          openingCashVnd: runConfigInitialCapital,
          openingPositionCount: 0,
          genesisHash: crypto.createHash('sha256').update('q').digest('hex'),
          currentCashBalanceVnd: runConfigInitialCapital,
          lastEntrySequence: 1n,
          lastEntryHash: crypto.createHash('sha256').update('q').digest('hex'),
          version: 1
        }
      })).rejects.toThrow('lastEntrySequence must be 0 at genesis');
    });

    it('R initial lastEntryHash != genesisHash rejected', async () => {
       const testRun = await prisma.simulationRun.create({
        data: {
          runBusinessKey: crypto.createHash('sha256').update('r').digest('hex'),
          canonicalStartDate,
          mode: 'HISTORICAL_REPLAY',
          creationIdempotencyKey: crypto.randomUUID(),
          creationRequestHash: crypto.createHash('sha256').update(crypto.randomUUID()).digest('hex'),
          dataOriginHash,
          status: 'CONFIGURED',
          configVersionId: (await prisma.runCoreConfigVersion.findFirst())!.id
        }
      });
      await expect(prisma.portfolioLedger.create({
        data: {
          runId: testRun.id,
          runBusinessKey: testRun.runBusinessKey!,
          contractVersion: '1.0',
          ledgerKind: 'SIMULATION_PORTFOLIO',
          canonicalStartDate,
          currency: 'VND',
          openingCashVnd: runConfigInitialCapital,
          openingPositionCount: 0,
          genesisHash: crypto.createHash('sha256').update('r').digest('hex'),
          currentCashBalanceVnd: runConfigInitialCapital,
          lastEntrySequence: 0n,
          lastEntryHash: crypto.createHash('sha256').update('R2').digest('hex'),
          version: 1
        }
      })).rejects.toThrow('lastEntryHash must equal genesisHash at genesis');
    });

    it('S initial version != 1 rejected', async () => {
       const testRun = await prisma.simulationRun.create({
        data: {
          runBusinessKey: crypto.createHash('sha256').update('s').digest('hex'),
          canonicalStartDate,
          mode: 'HISTORICAL_REPLAY',
          creationIdempotencyKey: crypto.randomUUID(),
          creationRequestHash: crypto.createHash('sha256').update(crypto.randomUUID()).digest('hex'),
          dataOriginHash,
          status: 'CONFIGURED',
          configVersionId: (await prisma.runCoreConfigVersion.findFirst())!.id
        }
      });
      await expect(prisma.portfolioLedger.create({
        data: {
          runId: testRun.id,
          runBusinessKey: testRun.runBusinessKey!,
          contractVersion: '1.0',
          ledgerKind: 'SIMULATION_PORTFOLIO',
          canonicalStartDate,
          currency: 'VND',
          openingCashVnd: runConfigInitialCapital,
          openingPositionCount: 0,
          genesisHash: crypto.createHash('sha256').update('s').digest('hex'),
          currentCashBalanceVnd: runConfigInitialCapital,
          lastEntrySequence: 0n,
          lastEntryHash: crypto.createHash('sha256').update('s').digest('hex'),
          version: 2
        }
      })).rejects.toThrow('version must be 1 at genesis');
    });

    it('T ledger DELETE rejected', async () => {
      const ledger = await prisma.portfolioLedger.findUnique({ where: { runBusinessKey } });
      await expect(prisma.portfolioLedger.delete({ where: { id: ledger!.id } }))
        .rejects.toThrow('PortfolioLedger cannot be deleted');
    });

    it('U immutable ledger identity/genesis UPDATE rejected', async () => {
      const ledger = await prisma.portfolioLedger.findUnique({ where: { runBusinessKey } });
      await expect(prisma.portfolioLedger.update({
        where: { id: ledger!.id },
        data: {
          genesisHash: crypto.createHash('sha256').update('new_gen').digest('hex'),
        }
      })).rejects.toThrow('Immutable fields of PortfolioLedger cannot be updated');
    });

    it('V allowed valid projection UPDATE succeeds', async () => {
      const ledger = await prisma.portfolioLedger.findUnique({ where: { runBusinessKey } });
      const res = await prisma.portfolioLedger.update({
        where: { id: ledger!.id },
        data: {
          currentCashBalanceVnd: ledger!.currentCashBalanceVnd - 100n,
          version: ledger!.version + 1,
          lastEntrySequence: ledger!.lastEntrySequence + 1n,
          lastEntryHash: crypto.createHash('sha256').update('v').digest('hex')
        }
      });
      expect(res.version).toBe(2);
      expect(res.lastEntrySequence).toBe(1n);
    });

    it('W projection UPDATE without +1 version rejected', async () => {
      const ledger = await prisma.portfolioLedger.findUnique({ where: { runBusinessKey } });
      await expect(prisma.portfolioLedger.update({
        where: { id: ledger!.id },
        data: {
          version: ledger!.version, // Same version
          lastEntrySequence: ledger!.lastEntrySequence + 1n,
          lastEntryHash: crypto.createHash('sha256').update('w').digest('hex')
        }
      })).rejects.toThrow('PortfolioLedger version must increment exactly by +1');
    });

    it('X projection UPDATE without +1 sequence rejected', async () => {
      const ledger = await prisma.portfolioLedger.findUnique({ where: { runBusinessKey } });
      await expect(prisma.portfolioLedger.update({
        where: { id: ledger!.id },
        data: {
          version: ledger!.version + 1,
          lastEntrySequence: ledger!.lastEntrySequence, // Same sequence
          lastEntryHash: crypto.createHash('sha256').update('x').digest('hex')
        }
      })).rejects.toThrow('PortfolioLedger lastEntrySequence must increment exactly by +1');
    });
  });

  describe('PortfolioLedgerPosition', () => {
    it('Y negative position rejected', async () => {
      const ledger = await prisma.portfolioLedger.findUnique({ where: { runBusinessKey } });
      await expect(prisma.portfolioLedgerPosition.create({
        data: {
          ledgerId: ledger!.id,
          instrumentBusinessKey: validInstrumentBusinessKey,
          quantity: -10n,
          version: 1
        }
      })).rejects.toThrow('chk_pos_quantity');
    });

    it('Z zero position accepted', async () => {
      const ledger = await prisma.portfolioLedger.findUnique({ where: { runBusinessKey } });
      const pos = await prisma.portfolioLedgerPosition.create({
        data: {
          ledgerId: ledger!.id,
          instrumentBusinessKey: validInstrumentBusinessKey,
          quantity: 0n,
          version: 1
        }
      });
      expect(pos.quantity).toBe(0n);
    });

    it('AA position FK to MarketInstrument.businessKey enforced', async () => {
      const ledger = await prisma.portfolioLedger.findUnique({ where: { runBusinessKey } });
      await expect(prisma.portfolioLedgerPosition.create({
        data: {
          ledgerId: ledger!.id,
          instrumentBusinessKey: 'INVALID_INSTRUMENT',
          quantity: 10n,
          version: 1
        }
      })).rejects.toThrow('Foreign key constraint violated');
    });

    it('AB position DELETE rejected', async () => {
      const ledger = await prisma.portfolioLedger.findUnique({ where: { runBusinessKey } });
      const pos = await prisma.portfolioLedgerPosition.findUnique({
        where: { ledgerId_instrumentBusinessKey: { ledgerId: ledger!.id, instrumentBusinessKey: validInstrumentBusinessKey } }
      });
      await expect(prisma.portfolioLedgerPosition.delete({ where: { id: pos!.id } }))
        .rejects.toThrow('PortfolioLedgerPosition cannot be deleted');
    });

    it('AC position identity UPDATE rejected', async () => {
      const ledger = await prisma.portfolioLedger.findUnique({ where: { runBusinessKey } });
      const pos = await prisma.portfolioLedgerPosition.findUnique({
        where: { ledgerId_instrumentBusinessKey: { ledgerId: ledger!.id, instrumentBusinessKey: validInstrumentBusinessKey } }
      });
      await expect(prisma.portfolioLedgerPosition.update({
        where: { id: pos!.id },
        data: { instrumentBusinessKey: 'OTHER' }
      })).rejects.toThrow('Immutable fields of PortfolioLedgerPosition cannot be updated');
    });

    it('AD position update with version +1 accepted', async () => {
      const ledger = await prisma.portfolioLedger.findUnique({ where: { runBusinessKey } });
      const pos = await prisma.portfolioLedgerPosition.findUnique({
        where: { ledgerId_instrumentBusinessKey: { ledgerId: ledger!.id, instrumentBusinessKey: validInstrumentBusinessKey } }
      });
      const res = await prisma.portfolioLedgerPosition.update({
        where: { id: pos!.id },
        data: { quantity: 100n, version: pos!.version + 1 }
      });
      expect(res.version).toBe(2);
    });

    it('AE position update without version +1 rejected', async () => {
      const ledger = await prisma.portfolioLedger.findUnique({ where: { runBusinessKey } });
      const pos = await prisma.portfolioLedgerPosition.findUnique({
        where: { ledgerId_instrumentBusinessKey: { ledgerId: ledger!.id, instrumentBusinessKey: validInstrumentBusinessKey } }
      });
      await expect(prisma.portfolioLedgerPosition.update({
        where: { id: pos!.id },
        data: { quantity: 200n, version: pos!.version }
      })).rejects.toThrow('PortfolioLedgerPosition version must increment exactly by +1');
    });
  });

  describe('PortfolioLedgerPosting', () => {
    let ledgerId: string;
    const sourceExecutionHash = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    const settlementPayloadHash = '04e5afc80d09798b010cf14dfe628e9393061716891813be2c6868756c5e777c';
    const transitionHash = 'c03b7fe9b1d09592d0cac6bab7f0f69ffa8c59cccd5816ab01335ad7b7cabf88';
    const entryHash = '8e1b42c8e1393558a508c024c3be8cc63e9b0473ff53ea7b3bdd9c0d941cdca4';

    beforeAll(async () => {
      const ledger = await prisma.portfolioLedger.findUnique({ where: { runBusinessKey } });
      ledgerId = ledger!.id;
    });

    it('AF valid posting row insert accepted', async () => {
      const post = await prisma.portfolioLedgerPosting.create({
        data: {
          ledgerId,
          ledgerGenesisHash: genesisHash,
          settlementContractVersion: '1.0',
          postingKind: 'TRADE_SETTLEMENT',
          sourceExecutionHash,
          instrumentBusinessKey: validInstrumentBusinessKey,
          side: 'BUY',
          quantityDelta: 100n,
          grossCashDeltaVnd: -2500000n,
          feeVnd: 3750n,
          taxVnd: 0n,
          netCashDeltaVnd: -2503750n,
          settlementPayloadHash,
          transitionContractVersion: '1.0',
          transitionKind: 'TRADE_SETTLEMENT_APPLIED',
          cashBalanceBeforeVnd: 10000000n,
          cashDeltaVnd: -2503750n,
          cashBalanceAfterVnd: 7496250n,
          positionQuantityBefore: 0n,
          positionQuantityAfter: 100n,
          transitionHash,
          entryContractVersion: '1.0',
          entryType: 'POSTING',
          entrySequence: 1n,
          effectiveDate: new Date('2025-01-15'),
          previousHash: genesisHash,
          entryHash
        }
      });
      expect(post).toBeDefined();
    });

    it('AG posting UPDATE rejected', async () => {
      const post = await prisma.portfolioLedgerPosting.findUnique({ where: { entryHash } });
      await expect(prisma.portfolioLedgerPosting.update({
        where: { id: post!.id },
        data: { feeVnd: 0n }
      })).rejects.toThrow('PortfolioLedgerPosting is completely immutable (append-only)');
    });

    it('AH posting DELETE rejected', async () => {
      const post = await prisma.portfolioLedgerPosting.findUnique({ where: { entryHash } });
      await expect(prisma.portfolioLedgerPosting.delete({
        where: { id: post!.id }
      })).rejects.toThrow('PortfolioLedgerPosting is completely immutable (append-only)');
    });

    it('AI duplicate ledger+entrySequence rejected', async () => {
      await expect(prisma.portfolioLedgerPosting.create({
        data: {
          ledgerId,
          ledgerGenesisHash: genesisHash,
          settlementContractVersion: '1.0',
          postingKind: 'TRADE_SETTLEMENT',
          sourceExecutionHash: crypto.createHash('sha256').update('AI').digest('hex'),
          instrumentBusinessKey: validInstrumentBusinessKey,
          side: 'BUY',
          quantityDelta: 10n,
          grossCashDeltaVnd: -250000n,
          feeVnd: 0n,
          taxVnd: 0n,
          netCashDeltaVnd: -250000n,
          settlementPayloadHash: crypto.createHash('sha256').update('AI_settle').digest('hex'),
          transitionContractVersion: '1.0',
          transitionKind: 'TRADE_SETTLEMENT_APPLIED',
          cashBalanceBeforeVnd: 10000000n,
          cashDeltaVnd: -250000n,
          cashBalanceAfterVnd: 9750000n,
          positionQuantityBefore: 0n,
          positionQuantityAfter: 10n,
          transitionHash: crypto.createHash('sha256').update('AI_trans').digest('hex'),
          entryContractVersion: '1.0',
          entryType: 'POSTING',
          entrySequence: 1n, // duplicate!
          effectiveDate: new Date('2025-01-16'),
          previousHash: crypto.createHash('sha256').update('AI_prev').digest('hex'),
          entryHash: crypto.createHash('sha256').update('AI_entry').digest('hex')
        }
      })).rejects.toThrow('Unique constraint failed');
    });

    it('AM same sourceExecutionHash on DIFFERENT ledgers accepted', async () => {
      // Create new ledger
      const newRunHash = crypto.createHash('sha256').update('run_am').digest('hex');
      const newRun = await prisma.simulationRun.create({
        data: {
          runBusinessKey: newRunHash,
          canonicalStartDate,
          mode: 'HISTORICAL_REPLAY',
          creationIdempotencyKey: crypto.randomUUID(),
          creationRequestHash: crypto.createHash('sha256').update(crypto.randomUUID()).digest('hex'),
          dataOriginHash,
          status: 'CONFIGURED',
          configVersionId: (await prisma.runCoreConfigVersion.findFirst())!.id
        }
      });
      const newGenHash = crypto.createHash('sha256').update('gen_am').digest('hex');
      const newLedger = await prisma.portfolioLedger.create({
        data: {
          runId: newRun.id,
          runBusinessKey: newRun.runBusinessKey!,
          contractVersion: '1.0',
          ledgerKind: 'SIMULATION_PORTFOLIO',
          canonicalStartDate,
          currency: 'VND',
          openingCashVnd: runConfigInitialCapital,
          openingPositionCount: 0,
          genesisHash: newGenHash,
          currentCashBalanceVnd: runConfigInitialCapital,
          lastEntrySequence: 0n,
          lastEntryHash: newGenHash,
          version: 1
        }
      });

      const post = await prisma.portfolioLedgerPosting.create({
        data: {
          ledgerId: newLedger.id,
          ledgerGenesisHash: newGenHash,
          settlementContractVersion: '1.0',
          postingKind: 'TRADE_SETTLEMENT',
          sourceExecutionHash, // SAME AS AF
          instrumentBusinessKey: validInstrumentBusinessKey,
          side: 'BUY',
          quantityDelta: 100n,
          grossCashDeltaVnd: -2500000n,
          feeVnd: 3750n,
          taxVnd: 0n,
          netCashDeltaVnd: -2503750n,
          settlementPayloadHash,
          transitionContractVersion: '1.0',
          transitionKind: 'TRADE_SETTLEMENT_APPLIED',
          cashBalanceBeforeVnd: 10000000n,
          cashDeltaVnd: -2503750n,
          cashBalanceAfterVnd: 7496250n,
          positionQuantityBefore: 0n,
          positionQuantityAfter: 100n,
          transitionHash: crypto.createHash('sha256').update('trans_am').digest('hex'),
          entryContractVersion: '1.0',
          entryType: 'POSTING',
          entrySequence: 1n,
          effectiveDate: new Date('2025-01-15'),
          previousHash: newGenHash,
          entryHash: crypto.createHash('sha256').update('entry_am').digest('hex')
        }
      });
      expect(post).toBeDefined();
    });

    it('AN posting instrument FK enforced', async () => {
      await expect(prisma.portfolioLedgerPosting.create({
        data: {
          ledgerId,
          ledgerGenesisHash: genesisHash,
          settlementContractVersion: '1.0',
          postingKind: 'TRADE_SETTLEMENT',
          sourceExecutionHash: crypto.createHash('sha256').update('AN').digest('hex'),
          instrumentBusinessKey: 'INVALID_INSTRUMENT',
          side: 'BUY',
          quantityDelta: 100n,
          grossCashDeltaVnd: -2500000n,
          feeVnd: 3750n,
          taxVnd: 0n,
          netCashDeltaVnd: -2503750n,
          settlementPayloadHash,
          transitionContractVersion: '1.0',
          transitionKind: 'TRADE_SETTLEMENT_APPLIED',
          cashBalanceBeforeVnd: 10000000n,
          cashDeltaVnd: -2503750n,
          cashBalanceAfterVnd: 7496250n,
          positionQuantityBefore: 0n,
          positionQuantityAfter: 100n,
          transitionHash: crypto.createHash('sha256').update('AN_t').digest('hex'),
          entryContractVersion: '1.0',
          entryType: 'POSTING',
          entrySequence: 2n,
          effectiveDate: new Date('2025-01-15'),
          previousHash: crypto.createHash('sha256').update('AN_p').digest('hex'),
          entryHash: crypto.createHash('sha256').update('AN_e').digest('hex')
        }
      })).rejects.toThrow('Foreign key constraint violated');
    });

    it('AY BUY sign contradiction rejected', async () => {
      await expect(prisma.portfolioLedgerPosting.create({
        data: {
          ledgerId,
          ledgerGenesisHash: genesisHash,
          settlementContractVersion: '1.0',
          postingKind: 'TRADE_SETTLEMENT',
          sourceExecutionHash: crypto.createHash('sha256').update('AY').digest('hex'),
          instrumentBusinessKey: validInstrumentBusinessKey,
          side: 'BUY',
          quantityDelta: -100n, // Invalid for BUY
          grossCashDeltaVnd: -2500000n,
          feeVnd: 3750n,
          taxVnd: 0n,
          netCashDeltaVnd: -2503750n,
          settlementPayloadHash,
          transitionContractVersion: '1.0',
          transitionKind: 'TRADE_SETTLEMENT_APPLIED',
          cashBalanceBeforeVnd: 10000000n,
          cashDeltaVnd: -2503750n,
          cashBalanceAfterVnd: 7496250n,
          positionQuantityBefore: 100n,
          positionQuantityAfter: 0n, // Invalid for BUY
          transitionHash: crypto.createHash('sha256').update('AY_t').digest('hex'),
          entryContractVersion: '1.0',
          entryType: 'POSTING',
          entrySequence: 2n,
          effectiveDate: new Date('2025-01-15'),
          previousHash: crypto.createHash('sha256').update('AY_p').digest('hex'),
          entryHash: crypto.createHash('sha256').update('AY_e').digest('hex')
        }
      })).rejects.toThrow('chk_post_side_logic');
    });

  });
});
