import { describe, it, expect } from 'vitest';
import { MarketInstrumentDomain } from '../../../src/domain/market-data/MarketInstrument';
import { MarketInstrumentInvalidError, MarketInstrumentAlreadyClosedError } from '../../../src/domain/market-data/MarketDataErrors';

import { MARKET_INSTRUMENT_BUSINESS_KEY_FORMAT } from '../../../src/domain/market-data/MarketInstrument';

describe('MarketInstrumentDomain', () => {
  describe('buildBusinessKey', () => {
    it('should format a fixed business key vector correctly using defined contract format', () => {
      // Contract format
      expect(MARKET_INSTRUMENT_BUSINESS_KEY_FORMAT.contractVersion).toBe('1.0');

      const key = MarketInstrumentDomain.buildBusinessKey('HOSE', 'VCB', 'EQUITY', '2026-01-02');
      expect(key).toBe('VN|HOSE|VCB|EQUITY|2026-01-02');
    });

    it('should reject if invalid parameters passed', () => {
      expect(() => MarketInstrumentDomain.buildBusinessKey('HOSE', 'VCB 1', 'EQUITY', '2026-01-02')).toThrow();
    });
  });

  describe('isOverlap', () => {
    it('should detect overlap for closed intervals', () => {
      expect(MarketInstrumentDomain.isOverlap('2024-01-01', '2024-12-31', '2024-06-01', '2025-01-01')).toBe(true);
    });

    it('should not detect overlap for disjoint closed intervals', () => {
      expect(MarketInstrumentDomain.isOverlap('2024-01-01', '2024-05-31', '2024-06-01', '2025-01-01')).toBe(false);
    });

    it('should detect overlap when touching boundary', () => {
      expect(MarketInstrumentDomain.isOverlap('2024-01-01', '2024-06-01', '2024-06-01', '2025-01-01')).toBe(true);
    });

    it('should detect overlap for open-ended intervals', () => {
      expect(MarketInstrumentDomain.isOverlap('2024-06-01', null, '2024-01-01', null)).toBe(true);
      expect(MarketInstrumentDomain.isOverlap('2024-01-01', '2024-05-31', '2024-06-01', null)).toBe(false);
      expect(MarketInstrumentDomain.isOverlap('2024-06-01', '2024-12-31', '2024-01-01', null)).toBe(true);
    });

    it('should throw if effectiveTo < effectiveFrom', () => {
      expect(() => MarketInstrumentDomain.isOverlap('2024-06-01', '2024-01-01', '2024-01-01', '2024-12-31')).toThrow(MarketInstrumentInvalidError);
    });
  });

  describe('validateClosure', () => {
    it('should pass for valid closure', () => {
      expect(MarketInstrumentDomain.validateClosure('2024-01-01', null, '2024-12-31')).toBe('2024-12-31');
    });

    it('should throw if already closed', () => {
      expect(() => MarketInstrumentDomain.validateClosure('2024-01-01', '2024-12-31', '2024-12-31')).toThrow(MarketInstrumentAlreadyClosedError);
    });

    it('should throw if close date is before effectiveFrom', () => {
      expect(() => MarketInstrumentDomain.validateClosure('2024-06-01', null, '2024-01-01')).toThrow(MarketInstrumentInvalidError);
    });
  });
});
