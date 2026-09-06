export type SimulationOrderStatus =
  | 'ACCEPTED'
  | 'ACTIVE'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCEL_PENDING'
  | 'CANCELLED'
  | 'EXPIRED';

export const SIMULATION_ORDER_LIFECYCLE_CONTRACT_VERSION = '1.0' as const;

export const SIMULATION_ORDER_TRANSITION_KIND =
  'SIMULATION_ORDER_STATE_TRANSITION' as const;

export interface SimulationOrderTransitionInput {
  from: SimulationOrderStatus;
  to: SimulationOrderStatus;
}

export interface SimulationOrderTransition {
  contractVersion: '1.0';
  transitionKind: 'SIMULATION_ORDER_STATE_TRANSITION';
  from: SimulationOrderStatus;
  to: SimulationOrderStatus;
}
