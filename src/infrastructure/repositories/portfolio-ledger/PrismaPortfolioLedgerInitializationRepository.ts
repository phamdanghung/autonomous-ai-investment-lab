import { PrismaClient, Prisma } from '@prisma/client';
import {
  InitializePortfolioLedgerCommand,
  PortfolioLedgerInitializationResult,
  PortfolioLedgerInitializationRepository,
  PortfolioLedgerInitializationRunNotFoundError,
  PortfolioLedgerInitializationRunNotReadyError,
  PortfolioLedgerInitializationIntegrityError,
  PortfolioLedgerInitializationConcurrencyError
} from '../../../application/ports/portfolio-ledger/PortfolioLedgerInitializationRepositoryPorts';
import { PortfolioLedgerGenesisDomain } from '../../../domain/portfolio-ledger/PortfolioLedgerGenesis';
import { PortfolioLedgerGenesis } from '../../../domain/contracts/PortfolioLedgerContracts';

type LockedSimulationRunRow = {
  id: string;
  runBusinessKey: string | null;
  configVersionId: string;
  status: string;
  dataOriginHash: string | null;
  canonicalStartDate: Date | null;
  version: number;
};

type LockedRunCoreConfigVersionRow = {
  id: string;
  initialCapital: bigint;
};

type PersistedPortfolioLedgerRow = {
  id: string;
  runId: string;
  runBusinessKey: string;
  contractVersion: string;
  ledgerKind: string;
  canonicalStartDate: Date;
  currency: string;
  openingCashVnd: bigint;
  openingPositionCount: number;
  genesisHash: string;
};

export class PrismaPortfolioLedgerInitializationRepository implements PortfolioLedgerInitializationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  public async initialize(
    command: InitializePortfolioLedgerCommand
  ): Promise<PortfolioLedgerInitializationResult> {
    try {
      return await this.executeInitializeTransaction(command.runId);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return await this.executeRecoveryTransaction(command.runId);
      }
      this.handlePrismaError(error);
    }
  }

  private async executeInitializeTransaction(runId: string): Promise<PortfolioLedgerInitializationResult> {
    return this.prisma.$transaction(
      async (tx: Prisma.TransactionClient): Promise<PortfolioLedgerInitializationResult> => {
        const lockedRun = await this.lockSimulationRun(tx, runId);
        const lockedConfig = await this.lockConfigVersion(tx, lockedRun.configVersionId);
        
        const existingLedger = await tx.portfolioLedger.findUnique({
          where: { runId }
        });

        if (existingLedger) {
          if (lockedRun.status === 'INITIALIZED') {
            throw new PortfolioLedgerInitializationIntegrityError('Ledger exists for INITIALIZED run.');
          }
          const genesis = this.buildAndVerifyPersistedRoot(lockedRun, lockedConfig, existingLedger);
          return {
            disposition: 'REPLAYED',
            ledgerId: existingLedger.id,
            runId: lockedRun.id,
            genesis
          };
        }

        if (lockedRun.status !== 'CONFIGURED') {
          throw new PortfolioLedgerInitializationRunNotReadyError();
        }

        this.validateParentStructuralPreconditions(lockedRun, lockedConfig);

        const canonicalStartDateStr = lockedRun.canonicalStartDate!.toISOString().slice(0, 10);

        let genesis: PortfolioLedgerGenesis;
        try {
          genesis = PortfolioLedgerGenesisDomain.build({
            runBusinessKey: lockedRun.runBusinessKey!,
            canonicalStartDate: canonicalStartDateStr,
            initialCapitalVnd: lockedConfig.initialCapital
          });
        } catch (error) {
          throw new PortfolioLedgerInitializationIntegrityError('Failed to build genesis from parent inputs: ' + (error as Error).message);
        }

        const createdLedger = await tx.portfolioLedger.create({
          data: {
            runId: lockedRun.id,
            runBusinessKey: genesis.runBusinessKey,
            contractVersion: genesis.contractVersion,
            ledgerKind: genesis.ledgerKind,
            canonicalStartDate: new Date(`${genesis.canonicalStartDate}T00:00:00.000Z`),
            currency: genesis.currency,
            openingCashVnd: BigInt(genesis.openingCashVnd),
            openingPositionCount: genesis.openingPositionCount,
            genesisHash: genesis.genesisHash,
            currentCashBalanceVnd: BigInt(genesis.openingCashVnd),
            lastEntrySequence: 0n,
            lastEntryHash: genesis.genesisHash,
            version: 1
          }
        });

        return {
          disposition: 'CREATED',
          ledgerId: createdLedger.id,
          runId: lockedRun.id,
          genesis
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 15000,
        timeout: 20000
      }
    );
  }

  private async executeRecoveryTransaction(runId: string): Promise<PortfolioLedgerInitializationResult> {
    return this.prisma.$transaction(
      async (tx: Prisma.TransactionClient): Promise<PortfolioLedgerInitializationResult> => {
        const lockedRun = await this.lockSimulationRun(tx, runId);
        const lockedConfig = await this.lockConfigVersion(tx, lockedRun.configVersionId);

        const existingLedger = await tx.portfolioLedger.findUnique({
          where: { runId }
        });

        if (!existingLedger) {
          throw new PortfolioLedgerInitializationIntegrityError('No ledger found after P2002 recovery.');
        }

        if (lockedRun.status === 'INITIALIZED') {
          throw new PortfolioLedgerInitializationIntegrityError('Ledger exists for INITIALIZED run in recovery.');
        }

        const genesis = this.buildAndVerifyPersistedRoot(lockedRun, lockedConfig, existingLedger);
        return {
          disposition: 'REPLAYED',
          ledgerId: existingLedger.id,
          runId: lockedRun.id,
          genesis
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 15000,
        timeout: 20000
      }
    );
  }

  private async lockSimulationRun(tx: Prisma.TransactionClient, runId: string): Promise<LockedSimulationRunRow> {
    const rows = await tx.$queryRaw<LockedSimulationRunRow[]>`
      SELECT
        "id",
        "runBusinessKey",
        "configVersionId",
        "status",
        "dataOriginHash",
        "canonicalStartDate",
        "version"
      FROM "SimulationRun"
      WHERE "id" = ${runId}
      FOR UPDATE
    `;

    if (rows.length === 0) {
      throw new PortfolioLedgerInitializationRunNotFoundError();
    }
    if (rows.length > 1) {
      throw new PortfolioLedgerInitializationIntegrityError('Multiple runs found for id.');
    }

    return rows[0];
  }

  private async lockConfigVersion(tx: Prisma.TransactionClient, configVersionId: string): Promise<LockedRunCoreConfigVersionRow> {
    const rows = await tx.$queryRaw<LockedRunCoreConfigVersionRow[]>`
      SELECT
        "id",
        "initialCapital"
      FROM "RunCoreConfigVersion"
      WHERE "id" = ${configVersionId}
      FOR SHARE
    `;

    if (rows.length === 0) {
      throw new PortfolioLedgerInitializationIntegrityError('Config version not found.');
    }
    if (rows.length > 1) {
      throw new PortfolioLedgerInitializationIntegrityError('Multiple configs found.');
    }

    return rows[0];
  }

  private validateParentStructuralPreconditions(lockedRun: LockedSimulationRunRow, lockedConfig: LockedRunCoreConfigVersionRow): void {
    if (
      typeof lockedRun.runBusinessKey !== 'string' ||
      !/^[a-f0-9]{64}$/.test(lockedRun.runBusinessKey)
    ) {
      throw new PortfolioLedgerInitializationIntegrityError('Invalid or missing runBusinessKey.');
    }

    if (!lockedRun.canonicalStartDate || isNaN(lockedRun.canonicalStartDate.getTime())) {
      throw new PortfolioLedgerInitializationIntegrityError('Invalid or missing canonicalStartDate.');
    }

    const canonicalStartDateStr = lockedRun.canonicalStartDate.toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(canonicalStartDateStr)) {
      throw new PortfolioLedgerInitializationIntegrityError('Invalid canonicalStartDate format.');
    }

    if (typeof lockedRun.dataOriginHash !== 'string' || !lockedRun.dataOriginHash) {
      throw new PortfolioLedgerInitializationIntegrityError('Invalid or missing dataOriginHash.');
    }

    if (typeof lockedConfig.initialCapital !== 'bigint' || lockedConfig.initialCapital < 0n) {
      throw new PortfolioLedgerInitializationIntegrityError('Invalid initialCapital.');
    }
  }

  private buildAndVerifyPersistedRoot(
    lockedRun: LockedSimulationRunRow,
    lockedConfig: LockedRunCoreConfigVersionRow,
    persistedLedger: PersistedPortfolioLedgerRow
  ): PortfolioLedgerGenesis {
    this.validateParentStructuralPreconditions(lockedRun, lockedConfig);

    const canonicalStartDateStr = lockedRun.canonicalStartDate!.toISOString().slice(0, 10);

    let genesis: PortfolioLedgerGenesis;
    try {
      genesis = PortfolioLedgerGenesisDomain.build({
        runBusinessKey: lockedRun.runBusinessKey!,
        canonicalStartDate: canonicalStartDateStr,
        initialCapitalVnd: lockedConfig.initialCapital
      });
    } catch (error) {
      throw new PortfolioLedgerInitializationIntegrityError('Failed to build genesis from parent inputs: ' + (error as Error).message);
    }

    if (persistedLedger.runId !== lockedRun.id) {
      throw new PortfolioLedgerInitializationIntegrityError('runId mismatch');
    }
    if (persistedLedger.runBusinessKey !== genesis.runBusinessKey) {
      throw new PortfolioLedgerInitializationIntegrityError('runBusinessKey mismatch');
    }
    if (persistedLedger.contractVersion !== genesis.contractVersion) {
      throw new PortfolioLedgerInitializationIntegrityError('contractVersion mismatch');
    }
    if (persistedLedger.ledgerKind !== genesis.ledgerKind) {
      throw new PortfolioLedgerInitializationIntegrityError('ledgerKind mismatch');
    }
    
    if (!(persistedLedger.canonicalStartDate instanceof Date) || isNaN(persistedLedger.canonicalStartDate.getTime())) {
      throw new PortfolioLedgerInitializationIntegrityError('canonicalStartDate in db is invalid');
    }
    const persistedDateStr = persistedLedger.canonicalStartDate.toISOString().slice(0, 10);
    if (persistedDateStr !== genesis.canonicalStartDate) {
      throw new PortfolioLedgerInitializationIntegrityError('canonicalStartDate mismatch');
    }
    
    if (persistedLedger.currency !== genesis.currency) {
      throw new PortfolioLedgerInitializationIntegrityError('currency mismatch');
    }
    if (persistedLedger.openingCashVnd !== BigInt(genesis.openingCashVnd)) {
      throw new PortfolioLedgerInitializationIntegrityError('openingCashVnd mismatch');
    }
    if (persistedLedger.openingPositionCount !== genesis.openingPositionCount) {
      throw new PortfolioLedgerInitializationIntegrityError('openingPositionCount mismatch');
    }
    if (persistedLedger.genesisHash !== genesis.genesisHash) {
      throw new PortfolioLedgerInitializationIntegrityError('genesisHash mismatch');
    }

    return genesis;
  }

  private handlePrismaError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2034') {
        throw new PortfolioLedgerInitializationConcurrencyError();
      }
      throw new PortfolioLedgerInitializationIntegrityError();
    }
    if (
      error instanceof Prisma.PrismaClientUnknownRequestError ||
      error instanceof Prisma.PrismaClientRustPanicError ||
      error instanceof Prisma.PrismaClientInitializationError ||
      error instanceof Prisma.PrismaClientValidationError
    ) {
      throw new PortfolioLedgerInitializationIntegrityError();
    }
    throw error as Error;
  }
}
