import { IMarketDataSourceRepository } from '../../../ports/market-data/MarketDataSourcePorts';
import { MarketDataSourceVersion } from '../../../../domain/market-data/MarketDataSourceVersion';
import { SourceVersionCursor } from './SourceVersionCursor';

export interface ListMarketDataSourceVersionsRequest {
  limit: number;
  cursor?: string;
}

export interface ListMarketDataSourceVersionsResponse {
  items: MarketDataSourceVersion[];
  nextCursor: string | null;
}

export class ListMarketDataSourceVersionsService {
  constructor(
    private readonly repository: IMarketDataSourceRepository,
    private readonly family: string
  ) {}

  async execute(request: ListMarketDataSourceVersionsRequest): Promise<ListMarketDataSourceVersionsResponse> {
    const parsedCursor = request.cursor ? SourceVersionCursor.decode(request.cursor) : undefined;
    const limitPlusOne = request.limit + 1;

    const rows = await this.repository.transaction(this.family, async (ctx) => {
      return await this.repository.listVersions(ctx, limitPlusOne, parsedCursor);
    });

    const hasNextPage = rows.length > request.limit;
    const items = hasNextPage ? rows.slice(0, request.limit) : rows;

    let nextCursor: string | null = null;
    if (hasNextPage) {
      const lastItem = items[items.length - 1];
      nextCursor = SourceVersionCursor.encode(lastItem.createdAt, lastItem.sourceVersion.id);
    }

    return {
      items: items.map(r => r.sourceVersion),
      nextCursor
    };
  }
}
