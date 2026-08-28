export const PORTFOLIO_LEDGER_TRADE_SETTLEMENT_CONTRACT_VERSION = '1.0' as const;

export type PortfolioLedgerPostingKind = 'TRADE_SETTLEMENT';

export type PortfolioLedgerTradeSide = 'BUY' | 'SELL';

export interface PortfolioLedgerTradeSettlementInput {
  sourceExecutionHash: string;
  instrumentBusinessKey: string;
  quantityDelta: bigint;
  grossCashDeltaVnd: bigint;
  feeVnd: bigint;
  taxVnd: bigint;
}

export interface CanonicalPortfolioLedgerTradeSettlementPayload {
  contractVersion: '1.0';
  postingKind: 'TRADE_SETTLEMENT';
  sourceExecutionHash: string;
  instrumentBusinessKey: string;
  side: 'BUY' | 'SELL';
  quantityDelta: string;
  grossCashDeltaVnd: string;
  feeVnd: string;
  taxVnd: string;
  netCashDeltaVnd: string;
}

export interface PortfolioLedgerTradeSettlement extends CanonicalPortfolioLedgerTradeSettlementPayload {
  payloadHash: string;
}
