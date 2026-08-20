import { PrismaClient, Prisma } from '@prisma/client';
import { DailyMarketBar } from '../../../domain/market-data/DailyMarketBar';
import { MarketDataIntegrityError } from '../../../domain/market-data/MarketDataErrors';
import { 
  IDailyMarketBarQueryRepository, 
  IDailyMarketBarAppendRepository, 
  IDailyMarketBarImportBatchLookup,
  AppendDailyMarketBarCommand,
  DailyMarketBarUniqueCollisionError,
  DailyMarketBarImportBatchRef
} from '../../../application/ports/market-data/DailyMarketBarPorts';
import { DailyMarketBarPrismaMappers } from '../../mappers/DailyMarketBarPrismaMappers';
import { MarketDataPrismaMappers } from './MarketDataPrismaMappers';
import { MarketDataImportStatus } from '../../../domain/market-data/MarketDataImportBatch';

export class PrismaDailyMarketBarRepository implements 
  IDailyMarketBarQueryRepository, 
  IDailyMarketBarAppendRepository, 
  IDailyMarketBarImportBatchLookup 
{
  constructor(private readonly prisma: PrismaClient) {}

  async findByCanonicalHash(canonicalHash: string): Promise<DailyMarketBar | null> {
    try {
      const record = await this.prisma.dailyMarketBar.findUnique({
        where: { canonicalHash }
      });
      return record ? DailyMarketBarPrismaMappers.toDomain(record) : null;
    } catch (e: unknown) {
      this.handlePrismaError(e);
      throw e;
    }
  }

  async findBySourceInstrumentDateVersion(
    sourceVersionId: string,
    instrumentId: string,
    marketDate: string,
    correctionVersion: number
  ): Promise<DailyMarketBar | null> {
    try {
      const record = await this.prisma.dailyMarketBar.findUnique({
        where: {
          sourceVersionId_instrumentId_marketDate_correctionVersion: {
            sourceVersionId,
            instrumentId,
            marketDate: MarketDataPrismaMappers.mapYYYYMMDDToDate(marketDate),
            correctionVersion
          }
        }
      });
      return record ? DailyMarketBarPrismaMappers.toDomain(record) : null;
    } catch (e: unknown) {
      this.handlePrismaError(e);
      throw e;
    }
  }

  async findBySourceRecordVersion(
    sourceVersionId: string,
    sourceRecordKey: string,
    correctionVersion: number
  ): Promise<DailyMarketBar | null> {
    try {
      const record = await this.prisma.dailyMarketBar.findUnique({
        where: {
          sourceVersionId_sourceRecordKey_correctionVersion: {
            sourceVersionId,
            sourceRecordKey,
            correctionVersion
          }
        }
      });
      return record ? DailyMarketBarPrismaMappers.toDomain(record) : null;
    } catch (e: unknown) {
      this.handlePrismaError(e);
      throw e;
    }
  }

  async findBySupersedesBarId(supersedesBarId: string): Promise<DailyMarketBar | null> {
    try {
      const record = await this.prisma.dailyMarketBar.findUnique({
        where: { supersedesBarId }
      });
      return record ? DailyMarketBarPrismaMappers.toDomain(record) : null;
    } catch (e: unknown) {
      this.handlePrismaError(e);
      throw e;
    }
  }

  async findById(id: string): Promise<DailyMarketBarImportBatchRef | null> {
    try {
      const record = await this.prisma.marketDataImportBatch.findUnique({
        where: { id },
        select: {
          id: true,
          sourceVersionId: true,
          status: true
        }
      });
      if (!record) return null;

      let status: MarketDataImportStatus;
      if (record.status === 'PENDING') status = 'PENDING';
      else if (record.status === 'COMPLETED') status = 'COMPLETED';
      else if (record.status === 'COMPLETED_WITH_QUARANTINE') status = 'COMPLETED_WITH_QUARANTINE';
      else if (record.status === 'FAILED') status = 'FAILED';
      else throw new MarketDataIntegrityError('Unknown persisted MarketDataImportBatch status.');

      return {
        id: record.id,
        sourceVersionId: record.sourceVersionId,
        status
      };
    } catch (e: unknown) {
      this.handlePrismaError(e);
      throw e;
    }
  }

  async insert(command: AppendDailyMarketBarCommand): Promise<DailyMarketBar> {
    try {
      const data = DailyMarketBarPrismaMappers.toPrismaCreate(command);
      const record = await this.prisma.dailyMarketBar.create({
        data
      });
      return DailyMarketBarPrismaMappers.toDomain(record);
    } catch (e: unknown) {
      this.handlePrismaError(e);
      throw e;
    }
  }

  private handlePrismaError(e: unknown): void {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2002') {
        throw new DailyMarketBarUniqueCollisionError();
      }
      if (e.code === 'P2003') {
        throw new MarketDataIntegrityError('Daily market bar references missing persistence identity.');
      }
      if (e.code.startsWith('P2')) {
        throw new MarketDataIntegrityError('Database integrity error.');
      }
    }
  }
}
