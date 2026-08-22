import { PrismaClient, Prisma } from '@prisma/client';
import {
  IDatasetSnapshotImportBatchQuery,
  IDatasetSnapshotDailyBarQuery,
  IDatasetSnapshotQueryRepository,
  IDatasetSnapshotWriteRepository,
  DatasetSnapshotImportBatchRef,
  DatasetSnapshotBarCandidate,
  DatasetSnapshotBarQuery,
  CreateSealedDatasetSnapshotCommand,
  CreateDatasetSnapshotEntryCommand,
  DatasetSnapshotUniqueCollisionError
} from '../../../application/ports/market-data/DatasetSnapshotPorts';
import { DatasetSnapshot } from '../../../domain/market-data/DatasetSnapshot';
import { MarketDataIntegrityError, MarketDataConcurrencyConflictError, MarketDataDomainError } from '../../../domain/market-data/MarketDataErrors';
import { DatasetSnapshotPrismaMappers } from '../../mappers/DatasetSnapshotPrismaMappers';
import { DailyMarketBarPrismaMappers } from '../../mappers/DailyMarketBarPrismaMappers';
import { MarketDataImportStatus } from '../../../domain/market-data/MarketDataImportBatch';
import { MarketDataPrismaMappers } from './MarketDataPrismaMappers';

export class PrismaDatasetSnapshotRepository implements
  IDatasetSnapshotImportBatchQuery,
  IDatasetSnapshotDailyBarQuery,
  IDatasetSnapshotQueryRepository,
  IDatasetSnapshotWriteRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async listCompletedThrough(sourceVersionId: string, cutoffAt: Date): Promise<DatasetSnapshotImportBatchRef[]> {
    try {
      const rows = await this.prisma.marketDataImportBatch.findMany({
        where: {
          sourceVersionId,
          status: {
            in: ['COMPLETED', 'COMPLETED_WITH_QUARANTINE']
          },
          completedAt: {
            lte: cutoffAt
          }
        },
        select: {
          id: true,
          sourceVersionId: true,
          batchBusinessKey: true,
          sourceContentHash: true,
          status: true,
          completedAt: true
        },
        orderBy: {
          batchBusinessKey: 'asc'
        }
      });

      return rows.map(row => {
        let status: MarketDataImportStatus;
        if (row.status === 'COMPLETED') {
          status = 'COMPLETED';
        } else if (row.status === 'COMPLETED_WITH_QUARANTINE') {
          status = 'COMPLETED_WITH_QUARANTINE';
        } else {
          throw new MarketDataIntegrityError('Unknown persisted MarketDataImportBatch status.');
        }

        return {
          id: row.id,
          sourceVersionId: row.sourceVersionId,
          batchBusinessKey: row.batchBusinessKey,
          sourceContentHash: row.sourceContentHash,
          status,
          completedAt: row.completedAt
        };
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async listCandidates(query: DatasetSnapshotBarQuery): Promise<DatasetSnapshotBarCandidate[]> {
    if (query.importBatchIds.length === 0) {
      return [];
    }

    try {
      const rows = await this.prisma.dailyMarketBar.findMany({
        where: {
          sourceVersionId: query.sourceVersionId,
          importBatchId: {
            in: query.importBatchIds
          },
          marketDate: {
            gte: MarketDataPrismaMappers.mapYYYYMMDDToDate(query.rangeStart),
            lte: MarketDataPrismaMappers.mapYYYYMMDDToDate(query.rangeEnd)
          }
        },
        include: {
          instrument: {
            select: {
              businessKey: true
            }
          }
        },
        orderBy: [
          { instrumentId: 'asc' },
          { marketDate: 'asc' },
          { correctionVersion: 'asc' }
        ]
      });

      return rows.map(row => ({
        bar: DailyMarketBarPrismaMappers.toDomain(row),
        instrumentBusinessKey: row.instrument.businessKey
      }));
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async findByCreationIdempotencyKey(key: string): Promise<DatasetSnapshot | null> {
    try {
      const row = await this.prisma.datasetSnapshot.findUnique({
        where: { creationIdempotencyKey: key }
      });
      if (!row) return null;
      return DatasetSnapshotPrismaMappers.toDomain(row);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async findByBusinessKey(businessKey: string): Promise<DatasetSnapshot | null> {
    try {
      const row = await this.prisma.datasetSnapshot.findUnique({
        where: { businessKey }
      });
      if (!row) return null;
      return DatasetSnapshotPrismaMappers.toDomain(row);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async createSealed(command: CreateSealedDatasetSnapshotCommand): Promise<DatasetSnapshot> {
    if (command.draft.rowCount !== command.entries.length) {
      throw new MarketDataIntegrityError('Dataset snapshot persistence command row count does not match entries.');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const draftInput = DatasetSnapshotPrismaMappers.toDraftCreateInput(command.draft);
        const snapshot = await tx.datasetSnapshot.create({
          data: draftInput
        });

        if (command.entries.length > 0) {
          const entryInputs = command.entries.map((e: CreateDatasetSnapshotEntryCommand) =>
            DatasetSnapshotPrismaMappers.toEntryCreateManyInput(snapshot.id, e)
          );
          await tx.datasetSnapshotEntry.createMany({
            data: entryInputs,
            skipDuplicates: false
          });
        }

        const sealedSnapshot = await tx.datasetSnapshot.update({
          where: { id: snapshot.id },
          data: {
            status: 'SEALED',
            sealedAt: command.sealedAt
          }
        });

        return DatasetSnapshotPrismaMappers.toDomain(sealedSnapshot);
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  private handlePrismaError(error: unknown): never {
    if (error instanceof MarketDataDomainError) {
      throw error;
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        const target = this.normalizeTarget(error.meta?.target);
        
        if (target.includes('businessKey') || target.includes('creationIdempotencyKey')) {
          throw new DatasetSnapshotUniqueCollisionError();
        }
        
        if (
          target.includes('snapshotId') ||
          target.includes('entrySequence') ||
          target.includes('dailyBarId') ||
          target.includes('instrumentBusinessKey') ||
          target.includes('marketDate') ||
          target.includes('entryHash')
        ) {
          throw new MarketDataIntegrityError('Dataset snapshot entry violates persistence uniqueness.');
        }

        throw new MarketDataIntegrityError('Database integrity error.');
      }

      if (error.code === 'P2003' || error.code === 'P2025') {
        throw new MarketDataIntegrityError('Dataset snapshot references missing persistence identity.');
      }

      if (error.code === 'P2034') {
        throw new MarketDataConcurrencyConflictError();
      }

      if (error.code.startsWith('P2')) {
        throw new MarketDataIntegrityError('Database integrity error.');
      }
    }

    if (error instanceof Prisma.PrismaClientUnknownRequestError) {
      throw new MarketDataIntegrityError('Database integrity error.');
    }

    if (error instanceof Error && error.name === 'DatasetSnapshotUniqueCollisionError') {
      throw error;
    }
    
    if (error instanceof Error && error.constructor.name === 'PrismaClientUnknownRequestError') {
      throw new MarketDataIntegrityError('Database integrity error.');
    }

    if (error instanceof Error) {
      // Unrelated error, rethrow same object
      throw error;
    }

    throw error;
  }

  private normalizeTarget(target: unknown): string[] {
    if (Array.isArray(target)) {
      return target.map(t => String(t));
    }
    if (typeof target === 'string') {
      return [target];
    }
    return [];
  }
}
