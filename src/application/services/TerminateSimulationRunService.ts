import { TransitionHelper } from './TransitionHelper';
import { RunStatus } from '../../domain/types/RunStatus';

export class TerminateSimulationRunService {
  static async execute(runId: string, version: number, expectedStatus: RunStatus, dto: any, actor: { type: string; id: string }) {
    return TransitionHelper.transition(
      runId, version, expectedStatus, RunStatus.TERMINATED,
      { payload: dto.payload, idempotencyKey: dto.idempotencyKey, eventType: 'RUN_TERMINATE', reason: dto.reason },
      actor
    );
  }
}
