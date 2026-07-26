export interface ISimulationRunQueryRepository {
  findDetailById(id: string): Promise<any | null>;
  listPaginated(limit: number, offset: number): Promise<any[]>;
  listEvents(runId: string): Promise<any[]>;
}
