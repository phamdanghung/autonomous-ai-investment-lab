import { TransitionHelper } from './TransitionHelper';
import { RunStatus } from '../../domain/types/RunStatus';

export class SealSimulationRunService {
  static async execute(runId: string, version: number, expectedStatus: RunStatus, dto: any, actor: { type: string; id: string }) {
    return TransitionHelper.transition(
      runId, version, expectedStatus, RunStatus.SEALED,
      { payload: dto.payload, idempotencyKey: dto.idempotencyKey, eventType: 'RUN_SEAL', reason: dto.reason },
      actor
    );
  }
}
