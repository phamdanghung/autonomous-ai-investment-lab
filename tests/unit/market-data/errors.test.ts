import { describe, it, expect } from 'vitest';
import * as Errors from '../../../src/domain/market-data/MarketDataErrors';

describe('MarketDataErrors', () => {
  it('should have exactly 16 error codes in the inventory with full metadata', () => {
    const expectedCodes = [
      'MARKET_INSTRUMENT_INVALID',
      'MARKET_INSTRUMENT_OVERLAP',
      'MARKET_INSTRUMENT_ALREADY_CLOSED',
      'MARKET_INSTRUMENT_NOT_FOUND',
      'MARKET_SOURCE_VERSION_INVALID',
      'MARKET_SOURCE_VERSION_CONFLICT',
      'MARKET_SOURCE_VERSION_NOT_FOUND',
      'TRADING_CALENDAR_INVALID',
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

    const actualCodes: string[] = [];
    const actualCategories = new Set<string>();

    for (const key of Object.keys(Errors)) {
      if (key !== 'MarketDataDomainError' && key !== 'MarketDataErrorCategory') {
        const ErrorClass = (Errors as any)[key];
        // Ensure it's a class we can instantiate
        if (typeof ErrorClass === 'function') {
           const err = new ErrorClass();
           actualCodes.push(err.code);

           // Assert no HTTP status, Prisma or SQL strings in message
           expect(err.message.toLowerCase()).not.toContain('prisma');
           expect(err.message.toLowerCase()).not.toContain('sql');
           expect((err as any).status).toBeUndefined(); // No HTTP status

           // Assert new metadata fields exist and are of expected types
           expect(typeof err.safeMessage).toBe('string');
           expect(err.safeMessage.length).toBeGreaterThan(0);
           expect(typeof err.category).toBe('string');
           expect(err.category.length).toBeGreaterThan(0);
           expect(typeof err.retryable).toBe('boolean');

           actualCategories.add(err.category);
        }
      }
    }

    actualCodes.sort();
    expect(actualCodes).toEqual(expectedCodes);
    expect(actualCodes.length).toBe(17);

    // Verify all categories belong to the expected type subset
    const expectedCategories = ['VALIDATION', 'CONFLICT', 'NOT_FOUND', 'BUSINESS_RULE', 'SYSTEM_INTEGRITY', 'CONCURRENCY'];
    for (const cat of Array.from(actualCategories)) {
      expect(expectedCategories).toContain(cat);
    }
  });

  it('MarketDataConcurrencyConflictError metadata contract', () => {
    const error = new Errors.MarketDataConcurrencyConflictError();
    expect(error.code).toBe('MARKET_DATA_CONCURRENCY_CONFLICT');
    expect(error.category).toBe('CONCURRENCY');
    expect(error.retryable).toBe(true);
    expect(error.message).toBe('Concurrent market-data operation conflict.');
    expect(error.safeMessage).toBe('Concurrent market-data operation conflict.');
    expect(error.safeMessage).toBe(error.message);
  });
});
