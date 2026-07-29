import { MarketExchange } from '../../../../domain/contracts/MarketDataContracts';

export interface ListCalendarDaysCursor {
  version: 1;
  exchange: MarketExchange;
  marketDate: string; // YYYY-MM-DD
  id: string; // UUID
}

export class CalendarCursor {
  static encode(cursor: ListCalendarDaysCursor): string {
    return Buffer.from(JSON.stringify(cursor), 'utf-8').toString('base64url');
  }

  static decode(encoded: string): ListCalendarDaysCursor {
    try {
      const json = Buffer.from(encoded, 'base64url').toString('utf-8');
      const decoded = JSON.parse(json);
      if (
        decoded.version !== 1 ||
        !decoded.exchange ||
        !decoded.marketDate ||
        !decoded.id
      ) {
        throw new Error('Invalid cursor format');
      }
      return decoded as ListCalendarDaysCursor;
    } catch {
      throw new Error('Invalid cursor format');
    }
  }
}
