import { IMarketInstrumentQueryRepository, MarketInstrumentRecord } from '../../ports/market-data/IMarketInstrumentQueryRepository';
import { MarketInstrumentNotFoundError, MarketInstrumentInvalidError } from '../../../domain/market-data/MarketDataErrors';

export interface GetMarketInstrumentInput {
  id?: string;
  businessKey?: string;
}

export class GetMarketInstrumentService {
  constructor(private readonly queryRepository: IMarketInstrumentQueryRepository) {}

  async execute(input: GetMarketInstrumentInput): Promise<MarketInstrumentRecord> {
    if (input.id && input.businessKey) {
      throw new MarketInstrumentInvalidError('Cannot provide both id and businessKey');
    }

    let record: MarketInstrumentRecord | null = null;

    if (input.id) {
      record = await this.queryRepository.findById(input.id);
    } else if (input.businessKey) {
      record = await this.queryRepository.findByBusinessKey(input.businessKey);
    } else {
      throw new MarketInstrumentInvalidError('Must provide either id or businessKey');
    }

    if (!record) {
      throw new MarketInstrumentNotFoundError('Listing not found');
    }

    return record;
  }
}
