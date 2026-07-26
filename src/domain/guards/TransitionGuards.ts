import { RunStatus } from '../types/RunStatus';
import { RunMode } from '../types/RunMode';
import { ValidTransitions } from '../contracts/StateTransitionContract';
import { InvalidStateTransitionError } from '../errors/DomainErrors';

export class TransitionGuards {
  static validate(currentStatus: RunStatus, nextStatus: RunStatus, mode: RunMode): void {
    const allowed = ValidTransitions[currentStatus];
    if (!allowed || !allowed.includes(nextStatus)) {
      throw new InvalidStateTransitionError(currentStatus, nextStatus);
    }

    // `RUNNING → SEALED` chỉ dành cho completed `HISTORICAL_REPLAY`.
    if (currentStatus === RunStatus.RUNNING && nextStatus === RunStatus.SEALED) {
      if (mode !== RunMode.HISTORICAL_REPLAY) {
        throw new InvalidStateTransitionError(currentStatus, nextStatus);
      }
    }
  }
}
