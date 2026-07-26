import { RunStatus } from '../types/RunStatus';

export class DomainError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'DomainError';
  }
}

export class RunVersionConflictError extends Error {
  constructor() {
    super('Optimistic locking failure: run version conflict');
    this.name = 'RunVersionConflictError';
  }
}

export class InvalidStateTransitionError extends Error {
  constructor(current: RunStatus, next: RunStatus) {
    super(`Invalid transition from ${current} to ${next}`);
    this.name = 'InvalidStateTransitionError';
  }
}

export class InvalidOperationError extends DomainError {
  constructor(message: string) {
    super(message, 'INVALID_OPERATION');
  }
}

export class IdempotencyKeyReusedError extends DomainError {
  constructor() {
    super('Idempotency key reused with different request payload.', 'IDEMPOTENCY_KEY_REUSED');
  }
}
