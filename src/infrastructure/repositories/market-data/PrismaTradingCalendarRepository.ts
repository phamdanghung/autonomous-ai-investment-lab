import { PrismaClient, Prisma } from '@prisma/client';
import {
  TradingCalendarRepository,
  TradingCalendarTransactionContext,
  CalendarUniqueCollisionError,
  CalendarSourceFkViolationError
} from '../../../application/ports/market-data/TradingCalendarPorts';
import {
  MarketDataDomainError,
  MarketDataConcurrencyConflictError,
  MarketDataIntegrityError
} from '../../../domain/market-data/MarketDataErrors';
import { createTradingCalendarContext, validateCalendarContext, deactivateCalendarContext } from './PrismaTradingCalendarContext';
import { TradingCalendarPrismaMappers } from '../../mappers/TradingCalendarPrismaMappers';
import { MarketExchange, MarketDayType } from '../../../domain/contracts/MarketDataContracts';
import { TradingCalendarDay } from '../../../domain/market-data/TradingCalendarDay';

export class PrismaTradingCalendarRepository implements TradingCalendarRepository {
  private readonly ownerToken = Symbol('CALENDAR_OWNER_TOKEN');

  constructor(private readonly client: PrismaClient) {}

  async runTransaction<T>(work: (ctx: TradingCalendarTransactionContext) => Promise<T>): Promise<T> {
    try {
      return await this.client.$transaction(async (tx) => {
        const ctx = createTradingCalendarContext(tx, this.ownerToken);
        try {
          const result = await work(ctx);
          return result;
        } catch (error) {
          throw error;
        } finally {
          deactivateCalendarContext(ctx);
        }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  private getTx(ctx: TradingCalendarTransactionContext): Prisma.TransactionClient {
    return validateCalendarContext(ctx, this.ownerToken);
  }

  private handlePrismaError(error: any): never {
    if (error instanceof MarketDataDomainError) {
      throw error;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2034') throw new MarketDataConcurrencyConflictError();
      if (error.code === 'P2002') throw new CalendarUniqueCollisionError();
      if (error.code === 'P2003') throw new CalendarSourceFkViolationError();
      if (error.code.startsWith('P2')) throw new MarketDataIntegrityError(`Database integrity error.`);
    }
    throw error;
  }

  async findSourceVersionIdByKey(ctx: TradingCalendarTransactionContext, sourceVersionKey: string): Promise<string | null> {
    const tx = this.getTx(ctx);
    const result = await tx.marketDataSourceVersion.findUnique({
      where: { sourceKey: sourceVersionKey },
      select: { id: true }
    });
    return result?.id || null;
  }

  async findCalendarDayByIdentity(
    ctx: TradingCalendarTransactionContext,
    sourceVersionId: string,
    exchange: MarketExchange,
    marketDate: string
  ): Promise<TradingCalendarDay | null> {
    const tx = this.getTx(ctx);
    const result = await tx.tradingCalendarDay.findUnique({
      where: {
        sourceVersionId_exchange_marketDate: {
          sourceVersionId,
          exchange,
          marketDate: TradingCalendarPrismaMappers.mapDateToPrisma(marketDate)
        }
      }
    });
    return result ? TradingCalendarPrismaMappers.mapToDomain(result) : null;
  }

  async findCalendarDayByCanonicalHash(ctx: TradingCalendarTransactionContext, canonicalHash: string): Promise<TradingCalendarDay | null> {
    const tx = this.getTx(ctx);
    const result = await tx.tradingCalendarDay.findUnique({
      where: { canonicalHash }
    });
    return result ? TradingCalendarPrismaMappers.mapToDomain(result) : null;
  }

  async insertCalendarDay(ctx: TradingCalendarTransactionContext, record: Omit<TradingCalendarDay, 'id'>): Promise<TradingCalendarDay> {
    const tx = this.getTx(ctx);
    try {
      const result = await tx.tradingCalendarDay.create({
        data: {
          sourceVersionId: record.sourceVersionId,
          exchange: record.exchange,
          marketDate: TradingCalendarPrismaMappers.mapDateToPrisma(record.marketDate),
          dayType: record.dayType,
          reason: record.reason,
          canonicalHash: record.canonicalHash,
        }
      });
      return TradingCalendarPrismaMappers.mapToDomain(result);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async listCalendarDays(
    exchange: MarketExchange,
    limit: number,
    cursor?: { marketDate: string; id: string }
  ): Promise<TradingCalendarDay[]> {
    const where: any = { exchange };
    if (cursor) {
      const cursorDate = TradingCalendarPrismaMappers.mapDateToPrisma(cursor.marketDate);
      where.OR = [
        { marketDate: { gt: cursorDate } },
        { marketDate: cursorDate, id: { gt: cursor.id } }
      ];
    }

    try {
      const records = await this.client.tradingCalendarDay.findMany({
        where,
        orderBy: [
          { marketDate: 'asc' },
          { id: 'asc' }
        ],
        take: limit
      });
      return records.map(record => TradingCalendarPrismaMappers.mapToDomain(record));
    } catch (error) {
      this.handlePrismaError(error);
    }
  }
}
