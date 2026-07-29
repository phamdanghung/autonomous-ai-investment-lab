import { IMarketDataSourceRepository } from '../../../ports/market-data/MarketDataSourcePorts';
import { MarketDataSourceVersion } from '../../../../domain/market-data/MarketDataSourceVersion';
import { MarketSourceVersionNotFoundError } from '../../../../domain/market-data/MarketDataErrors';

export interface GetMarketDataSourceVersionRequest {
  sourceKey: string;
}

export class GetMarketDataSourceVersionService {
  constructor(
    private readonly repository: IMarketDataSourceRepository,
    private readonly family: string
  ) {}

  async execute(request: GetMarketDataSourceVersionRequest): Promise<MarketDataSourceVersion> {
    return await this.repository.transaction(this.family, async (ctx) => {
      const record = await this.repository.findBySourceKey(ctx, request.sourceKey);
      if (!record) {
        throw new MarketSourceVersionNotFoundError();
      }
      return record;
    });
  }
}
