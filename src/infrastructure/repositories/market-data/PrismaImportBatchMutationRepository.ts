import { PrismaClient, Prisma } from '@prisma/client';
import { ImportBatchMutationRepository, ImportBatchConditionalMutationResult, TransitionImportBatchCommand } from '../../../application/ports/market-data/ImportBatchMutationPorts';
import { MarketDataImportBatch, ProgressDelta } from '../../../domain/market-data/MarketDataImportBatch';
import { ImportBatchPrismaMappers } from '../../mappers/ImportBatchPrismaMappers';
import { MarketDataDomainError, MarketDataConcurrencyConflictError, MarketDataIntegrityError } from '../../../domain/market-data/MarketDataErrors';

export class PrismaImportBatchMutationRepository implements ImportBatchMutationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private handleError(error: unknown): never {
    if (error instanceof MarketDataDomainError) {
      throw error;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2034') {
        throw new MarketDataConcurrencyConflictError();
      }
      throw new MarketDataIntegrityError('Database integrity error.');
    }
    if (
      error instanceof Prisma.PrismaClientUnknownRequestError ||
      error instanceof Prisma.PrismaClientRustPanicError ||
      error instanceof Prisma.PrismaClientInitializationError ||
      error instanceof Prisma.PrismaClientValidationError
    ) {
      throw new MarketDataIntegrityError('Database integrity error.');
    }
    throw error;
  }

  async findById(id: string): Promise<MarketDataImportBatch | null> {
    try {
      const row = await this.prisma.marketDataImportBatch.findUnique({
        where: { id }
      });
      return row ? ImportBatchPrismaMappers.toDomain(row) : null;
    } catch (error) {
      this.handleError(error);
    }
  }

  async applyProgressDeltaConditional(id: string, delta: ProgressDelta): Promise<ImportBatchConditionalMutationResult> {
    try {
      const result = await this.prisma.marketDataImportBatch.updateManyAndReturn({
        where: {
          id,
          status: 'PENDING'
        },
        data: {
          parsedRowCount: { increment: delta.parsedDelta },
          acceptedRowCount: { increment: delta.acceptedDelta },
          flaggedRowCount: { increment: delta.flaggedDelta },
          quarantinedRowCount: { increment: delta.quarantinedDelta }
        }
      });

      if (result.length === 0) {
        return { outcome: 'NO_MATCH' };
      }
      if (result.length > 1) {
        throw new MarketDataIntegrityError('Database integrity error.');
      }

      return {
        outcome: 'UPDATED',
        record: ImportBatchPrismaMappers.toDomain(result[0])
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  async transitionConditional(command: TransitionImportBatchCommand): Promise<ImportBatchConditionalMutationResult> {
    try {
      let dataUpdate: Prisma.MarketDataImportBatchUpdateInput;
      
      switch (command.targetStatus) {
        case 'PENDING':
          dataUpdate = {
            status: 'PENDING',
            completedAt: null,
            failedAt: null,
            failureCode: null
          };
          break;
        case 'COMPLETED':
          dataUpdate = {
            status: 'COMPLETED',
            completedAt: command.completedAt,
            failedAt: null,
            failureCode: null
          };
          break;
        case 'COMPLETED_WITH_QUARANTINE':
          dataUpdate = {
            status: 'COMPLETED_WITH_QUARANTINE',
            completedAt: command.completedAt,
            failedAt: null,
            failureCode: null
          };
          break;
        case 'FAILED':
          dataUpdate = {
            status: 'FAILED',
            completedAt: null,
            failedAt: command.failedAt,
            failureCode: command.failureCode
          };
          break;
      }

      const result = await this.prisma.marketDataImportBatch.updateManyAndReturn({
        where: {
          id: command.id,
          status: 'PENDING'
        },
        data: dataUpdate
      });

      if (result.length === 0) {
        return { outcome: 'NO_MATCH' };
      }
      if (result.length > 1) {
        throw new MarketDataIntegrityError('Database integrity error.');
      }

      return {
        outcome: 'UPDATED',
        record: ImportBatchPrismaMappers.toDomain(result[0])
      };
    } catch (error) {
      this.handleError(error);
    }
  }
}
