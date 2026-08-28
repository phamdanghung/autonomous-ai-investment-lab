import { PortfolioLedgerTradeSettlement } from './PortfolioLedgerTradeSettlementContracts';

export const PORTFOLIO_ACCOUNTING_TRANSITION_CONTRACT_VERSION = '1.0' as const;

export type PortfolioAccountingTransitionKind = 'TRADE_SETTLEMENT_APPLIED';

export interface PortfolioAccountingTransitionInput {
  ledgerGenesisHash: string;
  cashBalanceBeforeVnd: bigint;
  positionQuantityBefore: bigint;
  settlement: PortfolioLedgerTradeSettlement;
}

export interface CanonicalPortfolioAccountingTransitionPayload {
  contractVersion: '1.0';
  transitionKind: 'TRADE_SETTLEMENT_APPLIED';
  ledgerGenesisHash: string;
  settlementPayloadHash: string;
  instrumentBusinessKey: string;
  side: 'BUY' | 'SELL';
  cashBalanceBeforeVnd: string;
  cashDeltaVnd: string;
  cashBalanceAfterVnd: string;
  positionQuantityBefore: string;
  quantityDelta: string;
  positionQuantityAfter: string;
}

export interface PortfolioAccountingTransition extends CanonicalPortfolioAccountingTransitionPayload {
  transitionHash: string;
}
