import { MarketDataSourceVersion } from '../../../domain/market-data/MarketDataSourceVersion';

export interface IMarketDataSourceContext {
  readonly _family: string;
}

export interface MarketDataSourceVersionRow {
  sourceVersion: MarketDataSourceVersion;
  createdAt: string; // ISO string
}

export interface IMarketDataSourceRepository {
  transaction<T>(
    family: string,
    operation: (ctx: IMarketDataSourceContext) => Promise<T>
  ): Promise<T>;

  findByContractHash(
    ctx: IMarketDataSourceContext,
    contractHash: string
  ): Promise<MarketDataSourceVersion | null>;

  findBySourceKey(
    ctx: IMarketDataSourceContext,
    sourceKey: string
  ): Promise<MarketDataSourceVersion | null>;

  insert(
    ctx: IMarketDataSourceContext,
    version: MarketDataSourceVersion
  ): Promise<MarketDataSourceVersionRow>;

  listVersions(
    ctx: IMarketDataSourceContext,
    limitPlusOne: number,
    cursor?: { createdAt: Date; id: string }
  ): Promise<MarketDataSourceVersionRow[]>;
}
