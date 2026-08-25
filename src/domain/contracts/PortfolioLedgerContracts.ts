export const PORTFOLIO_LEDGER_GENESIS_CONTRACT_VERSION = '1.0' as const;

export type PortfolioLedgerKind = 'SIMULATION_PORTFOLIO';

export type PortfolioLedgerCurrency = 'VND';

export interface PortfolioLedgerGenesisInput {
  runBusinessKey: string;
  canonicalStartDate: string;
  initialCapitalVnd: bigint;
}

export interface CanonicalPortfolioLedgerGenesisPayload {
  contractVersion: '1.0';
  ledgerKind: 'SIMULATION_PORTFOLIO';
  runBusinessKey: string;
  canonicalStartDate: string;
  currency: 'VND';
  openingCashVnd: string;
  openingPositionCount: 0;
}

export interface PortfolioLedgerGenesis
  extends CanonicalPortfolioLedgerGenesisPayload {
  genesisHash: string;
}
