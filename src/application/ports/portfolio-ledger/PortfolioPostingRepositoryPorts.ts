import { PortfolioLedgerTradeSettlementInput } from '../../../domain/contracts/PortfolioLedgerTradeSettlementContracts';
import { PortfolioLedgerPosting } from '../../../domain/contracts/PortfolioLedgerPostingContracts';

export interface AppendPortfolioPostingCommand {
  ledgerId: string;
  effectiveDate: string;
  settlement: PortfolioLedgerTradeSettlementInput;
}

export type PortfolioPostingPersistenceDisposition = 'CREATED' | 'REPLAYED';

export interface PersistedPortfolioPostingResult {
  disposition: PortfolioPostingPersistenceDisposition;
  posting: PortfolioLedgerPosting;
}

export interface PortfolioPostingRepository {
  append(
    command: AppendPortfolioPostingCommand
  ): Promise<PersistedPortfolioPostingResult>;
}

export class PortfolioLedgerNotFoundError extends Error {
  public readonly code = 'PORTFOLIO_LEDGER_NOT_FOUND';
  constructor(message: string = 'Portfolio ledger not found.') {
    super(message);
    this.name = 'PortfolioLedgerNotFoundError';
  }
}

export class PortfolioInstrumentNotFoundError extends Error {
  public readonly code = 'PORTFOLIO_INSTRUMENT_NOT_FOUND';
  constructor(message: string = 'Portfolio instrument not found.') {
    super(message);
    this.name = 'PortfolioInstrumentNotFoundError';
  }
}

export class PortfolioPostingIdempotencyCollisionError extends Error {
  public readonly code = 'PORTFOLIO_POSTING_IDEMPOTENCY_COLLISION';
  constructor(message: string = 'Portfolio posting idempotency collision.') {
    super(message);
    this.name = 'PortfolioPostingIdempotencyCollisionError';
  }
}

export class PortfolioPostingChainConflictError extends Error {
  public readonly code = 'PORTFOLIO_POSTING_CHAIN_CONFLICT';
  constructor(message: string = 'Portfolio posting chain conflict.') {
    super(message);
    this.name = 'PortfolioPostingChainConflictError';
  }
}

export class PortfolioPostingIntegrityError extends Error {
  public readonly code = 'PORTFOLIO_POSTING_INTEGRITY';
  constructor(message: string = 'Portfolio posting database integrity error.') {
    super(message);
    this.name = 'PortfolioPostingIntegrityError';
  }
}

export class PortfolioPostingConcurrencyError extends Error {
  public readonly code = 'PORTFOLIO_POSTING_CONCURRENCY';
  constructor(message: string = 'Portfolio posting concurrency conflict.') {
    super(message);
    this.name = 'PortfolioPostingConcurrencyError';
  }
}
