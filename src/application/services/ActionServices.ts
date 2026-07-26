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

export class PauseSimulationRunService {
  static async execute(runId: string, version: number, dto: any, actor: { type: string; id: string }) {
    return TransitionHelper.transition(
      runId, version, RunStatus.RUNNING, RunStatus.PAUSED,
      { payload: dto.payload, idempotencyKey: dto.idempotencyKey, eventType: 'RUN_PAUSE', reason: dto.reason },
      actor
    );
  }
}

export class ResumeSimulationRunService {
  static async execute(runId: string, version: number, dto: any, actor: { type: string; id: string }) {
    return TransitionHelper.transition(
      runId, version, RunStatus.PAUSED, RunStatus.RUNNING,
      { payload: dto.payload, idempotencyKey: dto.idempotencyKey, eventType: 'RUN_RESUME', reason: dto.reason },
      actor
    );
  }
}

export class TerminateSimulationRunService {
  static async execute(runId: string, version: number, expectedStatus: RunStatus, dto: any, actor: { type: string; id: string }) {
    return TransitionHelper.transition(
      runId, version, expectedStatus, RunStatus.TERMINATED,
      { payload: dto.payload, idempotencyKey: dto.idempotencyKey, eventType: 'RUN_TERMINATE', reason: dto.reason },
      actor
    );
  }
}

export class SealSimulationRunService {
  static async execute(runId: string, version: number, expectedStatus: RunStatus, dto: any, actor: { type: string; id: string }) {
    return TransitionHelper.transition(
      runId, version, expectedStatus, RunStatus.SEALED,
      { payload: dto.payload, idempotencyKey: dto.idempotencyKey, eventType: 'RUN_SEAL', reason: dto.reason },
      actor
    );
  }
}
