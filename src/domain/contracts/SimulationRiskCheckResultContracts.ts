export const SIMULATION_RISK_CHECK_RESULT_CONTRACT_VERSION = '1.0' as const;

export const SIMULATION_RISK_CHECK_RESULT_KIND =
  'SIMULATION_RISK_CHECK_RESULT' as const;

export type SimulationRiskPolicyCode =
  | 'HARD_MARKET_INTEGRITY'
  | 'STRATEGY_RISK';

export interface SimulationRiskCheckObservationInput {
  checkCode: string;
  passed: boolean;
  reasonCode: string | null;
}

export interface CanonicalSimulationRiskCheckObservation {
  checkCode: string;
  passed: boolean;
  reasonCode: string | null;
}

export interface SimulationRiskCheckResultInput {
  intentHash: string;
  policyCode: SimulationRiskPolicyCode;
  policyVersionHash: string;
  checks: readonly SimulationRiskCheckObservationInput[];
}

export interface CanonicalSimulationRiskCheckResultPayload {
  contractVersion: '1.0';
  resultKind: 'SIMULATION_RISK_CHECK_RESULT';
  intentHash: string;
  policyCode: SimulationRiskPolicyCode;
  policyVersionHash: string;
  passed: boolean;
  checks: readonly CanonicalSimulationRiskCheckObservation[];
}

export interface SimulationRiskCheckResult
  extends CanonicalSimulationRiskCheckResultPayload {
  resultHash: string;
}
