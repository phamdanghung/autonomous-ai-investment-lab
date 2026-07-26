import { TransitionHelper } from './TransitionHelper';
import { RunStatus } from '../../domain/types/RunStatus';

export class PauseSimulationRunService {
  static async execute(runId: string, version: number, dto: any, actor: { type: string; id: string }) {
    return TransitionHelper.transition(
      runId, version, RunStatus.RUNNING, RunStatus.PAUSED,
      { payload: dto.payload, idempotencyKey: dto.idempotencyKey, eventType: 'RUN_PAUSE', reason: dto.reason },
      actor
    );
  }
}
