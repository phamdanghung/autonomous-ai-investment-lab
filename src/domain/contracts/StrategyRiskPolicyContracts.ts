import type { SimulationRiskCheckResult } from './SimulationRiskCheckResultContracts';

export interface StrategyRiskPolicyInput {
  hardMarketIntegrityResult: SimulationRiskCheckResult;
  policyVersionHash: string;
  concentrationLimitValid: boolean;
  washTradingFree: boolean;
}
