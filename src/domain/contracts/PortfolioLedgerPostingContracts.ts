import { PortfolioLedgerTradeSettlement } from './PortfolioLedgerTradeSettlementContracts';
import { PortfolioAccountingTransition } from './PortfolioAccountingTransitionContracts';
import { PortfolioLedgerEntry } from './PortfolioLedgerEntryContracts';

export interface PortfolioLedgerPostingInput {
  ledgerGenesisHash: string;
  entrySequence: number;
  effectiveDate: string;
  previousHash: string;
  cashBalanceBeforeVnd: bigint;
  positionQuantityBefore: bigint;
  settlement: PortfolioLedgerTradeSettlement;
}

export interface PortfolioLedgerPosting {
  transition: PortfolioAccountingTransition;
  entry: PortfolioLedgerEntry;
}
