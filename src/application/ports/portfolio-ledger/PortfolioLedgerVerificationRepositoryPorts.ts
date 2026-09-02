import { PortfolioLedgerGenesis } from '../../../domain/contracts/PortfolioLedgerContracts';

export interface VerifyPortfolioLedgerCommand {
  runId: string;
}

export interface VerifiedPortfolioPosition {
  instrumentBusinessKey: string;
  quantity: bigint;
  version: number;
}

export interface VerifiedPortfolioLedgerSnapshot {
  runId: string;
  ledgerId: string;
  genesis: PortfolioLedgerGenesis;
  postingCount: number;
  currentCashBalanceVnd: bigint;
  lastEntrySequence: number;
  lastEntryHash: string;
  ledgerVersion: number;
  positions: readonly VerifiedPortfolioPosition[];
}

export interface PortfolioLedgerVerificationRepository {
  verify(command: VerifyPortfolioLedgerCommand): Promise<VerifiedPortfolioLedgerSnapshot>;
}

export class PortfolioLedgerVerificationRunNotFoundError extends Error {
  public readonly code = 'PORTFOLIO_LEDGER_VERIFICATION_RUN_NOT_FOUND';
  constructor(message: string = 'Simulation run not found.') {
    super(message);
    this.name = 'PortfolioLedgerVerificationRunNotFoundError';
  }
}

export class PortfolioLedgerVerificationLedgerNotFoundError extends Error {
  public readonly code = 'PORTFOLIO_LEDGER_VERIFICATION_LEDGER_NOT_FOUND';
  constructor(message: string = 'Portfolio ledger not found.') {
    super(message);
    this.name = 'PortfolioLedgerVerificationLedgerNotFoundError';
  }
}

export class PortfolioLedgerVerificationIntegrityError extends Error {
  public readonly code = 'PORTFOLIO_LEDGER_VERIFICATION_INTEGRITY';
  constructor(message: string = 'Portfolio ledger verification integrity error.') {
    super(message);
    this.name = 'PortfolioLedgerVerificationIntegrityError';
  }
}

export class PortfolioLedgerVerificationConcurrencyError extends Error {
  public readonly code = 'PORTFOLIO_LEDGER_VERIFICATION_CONCURRENCY';
  constructor(message: string = 'Portfolio ledger verification concurrency error.') {
    super(message);
    this.name = 'PortfolioLedgerVerificationConcurrencyError';
  }
}
