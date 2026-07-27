import { describe, it, expect } from 'vitest';
import * as Errors from '../../../src/domain/market-data/MarketDataErrors';

describe('MarketDataErrors', () => {
  it('should have exactly 16 error codes in the inventory', () => {
    const expectedCodes = [
      'MARKET_INSTRUMENT_INVALID',
      'MARKET_INSTRUMENT_OVERLAP',
      'MARKET_INSTRUMENT_ALREADY_CLOSED',
      'MARKET_INSTRUMENT_NOT_FOUND',
      'MARKET_SOURCE_VERSION_INVALID',
      'MARKET_SOURCE_VERSION_CONFLICT',
      'MARKET_SOURCE_VERSION_NOT_FOUND',
      'TRADING_CALENDAR_CONFLICT',
      'TRADING_CALENDAR_NOT_FOUND',
      'MARKET_IMPORT_INVALID',
      'MARKET_IMPORT_IDEMPOTENCY_CONFLICT',
      'MARKET_IMPORT_BUSINESS_KEY_CONFLICT',
      'MARKET_IMPORT_INVALID_TRANSITION',
      'MARKET_IMPORT_NOT_FOUND',
      'MARKET_DATA_CONCURRENCY_CONFLICT',
      'MARKET_DATA_INTEGRITY_ERROR'
    ].sort();

    // Collect all exported classes from Errors that extend DomainError
    // But we can just instantiate them or check their prototype since they're just classes.
    // Instead of instantiating all, let's just grab their names and map to instances.
    const actualCodes: string[] = [];

    for (const key of Object.keys(Errors)) {
      if (key !== 'MarketDataDomainError') {
        const ErrorClass = (Errors as any)[key];
        const err = new ErrorClass();
        actualCodes.push(err.code);

        // Assert no HTTP status, Prisma or SQL strings in message
        expect(err.message.toLowerCase()).not.toContain('prisma');
        expect(err.message.toLowerCase()).not.toContain('sql');
        expect((err as any).status).toBeUndefined(); // No HTTP status
      }
    }

    actualCodes.sort();
    expect(actualCodes).toEqual(expectedCodes);
    expect(actualCodes.length).toBe(16);
  });
});
