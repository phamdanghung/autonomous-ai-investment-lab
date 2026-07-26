import { PrismaClient } from '@prisma/client';

import { ISimulationRunQueryRepository } from '../../application/ports/repositories/ISimulationRunQueryRepository';

const prisma = new PrismaClient();

export class SimulationRunQueryRepository implements ISimulationRunQueryRepository {
  async findDetailById(id: string) {
    return prisma.simulationRun.findUnique({
      where: { id },
      include: {
        configVersion: true,
      }
    });
  }

  async listPaginated(limit: number = 10, offset: number = 0) {
    return prisma.simulationRun.findMany({
      take: limit,
      skip: offset,
      orderBy: { createdAt: 'desc' },
      include: { configVersion: true },
    });
  }

  async listEvents(runId: string) {
    return prisma.simulationRunEvent.findMany({
      where: { runId },
      orderBy: { eventSequence: 'asc' },
    });
  }
}

export const simulationRunQueryRepository = new SimulationRunQueryRepository();
