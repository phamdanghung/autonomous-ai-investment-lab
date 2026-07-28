import { MarketExchange, SecurityType } from '../../../domain/contracts/MarketDataContracts';

export interface MarketInstrumentRecord {
  readonly id: string;
  readonly businessKey: string;
  readonly exchange: MarketExchange;
  readonly canonicalSymbol: string;
  readonly securityType: SecurityType;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly sealedAt: string;
  readonly createdAt: string;
}

export interface MarketInstrumentListRepositoryQuery {
  exchange?: MarketExchange;
  canonicalSymbol?: string;
  securityType?: SecurityType;
  activeOn?: string;
  limit: number;
  cursor?: {
    exchange: MarketExchange;
    canonicalSymbol: string;
    securityType: SecurityType;
    effectiveFrom: string;
    id: string;
  };
}

export interface IMarketInstrumentQueryRepository {
  findById(id: string): Promise<MarketInstrumentRecord | null>;
  findByBusinessKey(businessKey: string): Promise<MarketInstrumentRecord | null>;
  list(query: MarketInstrumentListRepositoryQuery): Promise<MarketInstrumentRecord[]>;
}
