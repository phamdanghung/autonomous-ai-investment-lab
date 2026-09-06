import { DomainError } from '../errors/DomainErrors';
import {
  SimulationOrderStatus,
  SimulationOrderTransitionInput,
  SimulationOrderTransition,
  SIMULATION_ORDER_LIFECYCLE_CONTRACT_VERSION,
  SIMULATION_ORDER_TRANSITION_KIND
} from '../contracts/SimulationOrderLifecycleContracts';

export class SimulationOrderTransitionInvalidError extends DomainError {
  constructor(message: string = 'Simulation order state transition is invalid.') {
    super(message, 'SIMULATION_ORDER_TRANSITION_INVALID');
    this.name = 'SimulationOrderTransitionInvalidError';
    Object.setPrototypeOf(this, SimulationOrderTransitionInvalidError.prototype);
  }
}

const VALID_STATUSES = new Set<string>([
  'ACCEPTED',
  'ACTIVE',
  'PARTIALLY_FILLED',
  'FILLED',
  'CANCEL_PENDING',
  'CANCELLED',
  'EXPIRED'
]);

const ALLOWED_TRANSITIONS: Record<string, Set<string>> = {
  'ACCEPTED': new Set(['ACTIVE']),
  'ACTIVE': new Set(['FILLED', 'PARTIALLY_FILLED', 'CANCEL_PENDING', 'EXPIRED']),
  'PARTIALLY_FILLED': new Set(['FILLED', 'CANCEL_PENDING', 'EXPIRED']),
  'CANCEL_PENDING': new Set(['CANCELLED']),
  'FILLED': new Set(),
  'CANCELLED': new Set(),
  'EXPIRED': new Set()
};

export class SimulationOrderLifecycleDomain {
  static transition(input: SimulationOrderTransitionInput): SimulationOrderTransition {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new SimulationOrderTransitionInvalidError();
    }

    const { from, to } = input as any;

    if (typeof from !== 'string' || !VALID_STATUSES.has(from)) {
      throw new SimulationOrderTransitionInvalidError();
    }

    if (typeof to !== 'string' || !VALID_STATUSES.has(to)) {
      throw new SimulationOrderTransitionInvalidError();
    }

    const allowedNext = ALLOWED_TRANSITIONS[from];
    if (!allowedNext || !allowedNext.has(to)) {
      throw new SimulationOrderTransitionInvalidError();
    }

    const output: SimulationOrderTransition = {
      contractVersion: SIMULATION_ORDER_LIFECYCLE_CONTRACT_VERSION,
      transitionKind: SIMULATION_ORDER_TRANSITION_KIND,
      from: from as SimulationOrderStatus,
      to: to as SimulationOrderStatus
    };

    return Object.freeze(output);
  }
}
