import { describe, it, expect } from 'vitest';
import { DailyMarketBarDomain } from '../../../src/domain/market-data/DailyMarketBar';
import { DailyMarketBarInvalidError } from '../../../src/domain/market-data/MarketDataErrors';
import { CanonicalDailyBarPayload, MARKET_DATA_CONTRACT_VERSIONS } from '../../../src/domain/contracts/MarketDataContracts';
import { MarketInstrumentDomain } from '../../../src/domain/market-data/MarketInstrument';

describe('DailyMarketBarDomain', () => {
  const validSourceVersionKey = 'VN|MARKET_DATA_SOURCE|' + 'a'.repeat(64);
  const validInstrumentKey = MarketInstrumentDomain.buildBusinessKey('HOSE', 'FPT', 'EQUITY', '2020-01-01');

  const createValidPayload = (overrides: Partial<Omit<CanonicalDailyBarPayload, 'barContractVersion'>> = {}): Omit<CanonicalDailyBarPayload, 'barContractVersion'> => ({
    sourceVersionKey: validSourceVersionKey,
    sourceRecordKey: 'row-123',
    instrumentBusinessKey: validInstrumentKey,
    marketDate: '2023-10-25',
    barKind: 'TRADED',
    open: '100',
    high: '105',
    low: '95',
    close: '102',
    volume: '50000',
    tradingValue: '5100000',
    correctionVersion: 0,
    qualityDecision: 'ACCEPTED',
    qualityFlags: '',
    sourceRowHash: 'b'.repeat(64),
    supersedesBarHash: null,
    ...overrides
  });

  const assertInvalid = (payload: any, messageContains?: string) => {
    try {
      DailyMarketBarDomain.validateCanonicalInput(payload);
      expect.fail('Expected to throw DailyMarketBarInvalidError');
    } catch (e: any) {
      expect(e).toBeInstanceOf(DailyMarketBarInvalidError);
      if (messageContains) {
        expect(e.message).toContain(messageContains);
      }
    }
  };

  describe('A. Canonical contract', () => {
    it('valid TRADED / ACCEPTED', () => {
      const { payload, hash } = DailyMarketBarDomain.buildCanonicalHash(createValidPayload());
      expect(payload.barContractVersion).toBe('1.0');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('valid TRADED / ACCEPTED_WITH_FLAGS', () => {
      const { payload } = DailyMarketBarDomain.buildCanonicalHash(createValidPayload({ qualityDecision: 'ACCEPTED_WITH_FLAGS', qualityFlags: 'MANUAL_VERIFIED' }));
      expect(payload.qualityDecision).toBe('ACCEPTED_WITH_FLAGS');
    });

    it('valid NO_TRADE / ACCEPTED', () => {
      const { hash } = DailyMarketBarDomain.buildCanonicalHash(createValidPayload({ barKind: 'NO_TRADE', open: null, high: null, low: null, close: null, volume: '0', tradingValue: '0' }));
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('valid SUSPENDED / ACCEPTED_WITH_FLAGS', () => {
      const { hash } = DailyMarketBarDomain.buildCanonicalHash(createValidPayload({ barKind: 'SUSPENDED', qualityDecision: 'ACCEPTED_WITH_FLAGS', qualityFlags: 'HALT', open: null, high: null, low: null, close: null, volume: '0', tradingValue: null }));
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('valid QUARANTINED', () => {
      const { hash } = DailyMarketBarDomain.buildCanonicalHash(createValidPayload({ qualityDecision: 'QUARANTINED', open: '-10', high: '5' })); // Structural decimal but violates accepted rules
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('deterministic hash & property-order independence', () => {
      const p1 = createValidPayload();
      const p2 = { ...p1, high: p1.high, open: p1.open }; // Same properties, object spread may not change internal order, but CanonicalSerializer handles it

      const h1 = DailyMarketBarDomain.buildCanonicalHash(p1).hash;
      const h2 = DailyMarketBarDomain.buildCanonicalHash(p2).hash;
      expect(h1).toBe(h2);
    });

    it('single canonical field change changes hash', () => {
      const h1 = DailyMarketBarDomain.buildCanonicalHash(createValidPayload()).hash;
      const h2 = DailyMarketBarDomain.buildCanonicalHash(createValidPayload({ volume: '50001' })).hash;
      expect(h1).not.toBe(h2);
    });
  });

  describe('B. SourceVersion / keys / date', () => {
    it('invalid SourceVersion prefix', () => {
      assertInvalid(createValidPayload({ sourceVersionKey: 'US|MARKET_DATA_SOURCE|' + 'a'.repeat(64) }));
    });
    it('uppercase SourceVersion digest rejected', () => {
      assertInvalid(createValidPayload({ sourceVersionKey: 'VN|MARKET_DATA_SOURCE|' + 'A'.repeat(64) }));
    });
    it('wrong SourceVersion digest length rejected', () => {
      assertInvalid(createValidPayload({ sourceVersionKey: 'VN|MARKET_DATA_SOURCE|' + 'a'.repeat(63) }));
    });
    it('empty sourceRecordKey rejected', () => {
      assertInvalid(createValidPayload({ sourceRecordKey: '' }));
    });
    it('leading sourceRecordKey whitespace rejected', () => {
      assertInvalid(createValidPayload({ sourceRecordKey: ' row' }));
    });
    it('trailing sourceRecordKey whitespace rejected', () => {
      assertInvalid(createValidPayload({ sourceRecordKey: 'row ' }));
    });
    it('internal sourceRecordKey preserved', () => {
      const { payload } = DailyMarketBarDomain.buildCanonicalHash(createValidPayload({ sourceRecordKey: 'r o w' }));
      expect(payload.sourceRecordKey).toBe('r o w');
    });
    it('lowercase symbol rejected in instrument key', () => {
      assertInvalid(createValidPayload({ instrumentBusinessKey: 'VN|HOSE|fpt|EQUITY|2020-01-01' }));
    });
    it('invalid exchange rejected', () => {
      assertInvalid(createValidPayload({ instrumentBusinessKey: 'VN|NYSE|FPT|EQUITY|2020-01-01' }));
    });
    it('invalid instrument business-key date rejected', () => {
      assertInvalid(createValidPayload({ instrumentBusinessKey: 'VN|HOSE|FPT|EQUITY|2020-13-01' }));
    });
    it('invalid marketDate format rejected', () => {
      assertInvalid(createValidPayload({ marketDate: '10/25/2023' }));
    });
    it('impossible calendar date rejected', () => {
      assertInvalid(createValidPayload({ marketDate: '2023-02-29' })); // Not a leap year
    });
  });

  describe('C. Decimal strings', () => {
    const checkValid = (val: string) => DailyMarketBarDomain.buildCanonicalHash(createValidPayload({ volume: val }));
    const checkInvalid = (val: string) => assertInvalid(createValidPayload({ volume: val }));

    it('valid numeric strings', () => {
      checkValid('0');
      checkValid('1');
      checkValid('15000');
    });

    it('negative integer structurally valid for QUARANTINED', () => {
      DailyMarketBarDomain.buildCanonicalHash(createValidPayload({ qualityDecision: 'QUARANTINED', open: '-1', volume: '-500' }));
    });

    it('invalid numeric strings', () => {
      checkInvalid('+1');
      checkInvalid('01');
      checkInvalid('-0');
      checkInvalid('1.0');
      checkInvalid('1.25');
      checkInvalid('1e3');
      checkInvalid(' 1');
      checkInvalid('1 ');
      checkInvalid('');
    });
  });

  describe('D. Correction', () => {
    it('initial valid', () => {
      DailyMarketBarDomain.buildCanonicalHash(createValidPayload({ correctionVersion: 0, supersedesBarHash: null }));
    });
    it('initial with supersedes invalid', () => {
      assertInvalid(createValidPayload({ correctionVersion: 0, supersedesBarHash: 'c'.repeat(64) }));
    });
    it('correction = 1 valid', () => {
      DailyMarketBarDomain.buildCanonicalHash(createValidPayload({ correctionVersion: 1, supersedesBarHash: 'c'.repeat(64) }));
    });
    it('correction > 1 valid', () => {
      DailyMarketBarDomain.buildCanonicalHash(createValidPayload({ correctionVersion: 5, supersedesBarHash: 'c'.repeat(64) }));
    });
    it('correction > 0 null hash invalid', () => {
      assertInvalid(createValidPayload({ correctionVersion: 1, supersedesBarHash: null }));
    });
    it('negative correction invalid', () => {
      assertInvalid(createValidPayload({ correctionVersion: -1, supersedesBarHash: null }));
    });
    it('fractional correction invalid', () => {
      assertInvalid(createValidPayload({ correctionVersion: 1.5, supersedesBarHash: 'c'.repeat(64) }));
    });
    it('uppercase supersedes hash invalid', () => {
      assertInvalid(createValidPayload({ correctionVersion: 1, supersedesBarHash: 'C'.repeat(64) }));
    });
    it('malformed supersedes hash invalid', () => {
      assertInvalid(createValidPayload({ correctionVersion: 1, supersedesBarHash: 'c'.repeat(63) }));
    });
  });

  describe('E. Accepted TRADED', () => {
    it('valid', () => {
      DailyMarketBarDomain.buildCanonicalHash(createValidPayload());
    });
    it('null OHLC invalid', () => {
      assertInvalid(createValidPayload({ open: null }));
      assertInvalid(createValidPayload({ high: null }));
      assertInvalid(createValidPayload({ low: null }));
      assertInvalid(createValidPayload({ close: null }));
    });
    it('negative OHLC invalid', () => {
      assertInvalid(createValidPayload({ open: '-1' }));
      assertInvalid(createValidPayload({ high: '-1' }));
      assertInvalid(createValidPayload({ low: '-1' }));
      assertInvalid(createValidPayload({ close: '-1' }));
    });
    it('negative volume/value invalid', () => {
      assertInvalid(createValidPayload({ volume: '-100' }));
      assertInvalid(createValidPayload({ tradingValue: '-100' }));
    });
    it('high < low invalid', () => {
      assertInvalid(createValidPayload({ high: '90', low: '95' }));
    });
    it('open out of bounds invalid', () => {
      assertInvalid(createValidPayload({ open: '94', low: '95', high: '105' }));
      assertInvalid(createValidPayload({ open: '106', low: '95', high: '105' }));
    });
    it('close out of bounds invalid', () => {
      assertInvalid(createValidPayload({ close: '94', low: '95', high: '105' }));
      assertInvalid(createValidPayload({ close: '106', low: '95', high: '105' }));
    });
    it('tradingValue null valid', () => {
      DailyMarketBarDomain.buildCanonicalHash(createValidPayload({ tradingValue: null }));
    });
    it('tradingValue "0" valid', () => {
      DailyMarketBarDomain.buildCanonicalHash(createValidPayload({ tradingValue: '0' }));
    });
  });

  describe('F. Accepted NO_TRADE', () => {
    const noTradePayload = createValidPayload({ barKind: 'NO_TRADE', open: null, high: null, low: null, close: null, volume: '0', tradingValue: null });
    
    it('valid with null tradingValue', () => {
      DailyMarketBarDomain.buildCanonicalHash(noTradePayload);
    });
    it('valid with "0" tradingValue', () => {
      DailyMarketBarDomain.buildCanonicalHash({ ...noTradePayload, tradingValue: '0' });
    });
    it('non-null OHLC invalid', () => {
      assertInvalid({ ...noTradePayload, open: '10' });
      assertInvalid({ ...noTradePayload, high: '10' });
      assertInvalid({ ...noTradePayload, low: '10' });
      assertInvalid({ ...noTradePayload, close: '10' });
    });
    it('nonzero volume/value invalid', () => {
      assertInvalid({ ...noTradePayload, volume: '10' });
      assertInvalid({ ...noTradePayload, tradingValue: '10' });
    });
  });

  describe('G. Accepted SUSPENDED', () => {
    const susPayload = createValidPayload({ barKind: 'SUSPENDED', open: null, high: null, low: null, close: null, volume: '0', tradingValue: null });
    
    it('valid with null tradingValue', () => {
      DailyMarketBarDomain.buildCanonicalHash(susPayload);
    });
    it('valid with "0" tradingValue', () => {
      DailyMarketBarDomain.buildCanonicalHash({ ...susPayload, tradingValue: '0' });
    });
    it('non-null OHLC invalid', () => {
      assertInvalid({ ...susPayload, open: '10' });
    });
    it('nonzero volume/value invalid', () => {
      assertInvalid({ ...susPayload, volume: '10' });
      assertInvalid({ ...susPayload, tradingValue: '10' });
    });
  });

  describe('H. QUARANTINED', () => {
    it('allows negative prices and volume', () => {
      DailyMarketBarDomain.buildCanonicalHash(createValidPayload({ qualityDecision: 'QUARANTINED', open: '-10', volume: '-100' }));
    });
    it('allows high < low', () => {
      DailyMarketBarDomain.buildCanonicalHash(createValidPayload({ qualityDecision: 'QUARANTINED', high: '10', low: '20' }));
    });
    it('rejects malformed structural decimal strings', () => {
      assertInvalid(createValidPayload({ qualityDecision: 'QUARANTINED', open: '1.5' }));
      assertInvalid(createValidPayload({ qualityDecision: 'QUARANTINED', volume: '1e3' }));
    });
  });

  describe('I. qualityFlags', () => {
    it('empty string preserved', () => {
      const { payload } = DailyMarketBarDomain.buildCanonicalHash(createValidPayload({ qualityFlags: '' }));
      expect(payload.qualityFlags).toBe('');
    });
    it('non-empty string preserved exactly with spaces', () => {
      const { payload } = DailyMarketBarDomain.buildCanonicalHash(createValidPayload({ qualityFlags: ' FLAG1, FLAG2 ' }));
      expect(payload.qualityFlags).toBe(' FLAG1, FLAG2 ');
    });
    it('must be string', () => {
      assertInvalid(createValidPayload({ qualityFlags: null as any }));
    });
  });

  describe('J. Error contract', () => {
    it('throws DailyMarketBarInvalidError for unknown barKind', () => {
      assertInvalid(createValidPayload({ barKind: 'UNKNOWN' as any }));
    });
  });
});
