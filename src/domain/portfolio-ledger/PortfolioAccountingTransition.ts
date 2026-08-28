import { DomainError } from '../errors/DomainErrors';
import { CanonicalSerializer } from '../hashing/CanonicalSerializer';
import { Sha256Service } from '../services/Sha256Service';
import { PortfolioLedgerTradeSettlementDomain } from './PortfolioLedgerTradeSettlement';
import {
  PORTFOLIO_ACCOUNTING_TRANSITION_CONTRACT_VERSION,
  PortfolioAccountingTransition,
  PortfolioAccountingTransitionInput,
  CanonicalPortfolioAccountingTransitionPayload
} from '../contracts/PortfolioAccountingTransitionContracts';

export class PortfolioAccountingTransitionInvalidError extends DomainError {
  constructor(message: string = 'Portfolio accounting transition is invalid.') {
    super(message, 'PORTFOLIO_ACCOUNTING_TRANSITION_INVALID');
    this.name = 'PortfolioAccountingTransitionInvalidError';
    Object.setPrototypeOf(this, PortfolioAccountingTransitionInvalidError.prototype);
  }
}

export class PortfolioAccountingTransitionDomain {
  static apply(input: PortfolioAccountingTransitionInput): PortfolioAccountingTransition {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new PortfolioAccountingTransitionInvalidError();
    }

    const { ledgerGenesisHash, cashBalanceBeforeVnd, positionQuantityBefore, settlement } = input;

    if (typeof ledgerGenesisHash !== 'string' || !/^[a-f0-9]{64}$/.test(ledgerGenesisHash)) {
      throw new PortfolioAccountingTransitionInvalidError('Invalid ledgerGenesisHash');
    }

    if (typeof cashBalanceBeforeVnd !== 'bigint' || cashBalanceBeforeVnd < 0n) {
      throw new PortfolioAccountingTransitionInvalidError('Invalid cashBalanceBeforeVnd');
    }

    if (typeof positionQuantityBefore !== 'bigint' || positionQuantityBefore < 0n) {
      throw new PortfolioAccountingTransitionInvalidError('Invalid positionQuantityBefore');
    }

    if (!settlement || typeof settlement !== 'object' || Array.isArray(settlement)) {
      throw new PortfolioAccountingTransitionInvalidError('Invalid settlement object');
    }

    const { sourceExecutionHash, instrumentBusinessKey, quantityDelta: qStr, grossCashDeltaVnd: gStr, feeVnd: fStr, taxVnd: tStr } = settlement;

    if (typeof qStr !== 'string' || !/^-?[1-9][0-9]*$/.test(qStr)) {
      throw new PortfolioAccountingTransitionInvalidError('Invalid settlement quantityDelta format');
    }
    if (typeof gStr !== 'string' || !/^-?[1-9][0-9]*$/.test(gStr)) {
      throw new PortfolioAccountingTransitionInvalidError('Invalid settlement grossCashDeltaVnd format');
    }
    if (typeof fStr !== 'string' || !/^(0|[1-9][0-9]*)$/.test(fStr)) {
      throw new PortfolioAccountingTransitionInvalidError('Invalid settlement feeVnd format');
    }
    if (typeof tStr !== 'string' || !/^(0|[1-9][0-9]*)$/.test(tStr)) {
      throw new PortfolioAccountingTransitionInvalidError('Invalid settlement taxVnd format');
    }

    let rebuiltSettlement;
    try {
      rebuiltSettlement = PortfolioLedgerTradeSettlementDomain.build({
        sourceExecutionHash: String(sourceExecutionHash),
        instrumentBusinessKey: String(instrumentBusinessKey),
        quantityDelta: BigInt(qStr),
        grossCashDeltaVnd: BigInt(gStr),
        feeVnd: BigInt(fStr),
        taxVnd: BigInt(tStr)
      });
    } catch (e) {
      throw new PortfolioAccountingTransitionInvalidError('Forged settlement failed rebuild');
    }

    if (
      settlement.contractVersion !== rebuiltSettlement.contractVersion ||
      settlement.postingKind !== rebuiltSettlement.postingKind ||
      settlement.sourceExecutionHash !== rebuiltSettlement.sourceExecutionHash ||
      settlement.instrumentBusinessKey !== rebuiltSettlement.instrumentBusinessKey ||
      settlement.side !== rebuiltSettlement.side ||
      settlement.quantityDelta !== rebuiltSettlement.quantityDelta ||
      settlement.grossCashDeltaVnd !== rebuiltSettlement.grossCashDeltaVnd ||
      settlement.feeVnd !== rebuiltSettlement.feeVnd ||
      settlement.taxVnd !== rebuiltSettlement.taxVnd ||
      settlement.netCashDeltaVnd !== rebuiltSettlement.netCashDeltaVnd ||
      settlement.payloadHash !== rebuiltSettlement.payloadHash
    ) {
      throw new PortfolioAccountingTransitionInvalidError('Forged settlement fields mismatch');
    }

    const cashDeltaVnd = BigInt(rebuiltSettlement.netCashDeltaVnd);
    const quantityDelta = BigInt(rebuiltSettlement.quantityDelta);

    const cashBalanceAfterVnd = cashBalanceBeforeVnd + cashDeltaVnd;
    const positionQuantityAfter = positionQuantityBefore + quantityDelta;

    if (cashBalanceAfterVnd < 0n) {
      throw new PortfolioAccountingTransitionInvalidError('Insufficient cash (NO MARGIN)');
    }

    if (positionQuantityAfter < 0n) {
      throw new PortfolioAccountingTransitionInvalidError('Oversold position (NO SHORT SELLING)');
    }

    if (rebuiltSettlement.side === 'BUY') {
      if (quantityDelta <= 0n || positionQuantityAfter <= positionQuantityBefore) {
        throw new PortfolioAccountingTransitionInvalidError('BUY rule violation: quantity');
      }
      if (cashDeltaVnd >= 0n || cashBalanceAfterVnd >= cashBalanceBeforeVnd) {
        throw new PortfolioAccountingTransitionInvalidError('BUY rule violation: cash');
      }
    } else {
      if (quantityDelta >= 0n || positionQuantityAfter >= positionQuantityBefore) {
        throw new PortfolioAccountingTransitionInvalidError('SELL rule violation: quantity');
      }
      if (cashDeltaVnd <= 0n || cashBalanceAfterVnd <= cashBalanceBeforeVnd) {
        throw new PortfolioAccountingTransitionInvalidError('SELL rule violation: cash');
      }
    }

    const payload: CanonicalPortfolioAccountingTransitionPayload = {
      contractVersion: PORTFOLIO_ACCOUNTING_TRANSITION_CONTRACT_VERSION,
      transitionKind: 'TRADE_SETTLEMENT_APPLIED',
      ledgerGenesisHash,
      settlementPayloadHash: rebuiltSettlement.payloadHash,
      instrumentBusinessKey: rebuiltSettlement.instrumentBusinessKey,
      side: rebuiltSettlement.side,
      cashBalanceBeforeVnd: cashBalanceBeforeVnd.toString(10),
      cashDeltaVnd: cashDeltaVnd.toString(10),
      cashBalanceAfterVnd: cashBalanceAfterVnd.toString(10),
      positionQuantityBefore: positionQuantityBefore.toString(10),
      quantityDelta: quantityDelta.toString(10),
      positionQuantityAfter: positionQuantityAfter.toString(10)
    };

    const serialized = CanonicalSerializer.serialize(payload);
    const transitionHash = Sha256Service.hashString(serialized);

    const output: PortfolioAccountingTransition = {
      ...payload,
      transitionHash
    };

    return Object.freeze(output);
  }
}
