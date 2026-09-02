import { PrismaClient, Prisma } from '@prisma/client';
import { CanonicalDate } from '../../../domain/models/CanonicalDate';
import { PortfolioLedgerGenesisDomain } from '../../../domain/portfolio-ledger/PortfolioLedgerGenesis';
import { PortfolioLedgerTradeSettlementDomain } from '../../../domain/portfolio-ledger/PortfolioLedgerTradeSettlement';
import { PortfolioLedgerPostingDomain } from '../../../domain/portfolio-ledger/PortfolioLedgerPosting';
import {
  PortfolioLedgerVerificationRepository,
  VerifyPortfolioLedgerCommand,
  VerifiedPortfolioLedgerSnapshot,
  VerifiedPortfolioPosition,
  PortfolioLedgerVerificationRunNotFoundError,
  PortfolioLedgerVerificationLedgerNotFoundError,
  PortfolioLedgerVerificationIntegrityError,
  PortfolioLedgerVerificationConcurrencyError
} from '../../../application/ports/portfolio-ledger/PortfolioLedgerVerificationRepositoryPorts';

export class PrismaPortfolioLedgerVerificationRepository implements PortfolioLedgerVerificationRepository {

  private handlePrismaError(error: unknown): never {
    if (
      error instanceof PortfolioLedgerVerificationRunNotFoundError ||
      error instanceof PortfolioLedgerVerificationLedgerNotFoundError ||
      error instanceof PortfolioLedgerVerificationIntegrityError ||
      error instanceof PortfolioLedgerVerificationConcurrencyError
    ) {
      throw error;
    }
    
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2034') {
        throw new PortfolioLedgerVerificationConcurrencyError(error.message);
      }
      if (error.code.startsWith('P2')) {
        throw new PortfolioLedgerVerificationIntegrityError(error.message);
      }
    }
    
    if (
      error instanceof Prisma.PrismaClientUnknownRequestError ||
      error instanceof Prisma.PrismaClientValidationError ||
      error instanceof Prisma.PrismaClientInitializationError ||
      error instanceof Prisma.PrismaClientRustPanicError
    ) {
      throw new PortfolioLedgerVerificationIntegrityError((error as Error).message);
    }
    
    throw error;
  }

  constructor(private readonly prisma: PrismaClient) {}

  public async verify(command: VerifyPortfolioLedgerCommand): Promise<VerifiedPortfolioLedgerSnapshot> {
    try {
      return await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // 1. read SimulationRun
        const run = await tx.simulationRun.findUnique({ where: { id: command.runId } });
        if (!run) throw new PortfolioLedgerVerificationRunNotFoundError();

        // 2. read RunCoreConfigVersion
        const config = await tx.runCoreConfigVersion.findUnique({ where: { id: run.configVersionId } });

        // 3. read PortfolioLedger
        const ledger = await tx.portfolioLedger.findUnique({ where: { runId: command.runId } });
        if (!ledger) {
          throw new PortfolioLedgerVerificationLedgerNotFoundError();
        }

        if (run.status === 'INITIALIZED') {
          throw new PortfolioLedgerVerificationIntegrityError('Legitimate ledger exists for INITIALIZED run');
        }

        if (!config) throw new PortfolioLedgerVerificationIntegrityError('Config not found');
        if (config.initialCapital < 0n) throw new PortfolioLedgerVerificationIntegrityError('Negative initialCapital');
        
        // 4. validate parent structural fields ONLY AFTER ledger exists
        if (
          !run.runBusinessKey ||
          run.runBusinessKey.length !== 64 ||
          !/^[0-9a-f]{64}$/.test(run.runBusinessKey)
        ) {
          throw new PortfolioLedgerVerificationIntegrityError('Malformed runBusinessKey');
        }
        if (!run.canonicalStartDate) throw new PortfolioLedgerVerificationIntegrityError('Missing canonicalStartDate');
        if (!run.dataOriginHash || run.dataOriginHash.trim() === '') throw new PortfolioLedgerVerificationIntegrityError('Missing dataOriginHash');
        if (!run.configVersionId) throw new PortfolioLedgerVerificationIntegrityError('Missing configVersionId');
        
        let canonicalRunDate: string;
        try {
          canonicalRunDate = new CanonicalDate(run.canonicalStartDate.toISOString().slice(0, 10)).value;
        } catch {
          throw new PortfolioLedgerVerificationIntegrityError('Invalid canonicalStartDate format');
        }

        // Rebuild genesis
        let genesis;
        try {
          genesis = PortfolioLedgerGenesisDomain.build({
            runBusinessKey: run.runBusinessKey,
            canonicalStartDate: canonicalRunDate,
            initialCapitalVnd: config.initialCapital
          });
        } catch (e: unknown) {
          throw new PortfolioLedgerVerificationIntegrityError('Genesis rebuild failed: ' + (e as Error).message);
        }

        // Verify Immutable Ledger Root
        if (ledger.runId !== run.id) throw new PortfolioLedgerVerificationIntegrityError('runId mismatch');
        if (ledger.runBusinessKey !== genesis.runBusinessKey) throw new PortfolioLedgerVerificationIntegrityError('runBusinessKey mismatch');
        if (ledger.contractVersion !== genesis.contractVersion) throw new PortfolioLedgerVerificationIntegrityError('contractVersion mismatch');
        if (ledger.ledgerKind !== genesis.ledgerKind) throw new PortfolioLedgerVerificationIntegrityError('ledgerKind mismatch');
        
        let ledgerCanonicalDate: string;
        try {
          ledgerCanonicalDate = new CanonicalDate(ledger.canonicalStartDate.toISOString().slice(0, 10)).value;
        } catch {
          throw new PortfolioLedgerVerificationIntegrityError('Ledger canonicalStartDate invalid');
        }
        if (ledgerCanonicalDate !== genesis.canonicalStartDate) throw new PortfolioLedgerVerificationIntegrityError('canonicalStartDate mismatch');
        if (ledger.currency !== genesis.currency) throw new PortfolioLedgerVerificationIntegrityError('currency mismatch');
        if (ledger.openingCashVnd !== BigInt(genesis.openingCashVnd)) throw new PortfolioLedgerVerificationIntegrityError('openingCashVnd mismatch');
        if (ledger.openingPositionCount !== genesis.openingPositionCount) throw new PortfolioLedgerVerificationIntegrityError('openingPositionCount mismatch');
        if (ledger.genesisHash !== genesis.genesisHash) throw new PortfolioLedgerVerificationIntegrityError('genesisHash mismatch');

        // Safe ledger sequence
        if (ledger.lastEntrySequence < 0n || ledger.lastEntrySequence > 9007199254740991n) {
          throw new PortfolioLedgerVerificationIntegrityError('ledger.lastEntrySequence out of bounds');
        }

        // 4. read PortfolioLedgerPosting
        const postings = await tx.portfolioLedgerPosting.findMany({
          where: { ledgerId: ledger.id },
          orderBy: { entrySequence: 'asc' }
        });

        // 5. read PortfolioLedgerPosition
        const dbPositions = await tx.portfolioLedgerPosition.findMany({
          where: { ledgerId: ledger.id },
          orderBy: { instrumentBusinessKey: 'asc' }
        });

        const postingCount = postings.length;

        // Postings loop
        let expectedPreviousHash = genesis.genesisHash;
        let expectedCash = BigInt(genesis.openingCashVnd);
        const positionQuantityMap = new Map<string, bigint>();
        const positionVersionMap = new Map<string, number>();

        for (let i = 0; i < postingCount; i++) {
          const row = postings[i];
          const expectedSequence = BigInt(i + 1);

          if (row.entrySequence !== expectedSequence) throw new PortfolioLedgerVerificationIntegrityError('Posting sequence gap/mismatch');
          if (row.ledgerId !== ledger.id) throw new PortfolioLedgerVerificationIntegrityError('Posting ledgerId mismatch');
          if (row.ledgerGenesisHash !== ledger.genesisHash) throw new PortfolioLedgerVerificationIntegrityError('Posting ledgerGenesisHash mismatch');
          if (row.previousHash !== expectedPreviousHash) throw new PortfolioLedgerVerificationIntegrityError('Posting previousHash chain broken');

          let rebuiltSettlement;
          try {
            rebuiltSettlement = PortfolioLedgerTradeSettlementDomain.build({
              sourceExecutionHash: row.sourceExecutionHash,
              instrumentBusinessKey: row.instrumentBusinessKey,
              quantityDelta: row.quantityDelta,
              grossCashDeltaVnd: row.grossCashDeltaVnd,
              feeVnd: row.feeVnd,
              taxVnd: row.taxVnd
            });
          } catch (e: unknown) {
            throw new PortfolioLedgerVerificationIntegrityError('Settlement rebuild failed: ' + (e as Error).message);
          }

          if (rebuiltSettlement.contractVersion !== row.settlementContractVersion) throw new PortfolioLedgerVerificationIntegrityError('Settlement contractVersion mismatch');
          if (rebuiltSettlement.postingKind !== row.postingKind) throw new PortfolioLedgerVerificationIntegrityError('Settlement postingKind mismatch');
          if (rebuiltSettlement.sourceExecutionHash !== row.sourceExecutionHash) throw new PortfolioLedgerVerificationIntegrityError('Settlement sourceExecutionHash mismatch');
          if (rebuiltSettlement.instrumentBusinessKey !== row.instrumentBusinessKey) throw new PortfolioLedgerVerificationIntegrityError('Settlement instrumentBusinessKey mismatch');
          if (rebuiltSettlement.side !== row.side) throw new PortfolioLedgerVerificationIntegrityError('Settlement side mismatch');
          if (BigInt(rebuiltSettlement.quantityDelta) !== row.quantityDelta) throw new PortfolioLedgerVerificationIntegrityError('Settlement quantityDelta mismatch');
          if (BigInt(rebuiltSettlement.grossCashDeltaVnd) !== row.grossCashDeltaVnd) throw new PortfolioLedgerVerificationIntegrityError('Settlement grossCashDeltaVnd mismatch');
          if (BigInt(rebuiltSettlement.feeVnd) !== row.feeVnd) throw new PortfolioLedgerVerificationIntegrityError('Settlement feeVnd mismatch');
          if (BigInt(rebuiltSettlement.taxVnd) !== row.taxVnd) throw new PortfolioLedgerVerificationIntegrityError('Settlement taxVnd mismatch');
          if (BigInt(rebuiltSettlement.netCashDeltaVnd) !== row.netCashDeltaVnd) throw new PortfolioLedgerVerificationIntegrityError('Settlement netCashDeltaVnd mismatch');
          if (rebuiltSettlement.payloadHash !== row.settlementPayloadHash) throw new PortfolioLedgerVerificationIntegrityError('Settlement payloadHash mismatch');

          let canonicalEffectiveDate: string;
          try {
            canonicalEffectiveDate = new CanonicalDate(row.effectiveDate.toISOString().slice(0, 10)).value;
          } catch {
            throw new PortfolioLedgerVerificationIntegrityError('Invalid posting effectiveDate');
          }

          let recomposedPosting;
          try {
            recomposedPosting = PortfolioLedgerPostingDomain.compose({
              ledgerGenesisHash: row.ledgerGenesisHash,
              entrySequence: (row.entrySequence >= 1n && row.entrySequence <= 9007199254740991n) ? Number(row.entrySequence) : (() => { throw new PortfolioLedgerVerificationIntegrityError('Posting entrySequence out of bounds'); })(),
              effectiveDate: canonicalEffectiveDate,
              previousHash: row.previousHash,
              cashBalanceBeforeVnd: row.cashBalanceBeforeVnd,
              positionQuantityBefore: row.positionQuantityBefore,
              settlement: rebuiltSettlement
            });
          } catch (e: unknown) {
            throw new PortfolioLedgerVerificationIntegrityError('Posting recompose failed: ' + (e as Error).message);
          }

          if (recomposedPosting.transition.contractVersion !== row.transitionContractVersion) throw new PortfolioLedgerVerificationIntegrityError('Transition contractVersion mismatch');
          if (recomposedPosting.transition.transitionKind !== row.transitionKind) throw new PortfolioLedgerVerificationIntegrityError('Transition transitionKind mismatch');
          if (BigInt(recomposedPosting.transition.cashBalanceBeforeVnd) !== row.cashBalanceBeforeVnd) throw new PortfolioLedgerVerificationIntegrityError('Transition cashBalanceBeforeVnd mismatch');
          if (BigInt(recomposedPosting.transition.cashDeltaVnd) !== row.cashDeltaVnd) throw new PortfolioLedgerVerificationIntegrityError('Transition cashDeltaVnd mismatch');
          if (BigInt(recomposedPosting.transition.cashBalanceAfterVnd) !== row.cashBalanceAfterVnd) throw new PortfolioLedgerVerificationIntegrityError('Transition cashBalanceAfterVnd mismatch');
          if (BigInt(recomposedPosting.transition.positionQuantityBefore) !== row.positionQuantityBefore) throw new PortfolioLedgerVerificationIntegrityError('Transition positionQuantityBefore mismatch');
          if (BigInt(recomposedPosting.transition.positionQuantityAfter) !== row.positionQuantityAfter) throw new PortfolioLedgerVerificationIntegrityError('Transition positionQuantityAfter mismatch');
          if (recomposedPosting.transition.transitionHash !== row.transitionHash) throw new PortfolioLedgerVerificationIntegrityError('Transition transitionHash mismatch');

          if (recomposedPosting.entry.contractVersion !== row.entryContractVersion) throw new PortfolioLedgerVerificationIntegrityError('Entry contractVersion mismatch');
          if (recomposedPosting.entry.entryType !== row.entryType) throw new PortfolioLedgerVerificationIntegrityError('Entry entryType mismatch');
          if (BigInt(recomposedPosting.entry.entrySequence) !== row.entrySequence) throw new PortfolioLedgerVerificationIntegrityError('Entry entrySequence mismatch');
          if (recomposedPosting.entry.effectiveDate !== canonicalEffectiveDate) throw new PortfolioLedgerVerificationIntegrityError('Entry effectiveDate mismatch');
          if (recomposedPosting.entry.previousHash !== row.previousHash) throw new PortfolioLedgerVerificationIntegrityError('Entry previousHash mismatch');
          if (recomposedPosting.entry.entryHash !== row.entryHash) throw new PortfolioLedgerVerificationIntegrityError('Entry entryHash mismatch');
          if (recomposedPosting.entry.ledgerGenesisHash !== row.ledgerGenesisHash) throw new PortfolioLedgerVerificationIntegrityError('Entry ledgerGenesisHash mismatch');
          if (recomposedPosting.entry.payloadHash !== row.transitionHash) throw new PortfolioLedgerVerificationIntegrityError('Entry payloadHash/transitionHash invariant broken');

          if (row.cashBalanceBeforeVnd !== expectedCash) throw new PortfolioLedgerVerificationIntegrityError('cashBalanceBeforeVnd replay mismatch');
          expectedCash = row.cashBalanceAfterVnd;

          const expectedBeforeQty = positionQuantityMap.get(row.instrumentBusinessKey) ?? 0n;
          if (row.positionQuantityBefore !== expectedBeforeQty) throw new PortfolioLedgerVerificationIntegrityError('positionQuantityBefore replay mismatch');
          
          positionQuantityMap.set(row.instrumentBusinessKey, row.positionQuantityAfter);
          positionVersionMap.set(row.instrumentBusinessKey, (positionVersionMap.get(row.instrumentBusinessKey) ?? 0) + 1);

          expectedPreviousHash = row.entryHash;
        }

        if (ledger.currentCashBalanceVnd !== expectedCash) throw new PortfolioLedgerVerificationIntegrityError('ledger.currentCashBalanceVnd mismatch');

        const distinctInstrumentsInPostings = new Set(positionVersionMap.keys());
        const distinctInstrumentsInPositions = new Set(dbPositions.map(p => p.instrumentBusinessKey));

        if (distinctInstrumentsInPostings.size !== distinctInstrumentsInPositions.size) {
          throw new PortfolioLedgerVerificationIntegrityError('Position set size mismatch');
        }

        for (const inst of distinctInstrumentsInPostings) {
          if (!distinctInstrumentsInPositions.has(inst)) throw new PortfolioLedgerVerificationIntegrityError('Position set missing row');
        }

        const finalPositions: VerifiedPortfolioPosition[] = [];

        for (const pos of dbPositions) {
          const expectedQty = positionQuantityMap.get(pos.instrumentBusinessKey) ?? 0n;
          const expectedVersion = positionVersionMap.get(pos.instrumentBusinessKey) ?? 0;
          if (pos.quantity !== expectedQty) throw new PortfolioLedgerVerificationIntegrityError('Position quantity mismatch');
          if (pos.version !== expectedVersion) throw new PortfolioLedgerVerificationIntegrityError('Position version mismatch');
          if (expectedVersion <= 0 || expectedVersion > 9007199254740991) throw new PortfolioLedgerVerificationIntegrityError('Position version out of bounds');

          finalPositions.push({
            instrumentBusinessKey: pos.instrumentBusinessKey,
            quantity: pos.quantity,
            version: pos.version
          });
        }

        if (postingCount === 0) {
          if (ledger.lastEntrySequence !== 0n) throw new PortfolioLedgerVerificationIntegrityError('ledger.lastEntrySequence must be 0 for empty ledger');
          if (ledger.lastEntryHash !== genesis.genesisHash) throw new PortfolioLedgerVerificationIntegrityError('ledger.lastEntryHash mismatch for empty ledger');
          if (ledger.version !== 1) throw new PortfolioLedgerVerificationIntegrityError('ledger.version mismatch for empty ledger');
          if (finalPositions.length !== 0) throw new PortfolioLedgerVerificationIntegrityError('positions must be empty for empty ledger');
        } else {
          if (ledger.lastEntrySequence !== BigInt(postingCount)) throw new PortfolioLedgerVerificationIntegrityError('ledger.lastEntrySequence mismatch');
          if (ledger.lastEntryHash !== postings[postingCount - 1].entryHash) throw new PortfolioLedgerVerificationIntegrityError('ledger.lastEntryHash mismatch');
        }

        if (ledger.version !== 1 + postingCount) throw new PortfolioLedgerVerificationIntegrityError('ledger.version mismatch');

        return {
          runId: run.id,
          ledgerId: ledger.id,
          genesis: genesis,
          postingCount: postingCount,
          currentCashBalanceVnd: ledger.currentCashBalanceVnd,
          lastEntrySequence: Number(ledger.lastEntrySequence),
          lastEntryHash: ledger.lastEntryHash,
          ledgerVersion: ledger.version,
          positions: finalPositions
        };

      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 15000, timeout: 30000 });
    } catch (e: unknown) {
      this.handlePrismaError(e);
    }
  }
}
