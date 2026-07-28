import { IMarketInstrumentQueryRepository, MarketInstrumentRecord } from '../../ports/market-data/IMarketInstrumentQueryRepository';
import { MarketInstrumentCursor } from './MarketInstrumentCursor';
import { MarketExchange, SecurityType } from '../../../domain/contracts/MarketDataContracts';

export interface ListMarketInstrumentsInput {
  exchange?: MarketExchange;
  canonicalSymbol?: string;
  securityType?: SecurityType;
  activeOn?: string;
  limit?: number;
  cursor?: string;
}

export interface ListMarketInstrumentsResult {
  items: MarketInstrumentRecord[];
  nextCursor: string | null;
}

export class ListMarketInstrumentsService {
  constructor(private readonly queryRepository: IMarketInstrumentQueryRepository) {}

  async execute(input: ListMarketInstrumentsInput): Promise<ListMarketInstrumentsResult> {
    const limit = input.limit !== undefined ? Math.max(1, Math.min(100, input.limit)) : 50;

    let cursorPayload = undefined;
    if (input.cursor) {
      cursorPayload = MarketInstrumentCursor.decode(input.cursor);
    }

    // Request limit + 1 to check for next page
    const query = {
      exchange: input.exchange,
      canonicalSymbol: input.canonicalSymbol,
      securityType: input.securityType,
      activeOn: input.activeOn,
      limit: limit + 1,
      cursor: cursorPayload,
    };

    const records = await this.queryRepository.list(query);

    let nextCursor: string | null = null;
    if (records.length > limit) {
      records.pop(); // Remove the limit + 1 item
      const lastItem = records[records.length - 1]; // The last item kept is the cursor
      nextCursor = MarketInstrumentCursor.encode({
        version: 1,
        exchange: lastItem.exchange,
        canonicalSymbol: lastItem.canonicalSymbol,
        securityType: lastItem.securityType,
        effectiveFrom: lastItem.effectiveFrom,
        id: lastItem.id,
      });
    }

    return {
      items: records,
      nextCursor,
    };
  }
}
