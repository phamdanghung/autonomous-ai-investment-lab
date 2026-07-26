import { PrismaClient } from '@prisma/client';
import { EventChainVerifier } from '../../domain/hashing/EventChainVerifier';

const prisma = new PrismaClient();

export class VerifyRunEventChainService {
  static async execute(runId: string) {
    const run = await prisma.simulationRun.findUnique({
      where: { id: runId }
    });
    if (!run) throw new Error('Run not found');

    const events = await prisma.simulationRunEvent.findMany({
      where: { runId },
      orderBy: { eventSequence: 'asc' }
    });

    const RunChainAnchorCalculator = (await import('../../domain/hashing/calculators/RunChainAnchorCalculator')).RunChainAnchorCalculator;
    const anchor = RunChainAnchorCalculator.calculate(run.creationRequestHash, run.creationIdempotencyKey);
    return EventChainVerifier.verify(events as any, anchor);
  }
}
