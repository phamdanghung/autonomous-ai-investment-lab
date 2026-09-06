import { DomainError } from '../errors/DomainErrors';
import { HardMarketIntegrityPolicyInput } from '../contracts/HardMarketIntegrityPolicyContracts';
import { SimulationRiskCheckResult } from '../contracts/SimulationRiskCheckResultContracts';
import { SimulationOrderIntentDomain } from './SimulationOrderIntent';
import { SimulationRiskCheckResultDomain } from './SimulationRiskCheckResult';

export class HardMarketIntegrityPolicyInvalidError extends DomainError {
  constructor(message: string = 'Hard market integrity policy input is invalid.') {
    super(message, 'HARD_MARKET_INTEGRITY_POLICY_INVALID');
    this.name = 'HardMarketIntegrityPolicyInvalidError';
    Object.setPrototypeOf(this, HardMarketIntegrityPolicyInvalidError.prototype);
  }
}

export class HardMarketIntegrityPolicyDomain {
  static evaluate(input: HardMarketIntegrityPolicyInput): SimulationRiskCheckResult {
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('Input must be a non-null object.');
      }

      const {
        intent,
        policyVersionHash,
        availableCashVnd,
        requiredCashVnd,
        sellableQuantity,
        instrumentTradable,
        marketDataValid,
        boardLotSize,
        idempotencyUnique
      } = input as any;

      if (!intent || typeof intent !== 'object') {
        throw new Error('Intent is required.');
      }

      let rebuilt;
      try {
        rebuilt = SimulationOrderIntentDomain.build({
          runBusinessKey: intent.runBusinessKey,
          simulationDate: intent.simulationDate,
          instrumentBusinessKey: intent.instrumentBusinessKey,
          side: intent.side,
          quantity: BigInt(intent.quantity),
          orderType: intent.orderType,
          sourceDecisionHash: intent.sourceDecisionHash
        });
      } catch (e: any) {
        throw new Error(`Failed to rebuild intent: ${e.message}`);
      }

      if (rebuilt.intentHash !== intent.intentHash) {
        throw new Error('Intent hash mismatch.');
      }

      if (typeof policyVersionHash !== 'string' || !/^[a-f0-9]{64}$/.test(policyVersionHash)) {
        throw new Error('policyVersionHash must be exactly 64 lowercase hex characters.');
      }

      if (typeof instrumentTradable !== 'boolean') {
        throw new Error('instrumentTradable must be boolean.');
      }

      if (typeof marketDataValid !== 'boolean') {
        throw new Error('marketDataValid must be boolean.');
      }

      if (typeof idempotencyUnique !== 'boolean') {
        throw new Error('idempotencyUnique must be boolean.');
      }

      if (typeof boardLotSize !== 'bigint' || boardLotSize <= 0n) {
        throw new Error('boardLotSize must be bigint > 0.');
      }

      const intentQuantity = BigInt(rebuilt.quantity);
      if (intentQuantity <= 0n) {
        throw new Error('intentQuantity must be > 0.');
      }

      const checks = [];

      if (rebuilt.side === 'BUY') {
        if (typeof availableCashVnd !== 'bigint' || availableCashVnd < 0n) {
          throw new Error('BUY requires availableCashVnd to be bigint >= 0n.');
        }
        if (typeof requiredCashVnd !== 'bigint' || requiredCashVnd <= 0n) {
          throw new Error('BUY requires requiredCashVnd to be bigint > 0n.');
        }
        if (sellableQuantity !== null) {
          throw new Error('BUY requires sellableQuantity to be null.');
        }

        const isCashAvailable = availableCashVnd >= requiredCashVnd;
        checks.push({
          checkCode: 'AVAILABLE_CASH',
          passed: isCashAvailable,
          reasonCode: isCashAvailable ? null : 'INSUFFICIENT_AVAILABLE_CASH'
        });
      } else if (rebuilt.side === 'SELL') {
        if (availableCashVnd !== null) {
          throw new Error('SELL requires availableCashVnd to be null.');
        }
        if (requiredCashVnd !== null) {
          throw new Error('SELL requires requiredCashVnd to be null.');
        }
        if (typeof sellableQuantity !== 'bigint' || sellableQuantity < 0n) {
          throw new Error('SELL requires sellableQuantity to be bigint >= 0n.');
        }

        const isSellable = sellableQuantity >= intentQuantity;
        checks.push({
          checkCode: 'SELLABLE_QUANTITY',
          passed: isSellable,
          reasonCode: isSellable ? null : 'INSUFFICIENT_SELLABLE_QUANTITY'
        });
      } else {
        throw new Error('Invalid intent side.');
      }

      checks.push({
        checkCode: 'IDEMPOTENCY_UNIQUE',
        passed: idempotencyUnique,
        reasonCode: idempotencyUnique ? null : 'DUPLICATE_INTENT'
      });

      checks.push({
        checkCode: 'INSTRUMENT_TRADABLE',
        passed: instrumentTradable,
        reasonCode: instrumentTradable ? null : 'INSTRUMENT_NOT_TRADABLE'
      });

      const isLotValid = intentQuantity % boardLotSize === 0n;
      checks.push({
        checkCode: 'LOT_SIZE_VALID',
        passed: isLotValid,
        reasonCode: isLotValid ? null : 'INVALID_BOARD_LOT'
      });

      checks.push({
        checkCode: 'MARKET_DATA_VALID',
        passed: marketDataValid,
        reasonCode: marketDataValid ? null : 'MARKET_DATA_INVALID'
      });

      return SimulationRiskCheckResultDomain.build({
        intentHash: rebuilt.intentHash,
        policyCode: 'HARD_MARKET_INTEGRITY',
        policyVersionHash: policyVersionHash,
        checks
      });

    } catch (err: any) {
      throw new HardMarketIntegrityPolicyInvalidError();
    }
  }
}
