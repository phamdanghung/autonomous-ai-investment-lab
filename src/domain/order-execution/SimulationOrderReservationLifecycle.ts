import { DomainError } from '../errors/DomainErrors';
import {
  SimulationOrderReservationTransitionInput,
  SimulationOrderReservationTransition,
  SIMULATION_ORDER_RESERVATION_LIFECYCLE_CONTRACT_VERSION,
  SIMULATION_ORDER_RESERVATION_TRANSITION_KIND
} from '../contracts/SimulationOrderReservationLifecycleContracts';

export class SimulationOrderReservationTransitionInvalidError extends DomainError {
  constructor(message: string = 'Simulation order reservation state transition is invalid.') {
    super(message, 'SIMULATION_ORDER_RESERVATION_TRANSITION_INVALID');
    this.name = 'SimulationOrderReservationTransitionInvalidError';
    Object.setPrototypeOf(this, SimulationOrderReservationTransitionInvalidError.prototype);
  }
}

const VALID_STATUSES = new Set<string>([
  'ACTIVE',
  'PARTIALLY_CONSUMED',
  'CONSUMED',
  'RELEASED',
  'FAILED'
]);

const ALLOWED_TRANSITIONS: Record<string, Set<string>> = {
  ACTIVE: new Set([
    'PARTIALLY_CONSUMED',
    'CONSUMED',
    'RELEASED',
    'FAILED'
  ]),
  PARTIALLY_CONSUMED: new Set([
    'CONSUMED',
    'RELEASED',
    'FAILED'
  ]),
  CONSUMED: new Set(),
  RELEASED: new Set(),
  FAILED: new Set()
};

export class SimulationOrderReservationLifecycleDomain {
  static transition(input: SimulationOrderReservationTransitionInput): SimulationOrderReservationTransition {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new SimulationOrderReservationTransitionInvalidError('Simulation order reservation state transition is invalid.');
    }

    const { from, to } = input as any;

    if (typeof from !== 'string' || !VALID_STATUSES.has(from)) {
      throw new SimulationOrderReservationTransitionInvalidError('Simulation order reservation state transition is invalid.');
    }

    if (typeof to !== 'string' || !VALID_STATUSES.has(to)) {
      throw new SimulationOrderReservationTransitionInvalidError('Simulation order reservation state transition is invalid.');
    }

    if (!ALLOWED_TRANSITIONS[from].has(to)) {
      throw new SimulationOrderReservationTransitionInvalidError('Simulation order reservation state transition is invalid.');
    }

    const output: SimulationOrderReservationTransition = {
      contractVersion: SIMULATION_ORDER_RESERVATION_LIFECYCLE_CONTRACT_VERSION,
      transitionKind: SIMULATION_ORDER_RESERVATION_TRANSITION_KIND,
      from: from as any,
      to: to as any
    };

    return Object.freeze(output);
  }
}
