import { describe, it, expect } from 'vitest';
import { MarketDataValidation } from '../../../src/domain/market-data/MarketDataValidation';

describe('MarketDataValidation', () => {
  describe('normalizeSymbol', () => {
    it('should trim and uppercase', () => {
      expect(MarketDataValidation.normalizeSymbol(' abc123 ')).toBe('ABC123');
    });
    it('should reject dots', () => {
      expect(() => MarketDataValidation.normalizeSymbol('abc.def')).toThrow();
    });
    it('should reject hyphens', () => {
      expect(() => MarketDataValidation.normalizeSymbol('abc-def')).toThrow();
    });
    it('should reject internal spaces', () => {
      expect(() => MarketDataValidation.normalizeSymbol('ab c')).toThrow();
    });
    it('should reject full-width characters', () => {
      expect(() => MarketDataValidation.normalizeSymbol('ＡＢＣ')).toThrow();
    });
    it('should reject non-ASCII / accents', () => {
      expect(() => MarketDataValidation.normalizeSymbol('café')).toThrow();
    });
    it('should reject empty', () => {
      expect(() => MarketDataValidation.normalizeSymbol('')).toThrow();
    });
    it('should reject 21 chars', () => {
      expect(() => MarketDataValidation.normalizeSymbol('A'.repeat(21))).toThrow();
    });
  });

  describe('normalizeDateOnly', () => {
    it('should parse valid dates', () => {
      expect(MarketDataValidation.normalizeDateOnly('2024-05-15')).toBe('2024-05-15');
    });

    it('should reject invalid formats', () => {
      expect(() => MarketDataValidation.normalizeDateOnly('2024/05/15')).toThrowError('Invalid date format');
      expect(() => MarketDataValidation.normalizeDateOnly('15-05-2024')).toThrowError('Invalid date format');
      expect(() => MarketDataValidation.normalizeDateOnly('2024-5-15')).toThrowError('Invalid date format');
    });

    it('should accept valid leap day', () => {
      expect(MarketDataValidation.normalizeDateOnly('2024-02-29')).toBe('2024-02-29');
    });

    it('should reject invalid leap day', () => {
      expect(() => MarketDataValidation.normalizeDateOnly('2023-02-29')).toThrowError('Invalid calendar day');
    });

    it('should reject invalid month', () => {
      expect(() => MarketDataValidation.normalizeDateOnly('2024-13-01')).toThrowError('Invalid month');
      expect(() => MarketDataValidation.normalizeDateOnly('2024-00-01')).toThrowError('Invalid month');
    });

    it('should reject invalid day', () => {
      expect(() => MarketDataValidation.normalizeDateOnly('2024-04-31')).toThrowError('Invalid calendar day');
    });

    it('should reject timestamps', () => {
      expect(() => MarketDataValidation.normalizeDateOnly('2024-05-15T12:00:00Z')).toThrowError('Invalid date format');
    });
  });

  describe('normalizeCalendarReason', () => {
    it('should trim whitespace', () => {
      expect(MarketDataValidation.normalizeCalendarReason('  Reason  ')).toBe('Reason');
    });

    it('should return null for empty or whitespace-only', () => {
      expect(MarketDataValidation.normalizeCalendarReason('')).toBeNull();
      expect(MarketDataValidation.normalizeCalendarReason('   ')).toBeNull();
      expect(MarketDataValidation.normalizeCalendarReason(null)).toBeNull();
      expect(MarketDataValidation.normalizeCalendarReason(undefined)).toBeNull();
    });
  });
});
