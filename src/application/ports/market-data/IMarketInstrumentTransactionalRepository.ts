import { MarketExchange, SecurityType } from '../../../domain/contracts/MarketDataContracts';
import { MarketInstrumentRecord } from './IMarketInstrumentQueryRepository';
import { IMarketInstrumentTransactionContext } from './IMarketInstrumentTransactionPort';

export interface MarketInstrumentIdentity {
  readonly exchange: MarketExchange;
  readonly canonicalSymbol: string;
  readonly securityType: SecurityType;
}

export interface CreateMarketInstrumentRecord {
  readonly businessKey: string;
  readonly exchange: MarketExchange;
  readonly canonicalSymbol: string;
  readonly securityType: SecurityType;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

export interface IMarketInstrumentTransactionalRepository {
  acquireIdentityLock(
    context: IMarketInstrumentTransactionContext,
    lockKey: bigint
  ): Promise<void>;

  findById(
    context: IMarketInstrumentTransactionContext,
    id: string
  ): Promise<MarketInstrumentRecord | null>;

  findByBusinessKey(
    context: IMarketInstrumentTransactionContext,
    businessKey: string
  ): Promise<MarketInstrumentRecord | null>;

  listEpisodesForIdentity(
    context: IMarketInstrumentTransactionContext,
    identity: MarketInstrumentIdentity
  ): Promise<MarketInstrumentRecord[]>;

  insertListing(
    context: IMarketInstrumentTransactionContext,
    data: CreateMarketInstrumentRecord
  ): Promise<{ outcome: 'CREATED' | 'REPLAYED'; record: MarketInstrumentRecord }>;

  closeOpenListing(
    context: IMarketInstrumentTransactionContext,
    input: {
      id: string;
      effectiveTo: string;
    }
  ): Promise<MarketInstrumentRecord | null>;
}
