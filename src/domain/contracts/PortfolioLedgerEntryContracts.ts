export const PORTFOLIO_LEDGER_ENTRY_CONTRACT_VERSION = '1.0' as const;

export type PortfolioLedgerEntryType = 'POSTING';

export interface PortfolioLedgerEntryInput {
  ledgerGenesisHash: string;
  entrySequence: number;
  effectiveDate: string;
  payloadHash: string;
  previousHash: string;
}

export interface CanonicalPortfolioLedgerEntryPayload {
  contractVersion: '1.0';
  entryType: 'POSTING';
  ledgerGenesisHash: string;
  entrySequence: number;
  effectiveDate: string;
  payloadHash: string;
  previousHash: string;
}

export interface PortfolioLedgerEntry extends CanonicalPortfolioLedgerEntryPayload {
  entryHash: string;
}
