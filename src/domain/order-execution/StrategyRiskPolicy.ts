import { DomainError } from '../errors/DomainErrors';
import { StrategyRiskPolicyInput } from '../contracts/StrategyRiskPolicyContracts';
import { SimulationRiskCheckResult } from '../contracts/SimulationRiskCheckResultContracts';
import { SimulationRiskCheckResultDomain } from './SimulationRiskCheckResult';

export class StrategyRiskPolicyInvalidError extends DomainError {
  constructor(message: string = 'Strategy risk policy input is invalid.') {
    super(message, 'STRATEGY_RISK_POLICY_INVALID');
    this.name = 'StrategyRiskPolicyInvalidError';
    Object.setPrototypeOf(this, StrategyRiskPolicyInvalidError.prototype);
  }
}

export class StrategyRiskPolicyDomain {
  static evaluate(input: StrategyRiskPolicyInput): SimulationRiskCheckResult {
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('Input must be a non-null object.');
      }

      const {
        hardMarketIntegrityResult: hard,
        policyVersionHash,
        concentrationLimitValid,
        washTradingFree
      } = input as any;

      if (!hard || typeof hard !== 'object' || Array.isArray(hard)) {
        throw new Error('hardMarketIntegrityResult must be a valid object.');
      }

      if (typeof policyVersionHash !== 'string' || !/^[a-f0-9]{64}$/.test(policyVersionHash)) {
        throw new Error('policyVersionHash must be exactly 64 lowercase hex characters.');
      }

      if (typeof concentrationLimitValid !== 'boolean') {
        throw new Error('concentrationLimitValid must be boolean.');
      }

      if (typeof washTradingFree !== 'boolean') {
        throw new Error('washTradingFree must be boolean.');
      }

      let rebuiltHard;
      try {
        rebuiltHard = SimulationRiskCheckResultDomain.build({
          intentHash: hard.intentHash,
          policyCode: hard.policyCode,
          policyVersionHash: hard.policyVersionHash,
          checks: hard.checks
        });
      } catch (e: any) {
        throw new Error(`Failed to rebuild hard result: ${e.message}`);
      }

      if (
        hard.contractVersion !== rebuiltHard.contractVersion ||
        hard.resultKind !== rebuiltHard.resultKind ||
        hard.intentHash !== rebuiltHard.intentHash ||
        hard.policyCode !== rebuiltHard.policyCode ||
        hard.policyVersionHash !== rebuiltHard.policyVersionHash ||
        hard.passed !== rebuiltHard.passed ||
        hard.resultHash !== rebuiltHard.resultHash ||
        !Array.isArray(hard.checks) ||
        hard.checks.length !== rebuiltHard.checks.length
      ) {
        throw new Error('Hard result canonical integrity mismatch.');
      }

      for (let i = 0; i < hard.checks.length; i++) {
        const c1 = hard.checks[i];
        const c2 = rebuiltHard.checks[i];
        if (
          c1.checkCode !== c2.checkCode ||
          c1.passed !== c2.passed ||
          c1.reasonCode !== c2.reasonCode
        ) {
          throw new Error('Hard result check canonical integrity mismatch.');
        }
      }

      if (hard.policyCode !== 'HARD_MARKET_INTEGRITY') {
        throw new Error('Hard policyCode must be HARD_MARKET_INTEGRITY.');
      }

      if (hard.passed !== true) {
        throw new Error('Hard result must be passed.');
      }

      const buyChecks = [
        'AVAILABLE_CASH',
        'IDEMPOTENCY_UNIQUE',
        'INSTRUMENT_TRADABLE',
        'LOT_SIZE_VALID',
        'MARKET_DATA_VALID'
      ];

      const sellChecks = [
        'IDEMPOTENCY_UNIQUE',
        'INSTRUMENT_TRADABLE',
        'LOT_SIZE_VALID',
        'MARKET_DATA_VALID',
        'SELLABLE_QUANTITY'
      ];

      const actualChecks = hard.checks.map((c: any) => c.checkCode);

      const isBuy = actualChecks.length === 5 && actualChecks.every((c: string, i: number) => c === buyChecks[i]);
      const isSell = actualChecks.length === 5 && actualChecks.every((c: string, i: number) => c === sellChecks[i]);

      if (!isBuy && !isSell) {
        throw new Error('Hard result checks do not match exactly the required canonical BUY or SELL sets.');
      }

      for (const check of hard.checks) {
        if (check.passed !== true || check.reasonCode !== null) {
          throw new Error('All hard checks must pass.');
        }
      }

      const checks = [];

      checks.push({
        checkCode: 'CONCENTRATION_LIMIT_VALID',
        passed: concentrationLimitValid,
        reasonCode: concentrationLimitValid ? null : 'CONCENTRATION_LIMIT_EXCEEDED'
      });

      checks.push({
        checkCode: 'WASH_TRADING_FREE',
        passed: washTradingFree,
        reasonCode: washTradingFree ? null : 'WASH_TRADING_DETECTED'
      });

      return SimulationRiskCheckResultDomain.build({
        intentHash: hard.intentHash,
        policyCode: 'STRATEGY_RISK',
        policyVersionHash,
        checks
      });
    } catch (err: any) {
      throw new StrategyRiskPolicyInvalidError();
    }
  }
}
