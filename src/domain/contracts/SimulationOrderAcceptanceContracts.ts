import type { SimulationOrderIntent } from './SimulationOrderIntentContracts';
import type { SimulationRiskCheckResult } from './SimulationRiskCheckResultContracts';

export const SIMULATION_ORDER_CONTRACT_VERSION = '1.0' as const;

export const SIMULATION_ORDER_KIND = 'SIMULATION_ORDER' as const;

export interface SimulationOrderAcceptanceInput {
  intent: SimulationOrderIntent;
  hardMarketIntegrityResult: SimulationRiskCheckResult;
  strategyRiskResult: SimulationRiskCheckResult;
  eligibleSessionDate: string;
}

export interface CanonicalSimulationAcceptedOrderPayload {
  contractVersion: '1.0';
  orderKind: 'SIMULATION_ORDER';
  intentHash: string;
  runBusinessKey: string;
  simulationDate: string;
  eligibleSessionDate: string;
  instrumentBusinessKey: string;
  side: 'BUY' | 'SELL';
  quantity: string;
  orderType: 'MARKET';
  sourceDecisionHash: string;
  hardMarketIntegrityResultHash: string;
  strategyRiskResultHash: string;
  status: 'ACCEPTED';
}

export interface SimulationAcceptedOrder extends CanonicalSimulationAcceptedOrderPayload {
  orderHash: string;
}
