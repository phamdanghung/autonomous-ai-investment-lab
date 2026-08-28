import { DomainError } from '../errors/DomainErrors';
import { CanonicalDate } from '../models/CanonicalDate';
import { CanonicalSerializer } from '../hashing/CanonicalSerializer';
import { Sha256Service } from '../services/Sha256Service';
import {
  PORTFOLIO_LEDGER_TRADE_SETTLEMENT_CONTRACT_VERSION,
  PortfolioLedgerTradeSettlement,
  PortfolioLedgerTradeSettlementInput,
  CanonicalPortfolioLedgerTradeSettlementPayload,
  PortfolioLedgerTradeSide
} from '../contracts/PortfolioLedgerTradeSettlementContracts';

export class PortfolioLedgerTradeSettlementInvalidError extends DomainError {
  constructor(message: string = 'Portfolio ledger trade settlement is invalid.') {
    super(message, 'PORTFOLIO_LEDGER_TRADE_SETTLEMENT_INVALID');
    this.name = 'PortfolioLedgerTradeSettlementInvalidError';
    Object.setPrototypeOf(this, PortfolioLedgerTradeSettlementInvalidError.prototype);
  }
}

export class PortfolioLedgerTradeSettlementDomain {
  static build(input: PortfolioLedgerTradeSettlementInput): PortfolioLedgerTradeSettlement {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new PortfolioLedgerTradeSettlementInvalidError();
    }

    const { sourceExecutionHash, instrumentBusinessKey, quantityDelta, grossCashDeltaVnd, feeVnd, taxVnd } = input;

    if (typeof sourceExecutionHash !== 'string' || !/^[a-f0-9]{64}$/.test(sourceExecutionHash)) {
      throw new PortfolioLedgerTradeSettlementInvalidError('Invalid sourceExecutionHash');
    }

    if (typeof instrumentBusinessKey !== 'string') {
      throw new PortfolioLedgerTradeSettlementInvalidError('Invalid instrumentBusinessKey');
    }

    const instrumentParts = instrumentBusinessKey.split('|');
    if (instrumentParts.length !== 5) {
      throw new PortfolioLedgerTradeSettlementInvalidError('Invalid instrumentBusinessKey format');
    }

    const [country, exchange, symbol, type, dateStr] = instrumentParts;

    if (country !== 'VN') {
      throw new PortfolioLedgerTradeSettlementInvalidError('Invalid country code');
    }

    if (exchange !== 'HOSE' && exchange !== 'HNX' && exchange !== 'UPCOM') {
      throw new PortfolioLedgerTradeSettlementInvalidError('Invalid exchange');
    }

    if (!/^[A-Z0-9]{1,20}$/.test(symbol)) {
      throw new PortfolioLedgerTradeSettlementInvalidError('Invalid symbol');
    }

    if (type !== 'EQUITY') {
      throw new PortfolioLedgerTradeSettlementInvalidError('Invalid security type');
    }

    let cDate: CanonicalDate;
    try {
      cDate = new CanonicalDate(dateStr);
    } catch (e) {
      throw new PortfolioLedgerTradeSettlementInvalidError('Invalid date');
    }
    if (cDate.value !== dateStr) {
      throw new PortfolioLedgerTradeSettlementInvalidError('Invalid date formatting');
    }

    if (typeof quantityDelta !== 'bigint' || quantityDelta === 0n) {
      throw new PortfolioLedgerTradeSettlementInvalidError('Invalid quantityDelta');
    }

    if (typeof grossCashDeltaVnd !== 'bigint' || grossCashDeltaVnd === 0n) {
      throw new PortfolioLedgerTradeSettlementInvalidError('Invalid grossCashDeltaVnd');
    }

    if (typeof feeVnd !== 'bigint' || feeVnd < 0n) {
      throw new PortfolioLedgerTradeSettlementInvalidError('Invalid feeVnd');
    }

    if (typeof taxVnd !== 'bigint' || taxVnd < 0n) {
      throw new PortfolioLedgerTradeSettlementInvalidError('Invalid taxVnd');
    }

    const side: PortfolioLedgerTradeSide = quantityDelta > 0n ? 'BUY' : 'SELL';

    if (side === 'BUY' && grossCashDeltaVnd >= 0n) {
      throw new PortfolioLedgerTradeSettlementInvalidError('BUY grossCashDeltaVnd must be negative');
    }

    if (side === 'SELL' && grossCashDeltaVnd <= 0n) {
      throw new PortfolioLedgerTradeSettlementInvalidError('SELL grossCashDeltaVnd must be positive');
    }

    const netCashDeltaVnd = grossCashDeltaVnd - feeVnd - taxVnd;

    if (side === 'SELL' && netCashDeltaVnd <= 0n) {
      throw new PortfolioLedgerTradeSettlementInvalidError('SELL netCashDeltaVnd must be positive');
    }

    const payload: CanonicalPortfolioLedgerTradeSettlementPayload = {
      contractVersion: PORTFOLIO_LEDGER_TRADE_SETTLEMENT_CONTRACT_VERSION,
      postingKind: 'TRADE_SETTLEMENT',
      sourceExecutionHash,
      instrumentBusinessKey,
      side,
      quantityDelta: quantityDelta.toString(10),
      grossCashDeltaVnd: grossCashDeltaVnd.toString(10),
      feeVnd: feeVnd.toString(10),
      taxVnd: taxVnd.toString(10),
      netCashDeltaVnd: netCashDeltaVnd.toString(10)
    };

    const serialized = CanonicalSerializer.serialize(payload);
    const payloadHash = Sha256Service.hashString(serialized);

    const output: PortfolioLedgerTradeSettlement = {
      ...payload,
      payloadHash
    };

    return Object.freeze(output);
  }
}
