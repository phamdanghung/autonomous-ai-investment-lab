import { TransitionHelper } from './TransitionHelper';
import { RunStatus } from '../../domain/types/RunStatus';

export class StartSimulationRunService {
  static async execute(runId: string, version: number, dto: any, actor: { type: string; id: string }) {
    return TransitionHelper.transition(
      runId, version, RunStatus.CONFIGURED, RunStatus.RUNNING,
      { payload: dto.payload, idempotencyKey: dto.idempotencyKey, eventType: 'RUN_START', reason: dto.reason },
      actor
    );
  }
}
