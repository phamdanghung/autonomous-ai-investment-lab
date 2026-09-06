export const SIMULATION_ORDER_INTENT_CONTRACT_VERSION = '1.0' as const;

export const SIMULATION_ORDER_INTENT_KIND = 'SIMULATION_ORDER_INTENT' as const;

export type SimulationOrderSide = 'BUY' | 'SELL';

export type SimulationOrderType = 'MARKET';

export interface SimulationOrderIntentInput {
  runBusinessKey: string;
  simulationDate: string;
  instrumentBusinessKey: string;
  side: SimulationOrderSide;
  quantity: bigint;
  orderType: SimulationOrderType;
  sourceDecisionHash: string;
}

export interface CanonicalSimulationOrderIntentPayload {
  contractVersion: '1.0';
  orderKind: 'SIMULATION_ORDER_INTENT';
  runBusinessKey: string;
  simulationDate: string;
  instrumentBusinessKey: string;
  side: 'BUY' | 'SELL';
  quantity: string;
  orderType: 'MARKET';
  sourceDecisionHash: string;
}

export interface SimulationOrderIntent extends CanonicalSimulationOrderIntentPayload {
  intentHash: string;
}
