import { describe, it, expect } from 'vitest';
import { TradingCalendarDayDomain } from '../../../src/domain/market-data/TradingCalendarDay';

describe('TradingCalendarDayDomain', () => {
  describe('buildIdentity', () => {
    it('should build deterministic identity string', () => {
      const id = TradingCalendarDayDomain.buildIdentity('source-uuid', 'HOSE', '2024-01-01');
      expect(id).toBe('source-uuid|HOSE|2024-01-01');
    });
  });

  describe('buildCanonicalHash', () => {
    it('should build payload and hash', () => {
      const { payload, hash } = TradingCalendarDayDomain.buildCanonicalHash(
        'VN|MARKET_DATA_SOURCE|1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        'HOSE',
        '2024-01-01',
        'TRADING_DAY',
        '  Normal Day  '
      );

      expect(payload.reason).toBe('Normal Day');
      expect(payload.calendarContractVersion).toBe('1.0');

      expect(hash.length).toBe(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should handle null reason', () => {
      const { payload } = TradingCalendarDayDomain.buildCanonicalHash(
        'VN|MARKET_DATA_SOURCE|1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        'HNX',
        '2024-01-01',
        'HOLIDAY',
        '   '
      );
      expect(payload.reason).toBeNull();
    });
  });
});
