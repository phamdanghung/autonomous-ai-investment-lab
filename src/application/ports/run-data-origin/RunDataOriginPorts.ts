export interface RunOriginActor {
  type: string;
  id: string;
}

export interface BindSimulationRunDataOriginCommand {
  runId: string;
  expectedVersion: number;
  dataOriginHash: string;
  canonicalStartDate: string;
  idempotencyKey: string;
  actor: RunOriginActor;
}

export interface BoundSimulationRunDataOrigin {
  runId: string;
  version: number;
  status: 'CONFIGURED';
  dataOriginHash: string;
  canonicalStartDate: string;
  runBusinessKey: string;
}

export interface ISimulationRunDataOriginBinder {
  bind(
    command: BindSimulationRunDataOriginCommand
  ): Promise<BoundSimulationRunDataOrigin>;
}
