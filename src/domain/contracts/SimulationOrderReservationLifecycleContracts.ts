import type { SimulationOrderReservationStatus } from './SimulationOrderReservationContracts';

export const SIMULATION_ORDER_RESERVATION_LIFECYCLE_CONTRACT_VERSION = '1.0' as const;

export const SIMULATION_ORDER_RESERVATION_TRANSITION_KIND = 'SIMULATION_ORDER_RESERVATION_STATE_TRANSITION' as const;

export interface SimulationOrderReservationTransitionInput {
  from: SimulationOrderReservationStatus;
  to: SimulationOrderReservationStatus;
}

export interface SimulationOrderReservationTransition {
  contractVersion: '1.0';
  transitionKind: 'SIMULATION_ORDER_RESERVATION_STATE_TRANSITION';
  from: SimulationOrderReservationStatus;
  to: SimulationOrderReservationStatus;
}
