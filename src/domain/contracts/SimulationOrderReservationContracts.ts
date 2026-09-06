import type { SimulationAcceptedOrder } from './SimulationOrderAcceptanceContracts';

export const SIMULATION_ORDER_RESERVATION_CONTRACT_VERSION = '1.0' as const;
export const SIMULATION_ORDER_RESERVATION_KIND = 'SIMULATION_ORDER_RESERVATION' as const;

export type SimulationOrderReservationType = 'CASH' | 'SECURITY';

export type SimulationOrderReservationStatus =
  | 'ACTIVE'
  | 'PARTIALLY_CONSUMED'
  | 'CONSUMED'
  | 'RELEASED'
  | 'FAILED';

export interface SimulationOrderReservationInput {
  order: SimulationAcceptedOrder;
  requiredCashVnd: bigint | null;
}

export interface CanonicalSimulationOrderReservationPayload {
  contractVersion: '1.0';
  reservationKind: 'SIMULATION_ORDER_RESERVATION';
  orderHash: string;
  intentHash: string;
  runBusinessKey: string;
  instrumentBusinessKey: string;
  side: 'BUY' | 'SELL';
  reservationType: 'CASH' | 'SECURITY';
  reservedCashVnd: string | null;
  reservedQuantity: string | null;
  status: 'ACTIVE';
}

export interface SimulationOrderReservation extends CanonicalSimulationOrderReservationPayload {
  reservationHash: string;
}
