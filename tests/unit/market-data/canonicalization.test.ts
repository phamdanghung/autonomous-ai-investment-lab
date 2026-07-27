import { describe, it, expect } from 'vitest';
import { MarketDataCanonicalization } from '../../../src/domain/market-data/MarketDataCanonicalization';

describe('MarketDataCanonicalization', () => {
  describe('deriveAdvisoryLockKey', () => {
    it('should return a deterministic bigint value and test fixed vectors for positive/negative', () => {
      // POSITIVE VECTOR
      const positiveLock = MarketDataCanonicalization.deriveAdvisoryLockKey('HOSE', 'SYM1', 'EQUITY');
      expect(positiveLock).toBe(958443801348653132n);
      // Hardcode assertion
      const serializedPos = '{"canonicalSymbol":"SYM1","exchange":"HOSE","securityType":"EQUITY"}';
      const hashPos = '0d4d138f2c8fc04c38a0a36cf9c8ee129e0d54ed9e7d7a0be8593f51a22d1d2d';
      const first16Pos = '0d4d138f2c8fc04c';
      const unsignedPos = 958443801348653132n;
      expect(positiveLock).toBe(unsignedPos);
      expect(positiveLock >= 0n && positiveLock <= 9223372036854775807n).toBe(true);

      // NEGATIVE VECTOR
      const negativeLock = MarketDataCanonicalization.deriveAdvisoryLockKey('HOSE', 'SYM0', 'EQUITY');
      expect(negativeLock).toBe(-4974882603820253658n);
      // Hardcode assertion
      const serializedNeg = '{"canonicalSymbol":"SYM0","exchange":"HOSE","securityType":"EQUITY"}';
      const hashNeg = 'baf5aaa14005fe265fb366be7dd7cdbad1100bd4623db7c705442738617163e3';
      const first16Neg = 'baf5aaa14005fe26';
      const unsignedNeg = 13471861469889297958n;
      // unsigned - 2^64
      expect(negativeLock).toBe(unsignedNeg - 18446744073709551616n);
      expect(negativeLock < 0n && negativeLock >= -9223372036854775808n).toBe(true);

      // Deterministic identical
      expect(positiveLock).toBe(MarketDataCanonicalization.deriveAdvisoryLockKey('HOSE', 'SYM1', 'EQUITY'));

      // Different payload, different lock
      expect(positiveLock).not.toBe(negativeLock);
    });
  });
});
