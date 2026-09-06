import { DomainError } from '../errors/DomainErrors';
import { CanonicalDate } from '../models/CanonicalDate';
import { CanonicalSerializer } from '../hashing/CanonicalSerializer';
import { Sha256Service } from '../services/Sha256Service';
import { SimulationOrderIntentDomain } from './SimulationOrderIntent';
import { SimulationRiskCheckResultDomain } from './SimulationRiskCheckResult';
import {
  SimulationOrderAcceptanceInput,
  SimulationAcceptedOrder,
  CanonicalSimulationAcceptedOrderPayload,
  SIMULATION_ORDER_CONTRACT_VERSION,
  SIMULATION_ORDER_KIND
} from '../contracts/SimulationOrderAcceptanceContracts';

export class SimulationOrderAcceptanceInvalidError extends DomainError {
  constructor(message: string = 'Simulation order acceptance input is invalid.') {
    super(message, 'SIMULATION_ORDER_ACCEPTANCE_INVALID');
    this.name = 'SimulationOrderAcceptanceInvalidError';
    Object.setPrototypeOf(this, SimulationOrderAcceptanceInvalidError.prototype);
  }
}

export class SimulationOrderAcceptanceDomain {
  static accept(input: SimulationOrderAcceptanceInput): SimulationAcceptedOrder {
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('Input must be a non-null object.');
      }

      const { intent, hardMarketIntegrityResult: hard, strategyRiskResult: strategy, eligibleSessionDate } = input as any;

      if (!intent || typeof intent !== 'object' || Array.isArray(intent)) {
        throw new Error('intent must be a non-null object.');
      }

      if (typeof intent.quantity !== 'string' || !/^[1-9][0-9]*$/.test(intent.quantity)) {
        throw new Error('quantity must be a canonical positive decimal string.');
      }

      let validatedIntent;
      try {
        validatedIntent = SimulationOrderIntentDomain.build({
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

      if (
        intent.contractVersion !== validatedIntent.contractVersion ||
        intent.orderKind !== validatedIntent.orderKind ||
        intent.runBusinessKey !== validatedIntent.runBusinessKey ||
        intent.simulationDate !== validatedIntent.simulationDate ||
        intent.instrumentBusinessKey !== validatedIntent.instrumentBusinessKey ||
        intent.side !== validatedIntent.side ||
        intent.quantity !== validatedIntent.quantity ||
        intent.orderType !== validatedIntent.orderType ||
        intent.sourceDecisionHash !== validatedIntent.sourceDecisionHash ||
        intent.intentHash !== validatedIntent.intentHash
      ) {
        throw new Error('Intent canonical integrity mismatch.');
      }

      if (!hard || typeof hard !== 'object' || Array.isArray(hard)) {
        throw new Error('hardMarketIntegrityResult must be a non-null object.');
      }

      let validatedHard;
      try {
        validatedHard = SimulationRiskCheckResultDomain.build({
          intentHash: hard.intentHash,
          policyCode: hard.policyCode,
          policyVersionHash: hard.policyVersionHash,
          checks: hard.checks
        });
      } catch (e: any) {
        throw new Error(`Failed to rebuild hard result: ${e.message}`);
      }

      if (
        hard.contractVersion !== validatedHard.contractVersion ||
        hard.resultKind !== validatedHard.resultKind ||
        hard.intentHash !== validatedHard.intentHash ||
        hard.policyCode !== validatedHard.policyCode ||
        hard.policyVersionHash !== validatedHard.policyVersionHash ||
        hard.passed !== validatedHard.passed ||
        hard.resultHash !== validatedHard.resultHash ||
        !Array.isArray(hard.checks) ||
        hard.checks.length !== validatedHard.checks.length
      ) {
        throw new Error('Hard result canonical integrity mismatch.');
      }

      for (let i = 0; i < hard.checks.length; i++) {
        const c1 = hard.checks[i];
        const c2 = validatedHard.checks[i];
        if (c1.checkCode !== c2.checkCode || c1.passed !== c2.passed || c1.reasonCode !== c2.reasonCode) {
          throw new Error('Hard result check canonical integrity mismatch.');
        }
      }

      if (hard.policyCode !== 'HARD_MARKET_INTEGRITY') {
        throw new Error('Hard policyCode must be HARD_MARKET_INTEGRITY.');
      }

      if (hard.passed !== true) {
        throw new Error('Hard result must be passed.');
      }

      for (const check of hard.checks) {
        if (check.passed !== true || check.reasonCode !== null) {
          throw new Error('All hard checks must pass.');
        }
      }

      const hardActualChecks = hard.checks.map((c: any) => c.checkCode);
      const buyChecks = ['AVAILABLE_CASH', 'IDEMPOTENCY_UNIQUE', 'INSTRUMENT_TRADABLE', 'LOT_SIZE_VALID', 'MARKET_DATA_VALID'];
      const sellChecks = ['IDEMPOTENCY_UNIQUE', 'INSTRUMENT_TRADABLE', 'LOT_SIZE_VALID', 'MARKET_DATA_VALID', 'SELLABLE_QUANTITY'];
      
      const isBuy = hardActualChecks.length === 5 && hardActualChecks.every((c: string, i: number) => c === buyChecks[i]);
      const isSell = hardActualChecks.length === 5 && hardActualChecks.every((c: string, i: number) => c === sellChecks[i]);
      
      if (!isBuy && !isSell) {
        throw new Error('Hard result checks do not match exactly the required canonical BUY or SELL sets.');
      }

      if (!strategy || typeof strategy !== 'object' || Array.isArray(strategy)) {
        throw new Error('strategyRiskResult must be a non-null object.');
      }

      let validatedStrategy;
      try {
        validatedStrategy = SimulationRiskCheckResultDomain.build({
          intentHash: strategy.intentHash,
          policyCode: strategy.policyCode,
          policyVersionHash: strategy.policyVersionHash,
          checks: strategy.checks
        });
      } catch (e: any) {
        throw new Error(`Failed to rebuild strategy result: ${e.message}`);
      }

      if (
        strategy.contractVersion !== validatedStrategy.contractVersion ||
        strategy.resultKind !== validatedStrategy.resultKind ||
        strategy.intentHash !== validatedStrategy.intentHash ||
        strategy.policyCode !== validatedStrategy.policyCode ||
        strategy.policyVersionHash !== validatedStrategy.policyVersionHash ||
        strategy.passed !== validatedStrategy.passed ||
        strategy.resultHash !== validatedStrategy.resultHash ||
        !Array.isArray(strategy.checks) ||
        strategy.checks.length !== validatedStrategy.checks.length
      ) {
        throw new Error('Strategy result canonical integrity mismatch.');
      }

      for (let i = 0; i < strategy.checks.length; i++) {
        const c1 = strategy.checks[i];
        const c2 = validatedStrategy.checks[i];
        if (c1.checkCode !== c2.checkCode || c1.passed !== c2.passed || c1.reasonCode !== c2.reasonCode) {
          throw new Error('Strategy result check canonical integrity mismatch.');
        }
      }

      if (strategy.policyCode !== 'STRATEGY_RISK') {
        throw new Error('Strategy policyCode must be STRATEGY_RISK.');
      }

      if (strategy.passed !== true) {
        throw new Error('Strategy result must be passed.');
      }

      for (const check of strategy.checks) {
        if (check.passed !== true || check.reasonCode !== null) {
          throw new Error('All strategy checks must pass.');
        }
      }

      const strategyActualChecks = strategy.checks.map((c: any) => c.checkCode);
      const expectedStrategyChecks = ['CONCENTRATION_LIMIT_VALID', 'WASH_TRADING_FREE'];
      
      const isStrategyValid = strategyActualChecks.length === 2 && strategyActualChecks.every((c: string, i: number) => c === expectedStrategyChecks[i]);
      if (!isStrategyValid) {
        throw new Error('Strategy result checks do not match exactly the required canonical set.');
      }

      if (validatedHard.intentHash !== validatedIntent.intentHash) {
        throw new Error('Hard result intentHash mismatch.');
      }

      if (validatedStrategy.intentHash !== validatedIntent.intentHash) {
        throw new Error('Strategy result intentHash mismatch.');
      }

      let eligible;
      try {
        eligible = new CanonicalDate(eligibleSessionDate);
      } catch (e: any) {
        throw new Error('eligibleSessionDate is invalid.');
      }
      
      if (eligible.value !== eligibleSessionDate) {
        throw new Error('eligibleSessionDate is not in canonical format.');
      }

      if (eligibleSessionDate <= validatedIntent.simulationDate) {
        throw new Error('eligibleSessionDate must be strictly greater than simulationDate.');
      }

      const payload: CanonicalSimulationAcceptedOrderPayload = {
        contractVersion: SIMULATION_ORDER_CONTRACT_VERSION,
        orderKind: SIMULATION_ORDER_KIND,
        intentHash: validatedIntent.intentHash,
        runBusinessKey: validatedIntent.runBusinessKey,
        simulationDate: validatedIntent.simulationDate,
        eligibleSessionDate,
        instrumentBusinessKey: validatedIntent.instrumentBusinessKey,
        side: validatedIntent.side,
        quantity: validatedIntent.quantity,
        orderType: validatedIntent.orderType,
        sourceDecisionHash: validatedIntent.sourceDecisionHash,
        hardMarketIntegrityResultHash: validatedHard.resultHash,
        strategyRiskResultHash: validatedStrategy.resultHash,
        status: 'ACCEPTED'
      };

      const serialized = CanonicalSerializer.serialize(payload);
      const orderHash = Sha256Service.hashString(serialized);

      const output: SimulationAcceptedOrder = {
        ...payload,
        orderHash
      };

      return Object.freeze(output);
    } catch (err: any) {
      throw new SimulationOrderAcceptanceInvalidError();
    }
  }
}
