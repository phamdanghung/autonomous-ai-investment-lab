import { describe, it, expect } from 'vitest';
import { CalendarCursor } from '../../../../src/application/services/market-data/calendar/CalendarCursor';
import { MarketExchange } from '../../../../src/domain/contracts/MarketDataContracts';

describe('CalendarCursor', () => {
  it('should encode and decode cursor correctly', () => {
    const cursor = {
      version: 1 as const,
      exchange: "HOSE" as any,
      marketDate: '2023-01-01',
      id: 'uuid-123'
    };

    const encoded = CalendarCursor.encode(cursor);
    const decoded = CalendarCursor.decode(encoded);

    expect(decoded).toEqual(cursor);
  });
});
