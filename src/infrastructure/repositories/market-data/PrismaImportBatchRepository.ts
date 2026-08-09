import { PrismaClient, Prisma } from '@prisma/client';
import { ImportBatchRepository, RegisterImportBatchCommand } from '../../../application/ports/market-data/ImportBatchPorts';
import { MarketDataImportBatch, MarketDataImportBatchDomain } from '../../../domain/market-data/MarketDataImportBatch';
import { ImportBatchPrismaMappers } from '../../mappers/ImportBatchPrismaMappers';
import {
  MarketDataDomainError,
  MarketImportIdempotencyConflictError,
  MarketImportBusinessKeyConflictError,
  MarketDataIntegrityError,
  MarketDataConcurrencyConflictError
} from '../../../domain/market-data/MarketDataErrors';

export class PrismaImportBatchRepository implements ImportBatchRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private handleError(error: unknown): never {
    if (error instanceof MarketDataDomainError) {
      throw error;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2034') {
        throw new MarketDataConcurrencyConflictError();
      }
      if (error.code.startsWith('P2')) {
        throw new MarketDataIntegrityError(`Database integrity error.`);
      }
    }
    throw error;
  }

  async findByCreationIdempotencyKey(key: string): Promise<MarketDataImportBatch | null> {
    try {
      const row = await this.prisma.marketDataImportBatch.findUnique({
        where: { creationIdempotencyKey: key }
      });
      return row ? ImportBatchPrismaMappers.toDomain(row) : null;
    } catch (error) {
      this.handleError(error);
    }
  }

  async findByBatchBusinessKey(key: string): Promise<MarketDataImportBatch | null> {
    try {
      const row = await this.prisma.marketDataImportBatch.findUnique({
        where: { batchBusinessKey: key }
      });
      return row ? ImportBatchPrismaMappers.toDomain(row) : null;
    } catch (error) {
      this.handleError(error);
    }
  }

  async create(command: RegisterImportBatchCommand): Promise<MarketDataImportBatch> {
    try {
      const row = await this.prisma.marketDataImportBatch.create({
        data: ImportBatchPrismaMappers.toPrismaCreate(command)
      });
      return ImportBatchPrismaMappers.toDomain(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.recoverP2002(command);
      }
      this.handleError(error);
    }
  }

  private async recoverP2002(command: RegisterImportBatchCommand): Promise<MarketDataImportBatch> {
    // 1. Re-read creationIdempotencyKey
    const byIdemp = await this.findByCreationIdempotencyKey(command.creationIdempotencyKey);
    if (byIdemp) {
      const decision = MarketDataImportBatchDomain.evaluateIdempotency(
        command.creationIdempotencyKey,
        command.creationRequestHash,
        command.batchBusinessKey,
        {
          creationIdempotencyKey: byIdemp.creationIdempotencyKey,
          creationRequestHash: byIdemp.creationRequestHash,
          batchBusinessKey: byIdemp.batchBusinessKey
        }
      );
      if (decision === 'REPLAY_BY_IDEMPOTENCY_KEY') {
        return byIdemp;
      }
      if (decision === 'IDEMPOTENCY_CONFLICT') {
        throw new MarketImportIdempotencyConflictError();
      }
      // Should not reach here based on evaluateIdempotency logic for exact match
      throw new MarketDataIntegrityError('Unexpected idempotency evaluation outcome.');
    }

    // 2. Re-read batchBusinessKey
    const byBiz = await this.findByBatchBusinessKey(command.batchBusinessKey);
    if (byBiz) {
      const decision = MarketDataImportBatchDomain.evaluateIdempotency(
        command.creationIdempotencyKey,
        command.creationRequestHash,
        command.batchBusinessKey,
        {
          creationIdempotencyKey: byBiz.creationIdempotencyKey,
          creationRequestHash: byBiz.creationRequestHash,
          batchBusinessKey: byBiz.batchBusinessKey
        }
      );
      if (decision === 'REPLAY_BY_BUSINESS_KEY') {
        return byBiz;
      }
      if (decision === 'BUSINESS_KEY_CONFLICT') {
        throw new MarketImportBusinessKeyConflictError();
      }
      // Should not reach here
      throw new MarketDataIntegrityError('Unexpected business key evaluation outcome.');
    }

    // 3. Unexplained P2002
    throw new MarketDataIntegrityError('Database integrity error.');
  }
}
