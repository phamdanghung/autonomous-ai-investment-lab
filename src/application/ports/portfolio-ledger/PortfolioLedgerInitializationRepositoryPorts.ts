import { PortfolioLedgerGenesis } from '../../../domain/contracts/PortfolioLedgerContracts';

export interface InitializePortfolioLedgerCommand {
  runId: string;
}

export type PortfolioLedgerInitializationDisposition = 'CREATED' | 'REPLAYED';

export interface PortfolioLedgerInitializationResult {
  disposition: PortfolioLedgerInitializationDisposition;
  ledgerId: string;
  runId: string;
  genesis: PortfolioLedgerGenesis;
}

export interface PortfolioLedgerInitializationRepository {
  initialize(
    command: InitializePortfolioLedgerCommand
  ): Promise<PortfolioLedgerInitializationResult>;
}

export class PortfolioLedgerInitializationRunNotFoundError extends Error {
  public readonly code = 'PORTFOLIO_LEDGER_INITIALIZATION_RUN_NOT_FOUND';
  constructor(message = 'Portfolio ledger initialization run not found.') {
    super(message);
    this.name = 'PortfolioLedgerInitializationRunNotFoundError';
    Object.setPrototypeOf(this, PortfolioLedgerInitializationRunNotFoundError.prototype);
  }
}

export class PortfolioLedgerInitializationRunNotReadyError extends Error {
  public readonly code = 'PORTFOLIO_LEDGER_INITIALIZATION_RUN_NOT_READY';
  constructor(message = 'Portfolio ledger initialization run not ready.') {
    super(message);
    this.name = 'PortfolioLedgerInitializationRunNotReadyError';
    Object.setPrototypeOf(this, PortfolioLedgerInitializationRunNotReadyError.prototype);
  }
}

export class PortfolioLedgerInitializationIntegrityError extends Error {
  public readonly code = 'PORTFOLIO_LEDGER_INITIALIZATION_INTEGRITY';
  constructor(message = 'Portfolio ledger initialization integrity error.') {
    super(message);
    this.name = 'PortfolioLedgerInitializationIntegrityError';
    Object.setPrototypeOf(this, PortfolioLedgerInitializationIntegrityError.prototype);
  }
}

export class PortfolioLedgerInitializationConcurrencyError extends Error {
  public readonly code = 'PORTFOLIO_LEDGER_INITIALIZATION_CONCURRENCY';
  constructor(message = 'Portfolio ledger initialization concurrency error.') {
    super(message);
    this.name = 'PortfolioLedgerInitializationConcurrencyError';
    Object.setPrototypeOf(this, PortfolioLedgerInitializationConcurrencyError.prototype);
  }
}
