import { Prisma, PrismaClient } from '@prisma/client';
import { ISimulationRunCommandRepository } from '../../application/ports/repositories/ISimulationRunCommandRepository';
import { RunMode } from '../../domain/types/RunMode';
import { RunStatus } from '../../domain/types/RunStatus';
import { RunVersionConflictError } from '../../domain/errors/DomainErrors';

const prisma = new PrismaClient();

export const simulationRunCommandRepository: ISimulationRunCommandRepository = {
  async findCreationByIdempotencyKey(key: string) {
    return prisma.simulationRun.findUnique({
      where: { creationIdempotencyKey: key },
    });
  },

  async findEventByIdempotencyKey(key: string) {
    return prisma.simulationRunEvent.findUnique({
      where: { idempotencyKey: key },
    });
  },

  async createRunWithInitialEvent(
    data: { creationIdempotencyKey: string; creationRequestHash: string; configVersionId: string; mode: RunMode },
    eventData: { idempotencyKey: string; requestHash: string; actorType: string; actorBusinessKey: string; eventType: string; payloadJson: string; eventHash: string; previousHash: string; fromStatus: RunStatus | null; toStatus: RunStatus; simulationDateBefore: string | null; simulationDateAfter: string | null; reason: string | null; }
  ) {
    try {
      return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const run = await tx.simulationRun.create({
          data: {
            ...data,
            version: 1,
            status: RunStatus.INITIALIZED,
            events: {
              create: {
                eventSequence: 1,
                eventType: eventData.eventType,
                actorType: eventData.actorType as any,
                actorBusinessKey: eventData.actorBusinessKey,
                idempotencyKey: eventData.idempotencyKey,
                requestHash: eventData.requestHash,
                payloadJson: eventData.payloadJson,
                eventHash: eventData.eventHash,
                previousHash: eventData.previousHash,
                fromStatus: eventData.fromStatus,
                toStatus: eventData.toStatus,
                reason: eventData.reason,
                simulationDateBefore: eventData.simulationDateBefore ? new Date(eventData.simulationDateBefore) : null,
                simulationDateAfter: eventData.simulationDateAfter ? new Date(eventData.simulationDateAfter) : null,
              }
            }
          },
          include: { events: true }
        });
        return { run, event: run.events[0] };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
      throw error;
    }
  },

  async bindDataOriginWithEvent(
    runId: string, version: number, expectedStatus: RunStatus,
    updateData: { dataOriginHash: string; canonicalStartDate: Date; simulationDate: Date; runBusinessKey: string },
    eventData: { idempotencyKey: string; requestHash: string; actorType: string; actorBusinessKey: string; eventType: string; payloadJson: string; eventHash: string; previousHash: string; fromStatus: RunStatus | null; toStatus: RunStatus; simulationDateBefore: string | null; simulationDateAfter: string | null; reason: string | null; }
  ) {
    try {
      return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const { count } = await tx.simulationRun.updateMany({
          where: { id: runId, version, status: expectedStatus },
          data: { ...updateData, status: RunStatus.CONFIGURED, version: version + 1 }
        });
        if (count === 0) throw new RunVersionConflictError();

        const run = await tx.simulationRun.findUniqueOrThrow({ where: { id: runId } });
        const event = await tx.simulationRunEvent.create({
          data: {
            runId,
            eventSequence: run.version,
            eventType: eventData.eventType,
            actorType: eventData.actorType as any,
            actorBusinessKey: eventData.actorBusinessKey,
            idempotencyKey: eventData.idempotencyKey,
            requestHash: eventData.requestHash,
            payloadJson: eventData.payloadJson,
            eventHash: eventData.eventHash,
            previousHash: eventData.previousHash,
            fromStatus: eventData.fromStatus,
            toStatus: eventData.toStatus,
            reason: eventData.reason,
            simulationDateBefore: eventData.simulationDateBefore ? new Date(eventData.simulationDateBefore) : null,
            simulationDateAfter: eventData.simulationDateAfter ? new Date(eventData.simulationDateAfter) : null,
          }
        });
        return { run, event };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = (error.meta || {}).target;
        let isIdempotencyKey = false;
        if (typeof target === 'string') {
          isIdempotencyKey = target.includes('idempotencyKey');
        } else if (Array.isArray(target)) {
          isIdempotencyKey = target.some((t: any) => typeof t === 'string' && t.includes('idempotencyKey'));
        }
        if (isIdempotencyKey) {
          throw new RunVersionConflictError();
        }
      }
      throw error;
    }
  },

  async transitionWithEvent(
    runId: string, version: number, expectedStatus: RunStatus, nextStatus: RunStatus, additionalUpdateData: any,
    eventData: { idempotencyKey: string; requestHash: string; actorType: string; actorBusinessKey: string; eventType: string; payloadJson: string; eventHash: string; previousHash: string; fromStatus: RunStatus | null; toStatus: RunStatus; simulationDateBefore: string | null; simulationDateAfter: string | null; reason: string | null; }
  ) {
    try {
      return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const { count } = await tx.simulationRun.updateMany({
          where: { id: runId, version, status: expectedStatus },
          data: { status: nextStatus, version: version + 1, ...additionalUpdateData }
        });
        if (count === 0) throw new RunVersionConflictError();

        const run = await tx.simulationRun.findUniqueOrThrow({ where: { id: runId } });
        const event = await tx.simulationRunEvent.create({
          data: {
            runId,
            eventSequence: run.version,
            eventType: eventData.eventType,
            actorType: eventData.actorType as any,
            actorBusinessKey: eventData.actorBusinessKey,
            idempotencyKey: eventData.idempotencyKey,
            requestHash: eventData.requestHash,
            payloadJson: eventData.payloadJson,
            eventHash: eventData.eventHash,
            previousHash: eventData.previousHash,
            fromStatus: eventData.fromStatus,
            toStatus: eventData.toStatus,
            reason: eventData.reason,
            simulationDateBefore: eventData.simulationDateBefore ? new Date(eventData.simulationDateBefore) : null,
            simulationDateAfter: eventData.simulationDateAfter ? new Date(eventData.simulationDateAfter) : null,
          }
        });
        return { run, event };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
      throw error;
    }
  }
};
