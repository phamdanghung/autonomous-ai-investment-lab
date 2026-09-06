import { DomainError } from '../errors/DomainErrors';
import { CanonicalDate } from '../models/CanonicalDate';
import { CanonicalSerializer } from '../hashing/CanonicalSerializer';
import { Sha256Service } from '../services/Sha256Service';
import { SimulationOrderIntentDomain } from './SimulationOrderIntent';
import {
  SIMULATION_ORDER_CONTRACT_VERSION,
  SIMULATION_ORDER_KIND,
  CanonicalSimulationAcceptedOrderPayload
} from '../contracts/SimulationOrderAcceptanceContracts';
import {
  SimulationOrderReservationInput,
  SimulationOrderReservation,
  CanonicalSimulationOrderReservationPayload,
  SIMULATION_ORDER_RESERVATION_CONTRACT_VERSION,
  SIMULATION_ORDER_RESERVATION_KIND
} from '../contracts/SimulationOrderReservationContracts';

export class SimulationOrderReservationInvalidError extends DomainError {
  constructor(message: string = 'Simulation order reservation input is invalid.') {
    super(message, 'SIMULATION_ORDER_RESERVATION_INVALID');
    this.name = 'SimulationOrderReservationInvalidError';
    Object.setPrototypeOf(this, SimulationOrderReservationInvalidError.prototype);
  }
}

export class SimulationOrderReservationDomain {
  static create(input: SimulationOrderReservationInput): SimulationOrderReservation {
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('Input must be a non-null object.');
      }

      const { order, requiredCashVnd } = input as any;

      if (!order || typeof order !== 'object' || Array.isArray(order)) {
        throw new Error('Order must be a non-null object.');
      }

      if (typeof order.quantity !== 'string' || !/^[1-9][0-9]*$/.test(order.quantity)) {
        throw new Error('Quantity must be a canonical positive decimal string.');
      }

      let rebuiltIntent;
      try {
        rebuiltIntent = SimulationOrderIntentDomain.build({
          runBusinessKey: order.runBusinessKey,
          simulationDate: order.simulationDate,
          instrumentBusinessKey: order.instrumentBusinessKey,
          side: order.side,
          quantity: BigInt(order.quantity),
          orderType: order.orderType,
          sourceDecisionHash: order.sourceDecisionHash
        });
      } catch (e: any) {
        throw new Error(`Failed to rebuild intent: ${e.message}`);
      }

      if (
        order.runBusinessKey !== rebuiltIntent.runBusinessKey ||
        order.simulationDate !== rebuiltIntent.simulationDate ||
        order.instrumentBusinessKey !== rebuiltIntent.instrumentBusinessKey ||
        order.side !== rebuiltIntent.side ||
        order.quantity !== rebuiltIntent.quantity ||
        order.orderType !== rebuiltIntent.orderType ||
        order.sourceDecisionHash !== rebuiltIntent.sourceDecisionHash ||
        order.intentHash !== rebuiltIntent.intentHash
      ) {
        throw new Error('Intent canonical integrity mismatch.');
      }

      if (order.contractVersion !== SIMULATION_ORDER_CONTRACT_VERSION) {
        throw new Error('Order contractVersion mismatch.');
      }

      if (order.orderKind !== SIMULATION_ORDER_KIND) {
        throw new Error('Order orderKind mismatch.');
      }

      if (order.status !== 'ACCEPTED') {
        throw new Error('Order status must be ACCEPTED.');
      }

      if (
        typeof order.hardMarketIntegrityResultHash !== 'string' ||
        !/^[a-f0-9]{64}$/.test(order.hardMarketIntegrityResultHash)
      ) {
        throw new Error('hardMarketIntegrityResultHash must be exactly 64 hex chars.');
      }

      if (
        typeof order.strategyRiskResultHash !== 'string' ||
        !/^[a-f0-9]{64}$/.test(order.strategyRiskResultHash)
      ) {
        throw new Error('strategyRiskResultHash must be exactly 64 hex chars.');
      }

      let eligible;
      try {
        eligible = new CanonicalDate(order.eligibleSessionDate);
      } catch (e: any) {
        throw new Error('eligibleSessionDate is invalid.');
      }

      if (eligible.value !== order.eligibleSessionDate) {
        throw new Error('eligibleSessionDate is not in canonical format.');
      }

      if (order.eligibleSessionDate <= rebuiltIntent.simulationDate) {
        throw new Error('eligibleSessionDate must be strictly greater than simulationDate.');
      }

      const rebuiltOrderPayload: CanonicalSimulationAcceptedOrderPayload = {
        contractVersion: SIMULATION_ORDER_CONTRACT_VERSION,
        orderKind: SIMULATION_ORDER_KIND,
        intentHash: rebuiltIntent.intentHash,
        runBusinessKey: rebuiltIntent.runBusinessKey,
        simulationDate: rebuiltIntent.simulationDate,
        eligibleSessionDate: order.eligibleSessionDate,
        instrumentBusinessKey: rebuiltIntent.instrumentBusinessKey,
        side: rebuiltIntent.side,
        quantity: rebuiltIntent.quantity,
        orderType: rebuiltIntent.orderType,
        sourceDecisionHash: rebuiltIntent.sourceDecisionHash,
        hardMarketIntegrityResultHash: order.hardMarketIntegrityResultHash,
        strategyRiskResultHash: order.strategyRiskResultHash,
        status: 'ACCEPTED'
      };

      const serializedOrder = CanonicalSerializer.serialize(rebuiltOrderPayload);
      const rebuiltOrderHash = Sha256Service.hashString(serializedOrder);

      if (order.orderHash !== rebuiltOrderHash) {
        throw new Error('Order hash canonical integrity mismatch.');
      }

      let reservationType: 'CASH' | 'SECURITY';
      let reservedCashVnd: string | null = null;
      let reservedQuantity: string | null = null;

      if (order.side === 'BUY') {
        if (typeof requiredCashVnd !== 'bigint' || requiredCashVnd <= 0n) {
          throw new Error('BUY requiredCashVnd must be a positive bigint.');
        }
        reservationType = 'CASH';
        reservedCashVnd = requiredCashVnd.toString(10);
        reservedQuantity = null;
      } else {
        if (requiredCashVnd !== null) {
          throw new Error('SELL requiredCashVnd must be exactly null.');
        }
        reservationType = 'SECURITY';
        reservedCashVnd = null;
        reservedQuantity = order.quantity;
      }

      const payload: CanonicalSimulationOrderReservationPayload = {
        contractVersion: SIMULATION_ORDER_RESERVATION_CONTRACT_VERSION,
        reservationKind: SIMULATION_ORDER_RESERVATION_KIND,
        orderHash: order.orderHash,
        intentHash: order.intentHash,
        runBusinessKey: order.runBusinessKey,
        instrumentBusinessKey: order.instrumentBusinessKey,
        side: order.side,
        reservationType,
        reservedCashVnd,
        reservedQuantity,
        status: 'ACTIVE'
      };

      const serialized = CanonicalSerializer.serialize(payload);
      const reservationHash = Sha256Service.hashString(serialized);

      const output: SimulationOrderReservation = {
        ...payload,
        reservationHash
      };

      return Object.freeze(output);
    } catch (e: any) {
      throw new SimulationOrderReservationInvalidError(e.message || 'Simulation order reservation input is invalid.');
    }
  }
}
