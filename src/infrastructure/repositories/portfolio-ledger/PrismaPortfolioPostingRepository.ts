import { PrismaClient, Prisma, PortfolioLedgerPosting as PrismaPortfolioLedgerPosting } from '@prisma/client';
import {
  AppendPortfolioPostingCommand,
  PortfolioPostingPersistenceDisposition,
  PersistedPortfolioPostingResult,
  PortfolioPostingRepository,
  PortfolioLedgerNotFoundError,
  PortfolioInstrumentNotFoundError,
  PortfolioPostingIdempotencyCollisionError,
  PortfolioPostingChainConflictError,
  PortfolioPostingIntegrityError,
  PortfolioPostingConcurrencyError
} from '../../../application/ports/portfolio-ledger/PortfolioPostingRepositoryPorts';
import { CanonicalDate } from '../../../domain/models/CanonicalDate';
import { PortfolioLedgerTradeSettlementDomain } from '../../../domain/portfolio-ledger/PortfolioLedgerTradeSettlement';
import { PortfolioLedgerPostingDomain, PortfolioLedgerPostingInvalidError } from '../../../domain/portfolio-ledger/PortfolioLedgerPosting';
import { PortfolioLedgerPosting } from '../../../domain/contracts/PortfolioLedgerPostingContracts';

type LockedPortfolioLedgerRow = {
  id: string;
  genesisHash: string;
  currentCashBalanceVnd: bigint;
  lastEntrySequence: bigint;
  lastEntryHash: string;
  version: number;
};

type LockedPortfolioLedgerPositionRow = {
  id: string;
  quantity: bigint;
  version: number;
};

export function deriveNextPortfolioEntrySequence(lastEntrySequence: bigint): number {
  if (lastEntrySequence < 0n) {
    throw new PortfolioPostingIntegrityError('Ledger sequence exhaustion or invalid sequence.');
  }
  const next = lastEntrySequence + 1n;
  if (next > 9007199254740991n) {
    throw new PortfolioPostingIntegrityError('Ledger sequence exhaustion or invalid sequence.');
  }
  return Number(next);
}

export class PrismaPortfolioPostingRepository implements PortfolioPostingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  public async append(command: AppendPortfolioPostingCommand): Promise<PersistedPortfolioPostingResult> {
    let canonicalEffectiveDate: string;
    try {
      canonicalEffectiveDate = new CanonicalDate(command.effectiveDate).value;
    } catch (e) {
      throw new PortfolioLedgerPostingInvalidError('Invalid effectiveDate');
    }

    const canonicalSettlement = PortfolioLedgerTradeSettlementDomain.build(command.settlement);

    const precheckRow = await this.findPostingByIdentityRoot(
      command.ledgerId,
      canonicalSettlement.sourceExecutionHash
    );

    if (precheckRow) {
      this.verifyReplayEquivalence(precheckRow, canonicalSettlement.payloadHash, canonicalEffectiveDate);
      return {
        disposition: 'REPLAYED' as const,
        posting: this.mapAndVerifyPersistedPosting(precheckRow)
      };
    }

    try {
      return await this.prisma.$transaction(
        async (tx: Prisma.TransactionClient): Promise<PersistedPortfolioPostingResult> => {
          const ledgerRows = await tx.$queryRaw<LockedPortfolioLedgerRow[]>`
            SELECT
              "id",
              "genesisHash",
              "currentCashBalanceVnd",
              "lastEntrySequence",
              "lastEntryHash",
              "version"
            FROM "PortfolioLedger"
            WHERE "id" = ${command.ledgerId}
            FOR UPDATE
          `;

          if (ledgerRows.length === 0) {
            throw new PortfolioLedgerNotFoundError();
          }
          if (ledgerRows.length > 1) {
            throw new PortfolioPostingIntegrityError('Multiple ledgers found for id.');
          }
          const lockedLedger = ledgerRows[0];

          const postLockRow = await tx.portfolioLedgerPosting.findUnique({
            where: {
              ledgerId_sourceExecutionHash: {
                ledgerId: command.ledgerId,
                sourceExecutionHash: canonicalSettlement.sourceExecutionHash
              }
            }
          });

          if (postLockRow) {
            this.verifyReplayEquivalence(postLockRow, canonicalSettlement.payloadHash, canonicalEffectiveDate);
            return {
              disposition: 'REPLAYED',
              posting: this.mapAndVerifyPersistedPosting(postLockRow)
            };
          }

          const instrument = await tx.marketInstrument.findUnique({
            where: { businessKey: canonicalSettlement.instrumentBusinessKey }
          });
          if (!instrument) {
            throw new PortfolioInstrumentNotFoundError();
          }

          const positionRows = await tx.$queryRaw<LockedPortfolioLedgerPositionRow[]>`
            SELECT
              "id",
              "quantity",
              "version"
            FROM "PortfolioLedgerPosition"
            WHERE
              "ledgerId" = ${command.ledgerId}
              AND
              "instrumentBusinessKey" = ${canonicalSettlement.instrumentBusinessKey}
            FOR UPDATE
          `;

          if (positionRows.length > 1) {
            throw new PortfolioPostingIntegrityError('Multiple positions found.');
          }
          const lockedPosition = positionRows.length === 1 ? positionRows[0] : null;

          const ledgerGenesisHash = lockedLedger.genesisHash;
          const cashBalanceBeforeVnd = lockedLedger.currentCashBalanceVnd;
          const previousHash = lockedLedger.lastEntryHash;
          const positionQuantityBefore = lockedPosition ? lockedPosition.quantity : 0n;

          const entrySequence = deriveNextPortfolioEntrySequence(lockedLedger.lastEntrySequence);

          const posting = PortfolioLedgerPostingDomain.compose({
            ledgerGenesisHash,
            entrySequence,
            effectiveDate: canonicalEffectiveDate,
            previousHash,
            cashBalanceBeforeVnd,
            positionQuantityBefore,
            settlement: canonicalSettlement
          });

          await tx.portfolioLedgerPosting.create({
            data: {
              ledgerId: command.ledgerId,
              ledgerGenesisHash: posting.entry.ledgerGenesisHash,
              settlementContractVersion: canonicalSettlement.contractVersion,
              postingKind: canonicalSettlement.postingKind,
              sourceExecutionHash: canonicalSettlement.sourceExecutionHash,
              instrumentBusinessKey: canonicalSettlement.instrumentBusinessKey,
              side: canonicalSettlement.side,
              quantityDelta: BigInt(canonicalSettlement.quantityDelta),
              grossCashDeltaVnd: BigInt(canonicalSettlement.grossCashDeltaVnd),
              feeVnd: BigInt(canonicalSettlement.feeVnd),
              taxVnd: BigInt(canonicalSettlement.taxVnd),
              netCashDeltaVnd: BigInt(canonicalSettlement.netCashDeltaVnd),
              settlementPayloadHash: canonicalSettlement.payloadHash,

              transitionContractVersion: posting.transition.contractVersion,
              transitionKind: posting.transition.transitionKind,
              cashBalanceBeforeVnd: BigInt(posting.transition.cashBalanceBeforeVnd),
              cashDeltaVnd: BigInt(posting.transition.cashDeltaVnd),
              cashBalanceAfterVnd: BigInt(posting.transition.cashBalanceAfterVnd),
              positionQuantityBefore: BigInt(posting.transition.positionQuantityBefore),
              positionQuantityAfter: BigInt(posting.transition.positionQuantityAfter),
              transitionHash: posting.transition.transitionHash,

              entryContractVersion: posting.entry.contractVersion,
              entryType: posting.entry.entryType,
              entrySequence: BigInt(posting.entry.entrySequence),
              effectiveDate: new Date(`${posting.entry.effectiveDate}T00:00:00.000Z`),
              previousHash: posting.entry.previousHash,
              entryHash: posting.entry.entryHash
            }
          });

          if (lockedPosition) {
            await tx.portfolioLedgerPosition.update({
              where: {
                ledgerId_instrumentBusinessKey: {
                  ledgerId: command.ledgerId,
                  instrumentBusinessKey: canonicalSettlement.instrumentBusinessKey
                }
              },
              data: {
                quantity: BigInt(posting.transition.positionQuantityAfter),
                version: lockedPosition.version + 1
              }
            });
          } else {
            await tx.portfolioLedgerPosition.create({
              data: {
                ledgerId: command.ledgerId,
                instrumentBusinessKey: canonicalSettlement.instrumentBusinessKey,
                quantity: BigInt(posting.transition.positionQuantityAfter),
                version: 1
              }
            });
          }

          await tx.portfolioLedger.update({
            where: { id: command.ledgerId },
            data: {
              currentCashBalanceVnd: BigInt(posting.transition.cashBalanceAfterVnd),
              lastEntrySequence: BigInt(posting.entry.entrySequence),
              lastEntryHash: posting.entry.entryHash,
              version: lockedLedger.version + 1
            }
          });

          return {
            disposition: 'CREATED' as const,
            posting
          } as PersistedPortfolioPostingResult;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          maxWait: 15000,
          timeout: 20000
        }
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        if (this.isTargetingSourceExecutionHash(error.meta?.target)) {
          const winnerRow = await this.findPostingByIdentityRoot(
            command.ledgerId,
            canonicalSettlement.sourceExecutionHash
          );

          if (!winnerRow) {
            throw new PortfolioPostingIntegrityError('Winner row missing after unique constraint abort.');
          }

          this.verifyReplayEquivalence(winnerRow, canonicalSettlement.payloadHash, canonicalEffectiveDate);
          
          return {
            disposition: 'REPLAYED' as const,
            posting: this.mapAndVerifyPersistedPosting(winnerRow)
          } as PersistedPortfolioPostingResult;
        }
        if (this.isTargetingChain(error.meta?.target)) {
          throw new PortfolioPostingChainConflictError();
        }
      }

      this.handlePrismaError(error);
    }
  }

  private async findPostingByIdentityRoot(
    ledgerId: string,
    sourceExecutionHash: string
  ): Promise<PrismaPortfolioLedgerPosting | null> {
    try {
      return await this.prisma.portfolioLedgerPosting.findUnique({
        where: {
          ledgerId_sourceExecutionHash: {
            ledgerId,
            sourceExecutionHash
          }
        }
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  private isTargetingSourceExecutionHash(target: unknown): boolean {
    if (typeof target === 'string') {
      return target.includes('sourceExecutionHash');
    }
    if (Array.isArray(target)) {
      return target.some(t => typeof t === 'string' && t.includes('sourceExecutionHash'));
    }
    return false;
  }

  private isTargetingChain(target: unknown): boolean {
    if (typeof target === 'string') {
      return (
        target.includes('entrySequence') ||
        target.includes('previousHash') ||
        target.includes('transitionHash') ||
        target.includes('entryHash')
      );
    }
    if (Array.isArray(target)) {
      return target.some(
        t =>
          typeof t === 'string' &&
          (t.includes('entrySequence') ||
            t.includes('previousHash') ||
            t.includes('transitionHash') ||
            t.includes('entryHash'))
      );
    }
    return false;
  }

  private verifyReplayEquivalence(
    row: PrismaPortfolioLedgerPosting,
    canonicalPayloadHash: string,
    canonicalEffectiveDate: string
  ): void {
    const rowEffectiveDate = row.effectiveDate.toISOString().slice(0, 10);
    if (
      row.settlementPayloadHash !== canonicalPayloadHash ||
      rowEffectiveDate !== canonicalEffectiveDate
    ) {
      throw new PortfolioPostingIdempotencyCollisionError();
    }
  }

  private mapAndVerifyPersistedPosting(row: PrismaPortfolioLedgerPosting): PortfolioLedgerPosting {
    try {
      const rebuiltSettlement = PortfolioLedgerTradeSettlementDomain.build({
        sourceExecutionHash: row.sourceExecutionHash,
        instrumentBusinessKey: row.instrumentBusinessKey,
        quantityDelta: row.quantityDelta,
        grossCashDeltaVnd: row.grossCashDeltaVnd,
        feeVnd: row.feeVnd,
        taxVnd: row.taxVnd
      });

      if (
        rebuiltSettlement.contractVersion !== row.settlementContractVersion ||
        rebuiltSettlement.postingKind !== row.postingKind ||
        rebuiltSettlement.side !== row.side ||
        BigInt(rebuiltSettlement.quantityDelta) !== row.quantityDelta ||
        BigInt(rebuiltSettlement.grossCashDeltaVnd) !== row.grossCashDeltaVnd ||
        BigInt(rebuiltSettlement.feeVnd) !== row.feeVnd ||
        BigInt(rebuiltSettlement.taxVnd) !== row.taxVnd ||
        BigInt(rebuiltSettlement.netCashDeltaVnd) !== row.netCashDeltaVnd ||
        rebuiltSettlement.payloadHash !== row.settlementPayloadHash
      ) {
        throw new PortfolioPostingIntegrityError('Persisted settlement data does not match rebuilt structure.');
      }

      if (row.entrySequence < 1n || row.entrySequence > 9007199254740991n) {
        throw new PortfolioPostingIntegrityError('Persisted entry sequence is invalid.');
      }
      const safeEntrySequence = Number(row.entrySequence);

      const dbDateToCanonical = row.effectiveDate.toISOString().slice(0, 10);

      const posting = PortfolioLedgerPostingDomain.compose({
        ledgerGenesisHash: row.ledgerGenesisHash,
        entrySequence: safeEntrySequence,
        effectiveDate: dbDateToCanonical,
        previousHash: row.previousHash,
        cashBalanceBeforeVnd: row.cashBalanceBeforeVnd,
        positionQuantityBefore: row.positionQuantityBefore,
        settlement: rebuiltSettlement
      });

      if (
        posting.transition.contractVersion !== row.transitionContractVersion ||
        posting.transition.transitionKind !== row.transitionKind ||
        BigInt(posting.transition.cashBalanceBeforeVnd) !== row.cashBalanceBeforeVnd ||
        BigInt(posting.transition.cashDeltaVnd) !== row.cashDeltaVnd ||
        BigInt(posting.transition.cashBalanceAfterVnd) !== row.cashBalanceAfterVnd ||
        BigInt(posting.transition.positionQuantityBefore) !== row.positionQuantityBefore ||
        BigInt(posting.transition.positionQuantityAfter) !== row.positionQuantityAfter ||
        posting.transition.transitionHash !== row.transitionHash
      ) {
        throw new PortfolioPostingIntegrityError('Persisted transition data does not match rebuilt structure.');
      }

      if (
        posting.entry.contractVersion !== row.entryContractVersion ||
        posting.entry.entryType !== row.entryType ||
        BigInt(posting.entry.entrySequence) !== row.entrySequence ||
        posting.entry.effectiveDate !== dbDateToCanonical ||
        posting.entry.previousHash !== row.previousHash ||
        posting.entry.entryHash !== row.entryHash ||
        posting.entry.ledgerGenesisHash !== row.ledgerGenesisHash ||
        posting.entry.payloadHash !== row.transitionHash
      ) {
        throw new PortfolioPostingIntegrityError('Persisted entry data does not match rebuilt structure.');
      }

      return posting;
    } catch (e) {
      if (e instanceof PortfolioPostingIntegrityError) {
        throw e;
      }
      throw new PortfolioPostingIntegrityError('Error verifying persisted posting: ' + (e as Error).message);
    }
  }

  private handlePrismaError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2034') {
        throw new PortfolioPostingConcurrencyError();
      }
      throw new PortfolioPostingIntegrityError();
    }
    if (
      error instanceof Prisma.PrismaClientUnknownRequestError ||
      error instanceof Prisma.PrismaClientRustPanicError ||
      error instanceof Prisma.PrismaClientInitializationError ||
      error instanceof Prisma.PrismaClientValidationError
    ) {
      throw new PortfolioPostingIntegrityError();
    }
    throw error;
  }
}
