import { PrismaClient, Prisma } from '@prisma/client';
import { IMarketDataSourceContext, IMarketDataSourceRepository, MarketDataSourceVersionRow, SourceVersionUniqueCollisionError } from '../../../application/ports/market-data/MarketDataSourcePorts';
import { createMarketDataSourceContext, validateAndGetTx, deactivateContext } from './PrismaMarketDataSourceContext';
import { MarketDataSourcePrismaMappers } from '../../mappers/MarketDataSourcePrismaMappers';
import { MarketDataSourceVersion } from '../../../domain/market-data/MarketDataSourceVersion';
import { MarketDataDomainError, MarketDataConcurrencyConflictError, MarketDataIntegrityError } from '../../../domain/market-data/MarketDataErrors';

export class PrismaMarketDataSourceRepository implements IMarketDataSourceRepository {
  private readonly ownerToken = Symbol('SourceVersionContextOwner');

  constructor(private readonly prisma: PrismaClient, private readonly family: string) {}

  private validateContext(ctx: IMarketDataSourceContext): Prisma.TransactionClient {
    return validateAndGetTx(ctx, this.ownerToken);
  }

  private handleError(error: unknown): never {
    if (error instanceof MarketDataDomainError) {
      throw error;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2034') {
        throw new MarketDataConcurrencyConflictError();
      }
      if (error.code === 'P2002') {
        throw new SourceVersionUniqueCollisionError();
      }
      if (error.code.startsWith('P2')) {
        throw new MarketDataIntegrityError(`Database integrity error.`);
      }
    }
    throw error;
  }

  async transaction<T>(family: string, operation: (ctx: IMarketDataSourceContext) => Promise<T>): Promise<T> {
    if (family !== this.family) {
      throw new Error('Family mismatch.');
    }
    return this.prisma.$transaction(async (tx) => {
      const ctx = createMarketDataSourceContext(tx, this.ownerToken);
      try {
        const result = await operation(ctx);
        return result;
      } catch (error) {
        throw error;
      } finally {
        deactivateContext(ctx);
      }
    });
  }

  async findByContractHash(ctx: IMarketDataSourceContext, contractHash: string): Promise<MarketDataSourceVersion | null> {
    try {
      const tx = this.validateContext(ctx);
      const row = await tx.marketDataSourceVersion.findUnique({
        where: { contractHash }
      });
      return row ? MarketDataSourcePrismaMappers.toDomain(row) : null;
    } catch (error) {
      this.handleError(error);
    }
  }

  async findBySourceKey(ctx: IMarketDataSourceContext, sourceKey: string): Promise<MarketDataSourceVersion | null> {
    try {
      const tx = this.validateContext(ctx);
      const row = await tx.marketDataSourceVersion.findUnique({
        where: { sourceKey }
      });
      return row ? MarketDataSourcePrismaMappers.toDomain(row) : null;
    } catch (error) {
      this.handleError(error);
    }
  }

  async insert(ctx: IMarketDataSourceContext, version: MarketDataSourceVersion): Promise<MarketDataSourceVersionRow> {
    try {
      const tx = this.validateContext(ctx);
      const row = await tx.marketDataSourceVersion.create({
        data: MarketDataSourcePrismaMappers.toPrismaInsert(version)
      });
      return MarketDataSourcePrismaMappers.toPortRow(row);
    } catch (error) {
      this.handleError(error);
    }
  }

  async listVersions(
    ctx: IMarketDataSourceContext,
    limitPlusOne: number,
    cursor?: { createdAt: Date; id: string }
  ): Promise<MarketDataSourceVersionRow[]> {
    try {
      const tx = this.validateContext(ctx);
      const rows = await tx.marketDataSourceVersion.findMany({
        take: limitPlusOne,
        where: cursor ? {
          OR: [
            { createdAt: { gt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { gt: cursor.id } }
          ]
        } : undefined,
        orderBy: [
          { createdAt: 'asc' },
          { id: 'asc' }
        ]
      });
      return rows.map(r => MarketDataSourcePrismaMappers.toPortRow(r));
    } catch (error) {
      this.handleError(error);
    }
  }
}

