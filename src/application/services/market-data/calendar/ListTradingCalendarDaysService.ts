import { MarketExchange } from '../../../../domain/contracts/MarketDataContracts';
import { TradingCalendarDay } from '../../../../domain/market-data/TradingCalendarDay';
import { TradingCalendarRepository } from '../../../ports/market-data/TradingCalendarPorts';
import { CalendarCursor, ListCalendarDaysCursor } from './CalendarCursor';

export interface ListTradingCalendarDaysRequest {
  exchange: MarketExchange;
  limit: number;
  cursor?: string;
}

export interface ListTradingCalendarDaysResponse {
  records: TradingCalendarDay[];
  nextCursor?: string;
}

export class ListTradingCalendarDaysService {
  constructor(private readonly repository: TradingCalendarRepository) {}

  async execute(request: ListTradingCalendarDaysRequest): Promise<ListTradingCalendarDaysResponse> {
    const { exchange, limit, cursor } = request;

    let parsedCursor: ListCalendarDaysCursor | undefined;
    if (cursor) {
      parsedCursor = CalendarCursor.decode(cursor);
      if (parsedCursor.exchange !== exchange) {
        throw new Error('Cursor exchange mismatch');
      }
    }

    const fetchLimit = limit + 1;
    const records = await this.repository.listCalendarDays(
      exchange,
      fetchLimit,
      parsedCursor ? { marketDate: parsedCursor.marketDate, id: parsedCursor.id } : undefined
    );

    let nextCursor: string | undefined;
    if (records.length > limit) {
      const nextRecord = records[limit - 1]; // The last record of the requested page
      nextCursor = CalendarCursor.encode({
        version: 1,
        exchange,
        marketDate: nextRecord.marketDate,
        id: nextRecord.id,
      });
      records.pop(); // Remove the extra record
    }

    return {
      records,
      nextCursor,
    };
  }
}
