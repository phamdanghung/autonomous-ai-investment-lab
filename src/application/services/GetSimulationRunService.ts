import { simulationRunQueryRepository } from '../../infrastructure/repositories/SimulationRunQueryRepository';

export class GetSimulationRunService {
  static async execute(runId: string, actor: any) {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    
    const run = await prisma.simulationRun.findUnique({
      where: { id: runId },
      include: {
        configVersion: true,
        events: {
          orderBy: { eventSequence: 'asc' }
        }
      }
    });

    if (!run) {
      throw new Error('SimulationRun not found');
    }

    return run;
  }
}
