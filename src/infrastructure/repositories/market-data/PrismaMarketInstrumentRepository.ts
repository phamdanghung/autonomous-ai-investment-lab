import { PrismaClient, Prisma } from '@prisma/client';
import { IMarketInstrumentTransactionPort, IMarketInstrumentTransactionContext, MARKET_INSTRUMENT_TX_CONTEXT } from '../../../application/ports/market-data/IMarketInstrumentTransactionPort';
import { IMarketInstrumentQueryRepository, MarketInstrumentRecord, MarketInstrumentListRepositoryQuery } from '../../../application/ports/market-data/IMarketInstrumentQueryRepository';
import { IMarketInstrumentTransactionalRepository, CreateMarketInstrumentRecord, MarketInstrumentIdentity } from '../../../application/ports/market-data/IMarketInstrumentTransactionalRepository';
import { MarketDataIntegrityError, MarketDataConcurrencyConflictError, MarketInstrumentOverlapError, MarketInstrumentNotFoundError, MarketInstrumentAlreadyClosedError } from '../../../domain/market-data/MarketDataErrors';
import { MarketDataPrismaMappers } from './MarketDataPrismaMappers';
import { MarketDataAdvisoryLocks } from './MarketDataAdvisoryLocks';
import { MarketExchange, SecurityType } from '../../../domain/contracts/MarketDataContracts';

type ContextState = {
  readonly ownerToken: symbol;
  readonly transactionClient: Prisma.TransactionClient;
  active: boolean;
};

const transactionContextState = new WeakMap<object, ContextState>();

export class PrismaTransactionContext implements IMarketInstrumentTransactionContext {
  readonly [MARKET_INSTRUMENT_TX_CONTEXT] = true as const;

  constructor(ownerToken: symbol, transactionClient: Prisma.TransactionClient) {
    transactionContextState.set(this, {
      ownerToken,
      transactionClient,
      active: true,
    });
  }

  deactivate() {
    const state = transactionContextState.get(this);
    if (state) state.active = false;
  }

  getClient(expectedToken: symbol): Prisma.TransactionClient {
    const state = transactionContextState.get(this);

    if (!state) {
      throw new MarketDataIntegrityError('Invalid transaction context provided to repository');
    }

    if (state.ownerToken !== expectedToken) {
      throw new MarketDataIntegrityError('Cross-adapter transaction context usage detected');
    }
    if (!state.active) {
      throw new MarketDataIntegrityError('Transaction context has expired and cannot be used');
    }
    return state.transactionClient;
  }
}

export class PrismaMarketDataTransactionRunner implements IMarketInstrumentTransactionPort {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly ownerToken: symbol
  ) {}

  async runInTransaction<T>(work: (context: IMarketInstrumentTransactionContext) => Promise<T>): Promise<T> {
    return await this.prisma.$transaction(async (tx) => {
      const ctx = new PrismaTransactionContext(this.ownerToken, tx);
      try {
        return await work(ctx);
      } catch (error: any) {
        if (error.code === 'P2034') {
          throw new MarketDataConcurrencyConflictError('Concurrent market-data operation conflict.');
        }
        throw error;
      } finally {
        ctx.deactivate();
      }
    }, { timeout: 20000, maxWait: 15000 });
  }
}

export class PrismaMarketInstrumentQueryRepository implements IMarketInstrumentQueryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<MarketInstrumentRecord | null> {
    const record = await this.prisma.marketInstrument.findUnique({
      where: { id }
    });
    return record ? MarketDataPrismaMappers.mapToApplicationRecord(record) : null;
  }

  async findByBusinessKey(businessKey: string): Promise<MarketInstrumentRecord | null> {
    const record = await this.prisma.marketInstrument.findUnique({
      where: { businessKey }
    });
    return record ? MarketDataPrismaMappers.mapToApplicationRecord(record) : null;
  }

  async list(query: MarketInstrumentListRepositoryQuery): Promise<MarketInstrumentRecord[]> {
    const whereClause: Prisma.MarketInstrumentWhereInput = {};

    if (query.exchange) whereClause.exchange = query.exchange;
    if (query.canonicalSymbol) whereClause.canonicalSymbol = query.canonicalSymbol;
    if (query.securityType) whereClause.securityType = query.securityType;

    if (query.activeOn) {
      const activeDate = new Date(query.activeOn);
      whereClause.effectiveFrom = { lte: activeDate };
      whereClause.OR = [
        { effectiveTo: null },
        { effectiveTo: { gte: activeDate } }
      ];
    }

    let cursorOptions: Prisma.MarketInstrumentWhereUniqueInput | undefined = undefined;
    let skip: number | undefined = undefined;

    if (query.cursor) {
      cursorOptions = { id: query.cursor.id };
      skip = 1;
    }

    const records = await this.prisma.marketInstrument.findMany({
      where: whereClause,
      take: query.limit,
      skip,
      cursor: cursorOptions,
      orderBy: [
        { exchange: 'asc' },
        { canonicalSymbol: 'asc' },
        { securityType: 'asc' },
        { effectiveFrom: 'asc' },
        { id: 'asc' },
      ],
    });

    return records.map(MarketDataPrismaMappers.mapToApplicationRecord);
  }
}

export class PrismaMarketInstrumentTransactionalRepository implements IMarketInstrumentTransactionalRepository {
  constructor(
    private readonly ownerToken: symbol
  ) {}

  private getClient(context: IMarketInstrumentTransactionContext): Prisma.TransactionClient {
    if (!(context instanceof PrismaTransactionContext)) {
      throw new MarketDataIntegrityError('Invalid transaction context provided to repository');
    }
    return context.getClient(this.ownerToken);
  }

  async acquireIdentityLock(context: IMarketInstrumentTransactionContext, lockKey: bigint): Promise<void> {
    const tx = this.getClient(context);
    await MarketDataAdvisoryLocks.acquireTransactionLock(tx, lockKey);
  }

  async findById(context: IMarketInstrumentTransactionContext, id: string): Promise<MarketInstrumentRecord | null> {
    const tx = this.getClient(context);
    const record = await tx.marketInstrument.findUnique({ where: { id } });
    return record ? MarketDataPrismaMappers.mapToApplicationRecord(record) : null;
  }

  async findByBusinessKey(context: IMarketInstrumentTransactionContext, businessKey: string): Promise<MarketInstrumentRecord | null> {
    const tx = this.getClient(context);
    const record = await tx.marketInstrument.findUnique({ where: { businessKey } });
    return record ? MarketDataPrismaMappers.mapToApplicationRecord(record) : null;
  }

  async listEpisodesForIdentity(
    context: IMarketInstrumentTransactionContext,
    identity: MarketInstrumentIdentity
  ): Promise<MarketInstrumentRecord[]> {
    const tx = this.getClient(context);
    const records = await tx.marketInstrument.findMany({
      where: {
        exchange: identity.exchange,
        canonicalSymbol: identity.canonicalSymbol,
        securityType: identity.securityType,
      },
      orderBy: [
        { effectiveFrom: 'asc' },
        { id: 'asc' }
      ]
    });
    return records.map(MarketDataPrismaMappers.mapToApplicationRecord);
  }

  async insertListing(
    context: IMarketInstrumentTransactionContext,
    data: CreateMarketInstrumentRecord
  ): Promise<{ outcome: 'CREATED' | 'REPLAYED'; record: MarketInstrumentRecord }> {
    const tx = this.getClient(context);
    try {
      const record = await tx.marketInstrument.create({
        data: {
          businessKey: data.businessKey,
          exchange: data.exchange,
          canonicalSymbol: data.canonicalSymbol,
          securityType: data.securityType,
          currency: 'VND', // Default per business rule in phase 1A/1B
          effectiveFrom: MarketDataPrismaMappers.mapYYYYMMDDToDate(data.effectiveFrom),
          effectiveTo: data.effectiveTo ? MarketDataPrismaMappers.mapYYYYMMDDToDate(data.effectiveTo) : null,
          sealedAt: MarketDataPrismaMappers.mapYYYYMMDDToDate(data.effectiveFrom), // Set sealedAt same as effectiveFrom per design
        }
      });
      return {
        outcome: 'CREATED',
        record: MarketDataPrismaMappers.mapToApplicationRecord(record)
      };
    } catch (error: any) {
      if (error.code === 'P2002') {
        const existing = await tx.marketInstrument.findUnique({
          where: { businessKey: data.businessKey }
        });

        if (!existing) {
          throw new MarketDataIntegrityError('Duplicate business key detected but record not found upon re-read');
        }

        const existingEffectiveTo = existing.effectiveTo ? existing.effectiveTo.toISOString().split('T')[0] : null;

        if (existingEffectiveTo === data.effectiveTo) {
          return {
            outcome: 'REPLAYED',
            record: MarketDataPrismaMappers.mapToApplicationRecord(existing)
          };
        } else {
          throw new MarketInstrumentOverlapError('Conflict: Business key exists but with different creation payload');
        }
      }

      if (error.code?.startsWith('P2')) {
        throw new MarketDataIntegrityError('Database integrity error during insert');
      }
      throw error;
    }
  }

  async closeOpenListing(
    context: IMarketInstrumentTransactionContext,
    input: { id: string; effectiveTo: string }
  ): Promise<MarketInstrumentRecord | null> {
    const tx = this.getClient(context);
    try {
      const result = await tx.$executeRaw`
        UPDATE "MarketInstrument"
        SET "effectiveTo" = ${MarketDataPrismaMappers.mapYYYYMMDDToDate(input.effectiveTo)}::date
        WHERE "id" = ${input.id}
          AND "effectiveTo" IS NULL
      `;

      if (result === 0) {
        // Zero-row classification
        const zeroRowCheck = await tx.marketInstrument.findUnique({
          where: { id: input.id }
        });

        if (!zeroRowCheck) {
          throw new MarketInstrumentNotFoundError(`Listing with id ${input.id} not found during close`);
        }

        if (zeroRowCheck.effectiveTo !== null) {
          throw new MarketInstrumentAlreadyClosedError(`Listing with id ${input.id} is already closed`);
        }

        // record exists and effectiveTo is null but update returned 0 (impossible locally but requested by rule)
        throw new MarketDataConcurrencyConflictError('Concurrent modification prevented closure');
      }

      const updated = await tx.marketInstrument.findUnique({
        where: { id: input.id }
      });

      if (!updated) {
         throw new MarketDataIntegrityError('Failed to fetch updated listing');
      }

      return MarketDataPrismaMappers.mapToApplicationRecord(updated);
    } catch (error: any) {
      throw new MarketDataIntegrityError(`Database error during closeOpenListing: ${error.message}`);
    }
  }
}

export function createPrismaMarketInstrumentAdapters(prisma: PrismaClient, customToken?: symbol) {
  const ownerToken = customToken ?? Symbol('PrismaMarketInstrumentAdapterFamily');
  return {
    transactionRunner: new PrismaMarketDataTransactionRunner(prisma, ownerToken),
    transactionalRepository: new PrismaMarketInstrumentTransactionalRepository(ownerToken),
    queryRepository: new PrismaMarketInstrumentQueryRepository(prisma),
  };
}
