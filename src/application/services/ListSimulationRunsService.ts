import { simulationRunQueryRepository } from '../../infrastructure/repositories/SimulationRunQueryRepository';

export class ListSimulationRunsService {
  static async execute(params: { page: number; pageSize: number }, actor: any) {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    
    const skip = (params.page - 1) * params.pageSize;
    const [runs, count] = await Promise.all([
      simulationRunQueryRepository.listPaginated(params.pageSize, skip),
      prisma.simulationRun.count()
    ]);
    
    return {
      runs,
      total: count,
      page: params.page,
      pageSize: params.pageSize
    };
  }
}
