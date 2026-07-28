import { describe, it, expect } from 'vitest';
import { TradingCalendarDayDomain } from '../../../src/domain/market-data/TradingCalendarDay';
import { TradingCalendarInvalidError } from '../../../src/domain/market-data/MarketDataErrors';

describe('TradingCalendarDayDomain Validation', () => {
  describe('Canonical Input Validation (buildCanonicalHash)', () => {
    it('should pass and return exact valid literal hash', () => {
      const sourceVersionKey = 'VN|MARKET_DATA_SOURCE|1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      const exchange = 'HOSE';
      const marketDate = '2023-01-01';
      const dayType = 'TRADING_DAY';
      const reason = null;

      const result = TradingCalendarDayDomain.buildCanonicalHash(sourceVersionKey, exchange, marketDate, dayType, reason);

      expect(result.hash).toBe('061e9be55160e83924a02e98cceac1a5d13aad4c5bb38ad50e2b9013ca1f7a83');
    });

    describe('sourceVersionKey validation', () => {
      it('rejects non-string', () => {
        expect(() => TradingCalendarDayDomain.buildCanonicalHash(123, 'HOSE', '2023-01-01', 'TRADING_DAY', null)).toThrow(TradingCalendarInvalidError);
      });
      it('rejects empty', () => {
        expect(() => TradingCalendarDayDomain.buildCanonicalHash('', 'HOSE', '2023-01-01', 'TRADING_DAY', null)).toThrow(TradingCalendarInvalidError);
      });
      it('rejects whitespace only', () => {
        expect(() => TradingCalendarDayDomain.buildCanonicalHash('   ', 'HOSE', '2023-01-01', 'TRADING_DAY', null)).toThrow(TradingCalendarInvalidError);
      });
      it('rejects wrong prefix', () => {
        expect(() => TradingCalendarDayDomain.buildCanonicalHash('US|MARKET_DATA_SOURCE|1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', 'HOSE', '2023-01-01', 'TRADING_DAY', null)).toThrow(TradingCalendarInvalidError);
      });
      it('rejects uppercase hash', () => {
        expect(() => TradingCalendarDayDomain.buildCanonicalHash('VN|MARKET_DATA_SOURCE|1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF', 'HOSE', '2023-01-01', 'TRADING_DAY', null)).toThrow(TradingCalendarInvalidError);
      });
      it('rejects short hash', () => {
        expect(() => TradingCalendarDayDomain.buildCanonicalHash('VN|MARKET_DATA_SOURCE|1234567890abcdef', 'HOSE', '2023-01-01', 'TRADING_DAY', null)).toThrow(TradingCalendarInvalidError);
      });
      it('rejects long hash', () => {
        expect(() => TradingCalendarDayDomain.buildCanonicalHash('VN|MARKET_DATA_SOURCE|1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef123', 'HOSE', '2023-01-01', 'TRADING_DAY', null)).toThrow(TradingCalendarInvalidError);
      });
      it('rejects non-hex', () => {
        expect(() => TradingCalendarDayDomain.buildCanonicalHash('VN|MARKET_DATA_SOURCE|1234567890abcdef1234567890abcdef123456xyz890abcdef1234567890abcdef', 'HOSE', '2023-01-01', 'TRADING_DAY', null)).toThrow(TradingCalendarInvalidError);
      });
      it('accepts and normalizes leading/trailing whitespace', () => {
        const result = TradingCalendarDayDomain.buildCanonicalHash('  VN|MARKET_DATA_SOURCE|1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef  ', 'HOSE', '2023-01-01', 'TRADING_DAY', null);
        expect(result.payload.sourceVersionKey).toBe('VN|MARKET_DATA_SOURCE|1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef');
        expect(result.hash).toBe('061e9be55160e83924a02e98cceac1a5d13aad4c5bb38ad50e2b9013ca1f7a83');
      });
    });

    describe('exchange validation', () => {
      it('rejects non-string', () => {
        expect(() => TradingCalendarDayDomain.buildCanonicalHash('VN|MARKET_DATA_SOURCE|1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', 123, '2023-01-01', 'TRADING_DAY', null)).toThrow(TradingCalendarInvalidError);
      });
      it('rejects NASDAQ', () => {
        expect(() => TradingCalendarDayDomain.buildCanonicalHash('VN|MARKET_DATA_SOURCE|1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', 'NASDAQ', '2023-01-01', 'TRADING_DAY', null)).toThrow(TradingCalendarInvalidError);
      });
      it('accepts valid HOSE', () => {
        expect(() => TradingCalendarDayDomain.buildCanonicalHash('VN|MARKET_DATA_SOURCE|1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', 'HOSE', '2023-01-01', 'TRADING_DAY', null)).not.toThrow();
      });
      it('accepts valid HNX', () => {
        expect(() => TradingCalendarDayDomain.buildCanonicalHash('VN|MARKET_DATA_SOURCE|1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', 'HNX', '2023-01-01', 'TRADING_DAY', null)).not.toThrow();
      });
      it('accepts valid UPCOM', () => {
        expect(() => TradingCalendarDayDomain.buildCanonicalHash('VN|MARKET_DATA_SOURCE|1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', 'UPCOM', '2023-01-01', 'TRADING_DAY', null)).not.toThrow();
      });
    });

    describe('marketDate validation', () => {
      it('rejects non-string', () => {
        expect(() => TradingCalendarDayDomain.buildCanonicalHash('VN|MARKET_DATA_SOURCE|1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', 'HOSE', 123, 'TRADING_DAY', null)).toThrow(TradingCalendarInvalidError);
      });
      it('rejects wrong format', () => {
        expect(() => TradingCalendarDayDomain.buildCanonicalHash('VN|MARKET_DATA_SOURCE|1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', 'HOSE', '2023/01/01', 'TRADING_DAY', null)).toThrow(TradingCalendarInvalidError);
      });
      it('rejects invalid month', () => {
        expect(() => TradingCalendarDayDomain.buildCanonicalHash('VN|MARKET_DATA_SOURCE|1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', 'HOSE', '2023-13-01', 'TRADING_DAY', null)).toThrow(TradingCalendarInvalidError);
      });
      it('rejects February 30', () => {
        expect(() => TradingCalendarDayDomain.buildCanonicalHash('VN|MARKET_DATA_SOURCE|1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', 'HOSE', '2023-02-30', 'TRADING_DAY', null)).toThrow(TradingCalendarInvalidError);
      });
      it('accepts valid leap day', () => {
        expect(() => TradingCalendarDayDomain.buildCanonicalHash('VN|MARKET_DATA_SOURCE|1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', 'HOSE', '2024-02-29', 'TRADING_DAY', null)).not.toThrow();
      });
      it('raw generic error message not exposed', () => {
        let err: any;
        try {
          TradingCalendarDayDomain.buildCanonicalHash('VN|MARKET_DATA_SOURCE|1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', 'HOSE', '2024-04-31', 'TRADING_DAY', null);
        } catch (e) {
          err = e;
        }
        expect(err.message).toBe('marketDate is invalid.');
        expect(err.message).not.toContain('Invalid calendar day in date');
      });
    });

    describe('dayType validation', () => {
      it('rejects non-string', () => {
        expect(() => TradingCalendarDayDomain.buildCanonicalHash('VN|MARKET_DATA_SOURCE|1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', 'HOSE', '2023-01-01', 123, null)).toThrow(TradingCalendarInvalidError);
      });
      it('rejects UNKNOWN', () => {
        expect(() => TradingCalendarDayDomain.buildCanonicalHash('VN|MARKET_DATA_SOURCE|1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', 'HOSE', '2023-01-01', 'UNKNOWN', null)).toThrow(TradingCalendarInvalidError);
      });
      it('accepts all five valid values', () => {
        const types = ['TRADING_DAY', 'WEEKEND', 'HOLIDAY', 'SYSTEM_MAINTENANCE', 'OTHER'];
        for (const type of types) {
          expect(() => TradingCalendarDayDomain.buildCanonicalHash('VN|MARKET_DATA_SOURCE|1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', 'HOSE', '2023-01-01', type, null)).not.toThrow();
        }
      });
    });

    describe('reason validation', () => {
      it('undefined -> null', () => {
        const result = TradingCalendarDayDomain.buildCanonicalHash('VN|MARKET_DATA_SOURCE|1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', 'HOSE', '2023-01-01', 'TRADING_DAY', undefined);
        expect(result.payload.reason).toBeNull();
      });
      it('null -> null', () => {
        const result = TradingCalendarDayDomain.buildCanonicalHash('VN|MARKET_DATA_SOURCE|1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', 'HOSE', '2023-01-01', 'TRADING_DAY', null);
        expect(result.payload.reason).toBeNull();
      });
      it('whitespace -> null', () => {
        const result = TradingCalendarDayDomain.buildCanonicalHash('VN|MARKET_DATA_SOURCE|1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', 'HOSE', '2023-01-01', 'TRADING_DAY', '   ');
        expect(result.payload.reason).toBeNull();
      });
      it('trimmed', () => {
        const result = TradingCalendarDayDomain.buildCanonicalHash('VN|MARKET_DATA_SOURCE|1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', 'HOSE', '2023-01-01', 'TRADING_DAY', '  some reason  ');
        expect(result.payload.reason).toBe('some reason');
      });
      it('case preserved', () => {
        const result = TradingCalendarDayDomain.buildCanonicalHash('VN|MARKET_DATA_SOURCE|1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', 'HOSE', '2023-01-01', 'TRADING_DAY', 'SoMe REAson');
        expect(result.payload.reason).toBe('SoMe REAson');
      });
      it('number -> TradingCalendarInvalidError', () => {
        expect(() => TradingCalendarDayDomain.buildCanonicalHash('VN|MARKET_DATA_SOURCE|1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', 'HOSE', '2023-01-01', 'TRADING_DAY', 123)).toThrow(TradingCalendarInvalidError);
      });
      it('boolean -> TradingCalendarInvalidError', () => {
        expect(() => TradingCalendarDayDomain.buildCanonicalHash('VN|MARKET_DATA_SOURCE|1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', 'HOSE', '2023-01-01', 'TRADING_DAY', true)).toThrow(TradingCalendarInvalidError);
      });
      it('object -> TradingCalendarInvalidError', () => {
        expect(() => TradingCalendarDayDomain.buildCanonicalHash('VN|MARKET_DATA_SOURCE|1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', 'HOSE', '2023-01-01', 'TRADING_DAY', {})).toThrow(TradingCalendarInvalidError);
      });
      it('array -> TradingCalendarInvalidError', () => {
        expect(() => TradingCalendarDayDomain.buildCanonicalHash('VN|MARKET_DATA_SOURCE|1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', 'HOSE', '2023-01-01', 'TRADING_DAY', [])).toThrow(TradingCalendarInvalidError);
      });
    });
  });

  describe('Identity Validation (buildIdentity)', () => {
    it('non-string sourceVersionId', () => {
      expect(() => TradingCalendarDayDomain.buildIdentity(123, 'HOSE', '2023-01-01')).toThrow(TradingCalendarInvalidError);
    });
    it('empty sourceVersionId', () => {
      expect(() => TradingCalendarDayDomain.buildIdentity('', 'HOSE', '2023-01-01')).toThrow(TradingCalendarInvalidError);
    });
    it('whitespace-only sourceVersionId', () => {
      expect(() => TradingCalendarDayDomain.buildIdentity('   ', 'HOSE', '2023-01-01')).toThrow(TradingCalendarInvalidError);
    });
    it('sourceVersionId trimmed', () => {
      const result = TradingCalendarDayDomain.buildIdentity('  uuid-1234-5678  ', 'HOSE', '2023-01-01');
      expect(result).toBe('uuid-1234-5678|HOSE|2023-01-01');
    });
    it('invalid exchange', () => {
      expect(() => TradingCalendarDayDomain.buildIdentity('uuid', 'NASDAQ', '2023-01-01')).toThrow(TradingCalendarInvalidError);
    });
    it('invalid marketDate', () => {
      expect(() => TradingCalendarDayDomain.buildIdentity('uuid', 'HOSE', '2023-02-30')).toThrow(TradingCalendarInvalidError);
    });
    it('valid identity output unchanged', () => {
      const result = TradingCalendarDayDomain.buildIdentity('uuid-1234', 'HOSE', '2023-01-01');
      expect(result).toBe('uuid-1234|HOSE|2023-01-01');
    });
  });

  describe('Error Metadata checks', () => {
    it('asserts metadata on validation errors', () => {
      let err: any;
      try {
        TradingCalendarDayDomain.buildCanonicalHash('', 'HOSE', '2023-01-01', 'TRADING_DAY', null);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(TradingCalendarInvalidError);
      expect(err.code).toBe('TRADING_CALENDAR_INVALID');
      expect(err.category).toBe('VALIDATION');
      expect(err.retryable).toBe(false);
      expect(err.safeMessage).toBe('The provided trading calendar day is invalid.');
    });
  });
});
