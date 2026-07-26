import { RunStatus } from '../types/RunStatus';

export const ValidTransitions: Record<RunStatus, RunStatus[]> = {
  [RunStatus.INITIALIZED]: [RunStatus.CONFIGURED],
  [RunStatus.CONFIGURED]: [RunStatus.RUNNING, RunStatus.TERMINATED],
  [RunStatus.RUNNING]: [RunStatus.PAUSED, RunStatus.TERMINATED, RunStatus.SEALED, RunStatus.FAILED],
  [RunStatus.PAUSED]: [RunStatus.RUNNING, RunStatus.TERMINATED],
  [RunStatus.FAILED]: [RunStatus.TERMINATED],
  [RunStatus.TERMINATED]: [RunStatus.SEALED],
  [RunStatus.SEALED]: [],
};
