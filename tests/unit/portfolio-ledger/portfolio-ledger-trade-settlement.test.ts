import { describe, it, expect } from 'vitest';
import { PortfolioLedgerTradeSettlementDomain, PortfolioLedgerTradeSettlementInvalidError } from '../../../src/domain/portfolio-ledger/PortfolioLedgerTradeSettlement';
import { CanonicalSerializer } from '../../../src/domain/hashing/CanonicalSerializer';

describe('PortfolioLedgerTradeSettlementDomain', () => {
  const validSourceExecutionHash = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  const validInstrumentBusinessKey = 'VN|HOSE|HPG|EQUITY|2025-01-01';
  
  const validBuyInput = {
    sourceExecutionHash: validSourceExecutionHash,
    instrumentBusinessKey: validInstrumentBusinessKey,
    quantityDelta: 100n,
    grossCashDeltaVnd: -2500000n,
    feeVnd: 3750n,
    taxVnd: 0n
  };

  const validSellInput = {
    sourceExecutionHash: validSourceExecutionHash,
    instrumentBusinessKey: validInstrumentBusinessKey,
    quantityDelta: -100n,
    grossCashDeltaVnd: 2500000n,
    feeVnd: 3750n,
    taxVnd: 0n
  };

  const expectedFixedVector = '{"contractVersion":"1.0","feeVnd":"3750","grossCashDeltaVnd":"-2500000","instrumentBusinessKey":"VN|HOSE|HPG|EQUITY|2025-01-01","netCashDeltaVnd":"-2503750","postingKind":"TRADE_SETTLEMENT","quantityDelta":"100","side":"BUY","sourceExecutionHash":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","taxVnd":"0"}';
  const expectedFixedHash = '04e5afc80d09798b010cf14dfe628e9393061716891813be2c6868756c5e777c';

  it('A valid BUY exact output', () => {
    const result = PortfolioLedgerTradeSettlementDomain.build(validBuyInput);
    expect(result.contractVersion).toBe('1.0');
    expect(result.postingKind).toBe('TRADE_SETTLEMENT');
    expect(result.sourceExecutionHash).toBe(validSourceExecutionHash);
    expect(result.instrumentBusinessKey).toBe(validInstrumentBusinessKey);
    expect(result.side).toBe('BUY');
    expect(result.quantityDelta).toBe('100');
    expect(result.grossCashDeltaVnd).toBe('-2500000');
    expect(result.feeVnd).toBe('3750');
    expect(result.taxVnd).toBe('0');
    expect(result.netCashDeltaVnd).toBe('-2503750');
    expect(result.payloadHash).toBe(expectedFixedHash);
  });

  it('B exact canonical serialized fixed vector', () => {
    const result = PortfolioLedgerTradeSettlementDomain.build(validBuyInput);
    const payload = {
      contractVersion: result.contractVersion,
      postingKind: result.postingKind,
      sourceExecutionHash: result.sourceExecutionHash,
      instrumentBusinessKey: result.instrumentBusinessKey,
      side: result.side,
      quantityDelta: result.quantityDelta,
      grossCashDeltaVnd: result.grossCashDeltaVnd,
      feeVnd: result.feeVnd,
      taxVnd: result.taxVnd,
      netCashDeltaVnd: result.netCashDeltaVnd
    };
    const serialized = CanonicalSerializer.serialize(payload);
    expect(serialized).toBe(expectedFixedVector);
  });

  it('C exact fixed payloadHash', () => {
    const result = PortfolioLedgerTradeSettlementDomain.build(validBuyInput);
    expect(result.payloadHash).toBe(expectedFixedHash);
  });

  it('D valid SELL derives SELL', () => {
    const result = PortfolioLedgerTradeSettlementDomain.build(validSellInput);
    expect(result.side).toBe('SELL');
  });

  it('E BUY quantity positive', () => {
    const result = PortfolioLedgerTradeSettlementDomain.build(validBuyInput);
    expect(result.quantityDelta).toBe('100');
  });

  it('F SELL quantity negative', () => {
    const result = PortfolioLedgerTradeSettlementDomain.build(validSellInput);
    expect(result.quantityDelta).toBe('-100');
  });

  it('G zero quantity rejected', () => {
    expect(() => PortfolioLedgerTradeSettlementDomain.build({ ...validBuyInput, quantityDelta: 0n })).toThrow(PortfolioLedgerTradeSettlementInvalidError);
  });

  it('H number quantity rejected', () => {
    expect(() => PortfolioLedgerTradeSettlementDomain.build({ ...validBuyInput, quantityDelta: 100 as any })).toThrow(PortfolioLedgerTradeSettlementInvalidError);
  });

  it('I BUY with positive gross cash rejected', () => {
    expect(() => PortfolioLedgerTradeSettlementDomain.build({ ...validBuyInput, grossCashDeltaVnd: 2500000n })).toThrow(PortfolioLedgerTradeSettlementInvalidError);
  });

  it('J SELL with negative gross cash rejected', () => {
    expect(() => PortfolioLedgerTradeSettlementDomain.build({ ...validSellInput, grossCashDeltaVnd: -2500000n })).toThrow(PortfolioLedgerTradeSettlementInvalidError);
  });

  it('K zero gross cash rejected', () => {
    expect(() => PortfolioLedgerTradeSettlementDomain.build({ ...validBuyInput, grossCashDeltaVnd: 0n })).toThrow(PortfolioLedgerTradeSettlementInvalidError);
  });

  it('L zero fee accepted', () => {
    const result = PortfolioLedgerTradeSettlementDomain.build({ ...validBuyInput, feeVnd: 0n });
    expect(result.feeVnd).toBe('0');
  });

  it('M negative fee rejected', () => {
    expect(() => PortfolioLedgerTradeSettlementDomain.build({ ...validBuyInput, feeVnd: -1n })).toThrow(PortfolioLedgerTradeSettlementInvalidError);
  });

  it('N number fee rejected', () => {
    expect(() => PortfolioLedgerTradeSettlementDomain.build({ ...validBuyInput, feeVnd: 3750 as any })).toThrow(PortfolioLedgerTradeSettlementInvalidError);
  });

  it('O zero tax accepted', () => {
    const result = PortfolioLedgerTradeSettlementDomain.build({ ...validSellInput, taxVnd: 0n });
    expect(result.taxVnd).toBe('0');
  });

  it('P negative tax rejected', () => {
    expect(() => PortfolioLedgerTradeSettlementDomain.build({ ...validSellInput, taxVnd: -1n })).toThrow(PortfolioLedgerTradeSettlementInvalidError);
  });

  it('Q number tax rejected', () => {
    expect(() => PortfolioLedgerTradeSettlementDomain.build({ ...validSellInput, taxVnd: 100 as any })).toThrow(PortfolioLedgerTradeSettlementInvalidError);
  });

  it('R BUY netCash derived correctly', () => {
    const result = PortfolioLedgerTradeSettlementDomain.build({ ...validBuyInput, grossCashDeltaVnd: -2500000n, feeVnd: 3750n, taxVnd: 0n });
    expect(result.netCashDeltaVnd).toBe('-2503750');
  });

  it('S SELL netCash derived correctly', () => {
    const result = PortfolioLedgerTradeSettlementDomain.build({ ...validSellInput, grossCashDeltaVnd: 3000000n, feeVnd: 4500n, taxVnd: 3000n });
    expect(result.netCashDeltaVnd).toBe('2992500');
  });

  it('T SELL fees+tax equal gross rejected', () => {
    expect(() => PortfolioLedgerTradeSettlementDomain.build({ ...validSellInput, grossCashDeltaVnd: 1000n, feeVnd: 500n, taxVnd: 500n })).toThrow(PortfolioLedgerTradeSettlementInvalidError);
  });

  it('U SELL fees+tax greater than gross rejected', () => {
    expect(() => PortfolioLedgerTradeSettlementDomain.build({ ...validSellInput, grossCashDeltaVnd: 1000n, feeVnd: 600n, taxVnd: 500n })).toThrow(PortfolioLedgerTradeSettlementInvalidError);
  });

  it('V sourceExecutionHash malformed rejected', () => {
    expect(() => PortfolioLedgerTradeSettlementDomain.build({ ...validBuyInput, sourceExecutionHash: 'short' })).toThrow(PortfolioLedgerTradeSettlementInvalidError);
  });

  it('W sourceExecutionHash uppercase rejected', () => {
    expect(() => PortfolioLedgerTradeSettlementDomain.build({ ...validBuyInput, sourceExecutionHash: validSourceExecutionHash.toUpperCase() })).toThrow(PortfolioLedgerTradeSettlementInvalidError);
  });

  it('X valid HOSE instrument key', () => {
    const result = PortfolioLedgerTradeSettlementDomain.build({ ...validBuyInput, instrumentBusinessKey: 'VN|HOSE|VNM|EQUITY|2025-01-01' });
    expect(result.instrumentBusinessKey).toBe('VN|HOSE|VNM|EQUITY|2025-01-01');
  });

  it('Y valid HNX instrument key', () => {
    const result = PortfolioLedgerTradeSettlementDomain.build({ ...validBuyInput, instrumentBusinessKey: 'VN|HNX|SHS|EQUITY|2025-01-01' });
    expect(result.instrumentBusinessKey).toBe('VN|HNX|SHS|EQUITY|2025-01-01');
  });

  it('Z valid UPCOM instrument key', () => {
    const result = PortfolioLedgerTradeSettlementDomain.build({ ...validBuyInput, instrumentBusinessKey: 'VN|UPCOM|BSR|EQUITY|2025-01-01' });
    expect(result.instrumentBusinessKey).toBe('VN|UPCOM|BSR|EQUITY|2025-01-01');
  });

  it('AA lowercase symbol rejected', () => {
    expect(() => PortfolioLedgerTradeSettlementDomain.build({ ...validBuyInput, instrumentBusinessKey: 'VN|HOSE|hpg|EQUITY|2025-01-01' })).toThrow(PortfolioLedgerTradeSettlementInvalidError);
  });

  it('AB lowercase exchange rejected', () => {
    expect(() => PortfolioLedgerTradeSettlementDomain.build({ ...validBuyInput, instrumentBusinessKey: 'VN|hose|HPG|EQUITY|2025-01-01' })).toThrow(PortfolioLedgerTradeSettlementInvalidError);
  });

  it('AC unsupported exchange rejected', () => {
    expect(() => PortfolioLedgerTradeSettlementDomain.build({ ...validBuyInput, instrumentBusinessKey: 'VN|NYSE|HPG|EQUITY|2025-01-01' })).toThrow(PortfolioLedgerTradeSettlementInvalidError);
  });

  it('AD non-EQUITY rejected', () => {
    expect(() => PortfolioLedgerTradeSettlementDomain.build({ ...validBuyInput, instrumentBusinessKey: 'VN|HOSE|HPG|FUTURE|2025-01-01' })).toThrow(PortfolioLedgerTradeSettlementInvalidError);
  });

  it('AE malformed instrument key rejected', () => {
    expect(() => PortfolioLedgerTradeSettlementDomain.build({ ...validBuyInput, instrumentBusinessKey: 'VN|HOSE|HPG|EQUITY' })).toThrow(PortfolioLedgerTradeSettlementInvalidError);
  });

  it('AF impossible listing date rejected', () => {
    expect(() => PortfolioLedgerTradeSettlementDomain.build({ ...validBuyInput, instrumentBusinessKey: 'VN|HOSE|HPG|EQUITY|2025-02-30' })).toThrow(PortfolioLedgerTradeSettlementInvalidError);
  });

  it('AG malformed listing date rejected', () => {
    expect(() => PortfolioLedgerTradeSettlementDomain.build({ ...validBuyInput, instrumentBusinessKey: 'VN|HOSE|HPG|EQUITY|2025-1-1' })).toThrow(PortfolioLedgerTradeSettlementInvalidError);
  });

  it('AH symbol >20 rejected', () => {
    expect(() => PortfolioLedgerTradeSettlementDomain.build({ ...validBuyInput, instrumentBusinessKey: 'VN|HOSE|ABCDEFGHIJKLMNOPQRSTU|EQUITY|2025-01-01' })).toThrow(PortfolioLedgerTradeSettlementInvalidError);
  });

  it('AI null input rejected', () => {
    expect(() => PortfolioLedgerTradeSettlementDomain.build(null as any)).toThrow(PortfolioLedgerTradeSettlementInvalidError);
  });

  it('AJ undefined rejected', () => {
    expect(() => PortfolioLedgerTradeSettlementDomain.build(undefined as any)).toThrow(PortfolioLedgerTradeSettlementInvalidError);
  });

  it('AK primitive rejected', () => {
    expect(() => PortfolioLedgerTradeSettlementDomain.build('string' as any)).toThrow(PortfolioLedgerTradeSettlementInvalidError);
  });

  it('AL array rejected', () => {
    expect(() => PortfolioLedgerTradeSettlementDomain.build([] as any)).toThrow(PortfolioLedgerTradeSettlementInvalidError);
  });

  it('AM deterministic build', () => {
    const result1 = PortfolioLedgerTradeSettlementDomain.build(validBuyInput);
    const result2 = PortfolioLedgerTradeSettlementDomain.build(validBuyInput);
    expect(result1).toEqual(result2);
  });

  it('AN input not mutated', () => {
    const input = { ...validBuyInput };
    PortfolioLedgerTradeSettlementDomain.build(input);
    expect(input).toEqual(validBuyInput);
  });

  it('AO output frozen', () => {
    const result = PortfolioLedgerTradeSettlementDomain.build(validBuyInput);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('AP runtime side override ignored', () => {
    const result = PortfolioLedgerTradeSettlementDomain.build({ ...validBuyInput, side: 'SELL' } as any);
    expect(result.side).toBe('BUY');
  });

  it('AQ runtime net cash override ignored', () => {
    const result = PortfolioLedgerTradeSettlementDomain.build({ ...validBuyInput, netCashDeltaVnd: '999' } as any);
    expect(result.netCashDeltaVnd).toBe('-2503750');
  });

  it('AR runtime payloadHash override ignored', () => {
    const result = PortfolioLedgerTradeSettlementDomain.build({ ...validBuyInput, payloadHash: 'fake' } as any);
    expect(result.payloadHash).toBe(expectedFixedHash);
  });

  it('AS runtime contract/posting override ignored', () => {
    const result = PortfolioLedgerTradeSettlementDomain.build({ ...validBuyInput, contractVersion: '999', postingKind: 'EVIL' } as any);
    expect(result.contractVersion).toBe('1.0');
    expect(result.postingKind).toBe('TRADE_SETTLEMENT');
  });

  it('AT source hash changes payloadHash', () => {
    const result1 = PortfolioLedgerTradeSettlementDomain.build(validBuyInput);
    const result2 = PortfolioLedgerTradeSettlementDomain.build({ ...validBuyInput, sourceExecutionHash: 'f' + validSourceExecutionHash.substring(1) });
    expect(result1.payloadHash).not.toBe(result2.payloadHash);
  });

  it('AU instrument key changes payloadHash', () => {
    const result1 = PortfolioLedgerTradeSettlementDomain.build(validBuyInput);
    const result2 = PortfolioLedgerTradeSettlementDomain.build({ ...validBuyInput, instrumentBusinessKey: 'VN|HOSE|VNM|EQUITY|2025-01-01' });
    expect(result1.payloadHash).not.toBe(result2.payloadHash);
  });

  it('AV quantity changes payloadHash', () => {
    const result1 = PortfolioLedgerTradeSettlementDomain.build(validBuyInput);
    const result2 = PortfolioLedgerTradeSettlementDomain.build({ ...validBuyInput, quantityDelta: 200n });
    expect(result1.payloadHash).not.toBe(result2.payloadHash);
  });

  it('AW gross cash changes payloadHash', () => {
    const result1 = PortfolioLedgerTradeSettlementDomain.build(validBuyInput);
    const result2 = PortfolioLedgerTradeSettlementDomain.build({ ...validBuyInput, grossCashDeltaVnd: -2600000n });
    expect(result1.payloadHash).not.toBe(result2.payloadHash);
  });

  it('AX fee changes payloadHash', () => {
    const result1 = PortfolioLedgerTradeSettlementDomain.build(validBuyInput);
    const result2 = PortfolioLedgerTradeSettlementDomain.build({ ...validBuyInput, feeVnd: 3800n });
    expect(result1.payloadHash).not.toBe(result2.payloadHash);
  });

  it('AY tax changes payloadHash', () => {
    const result1 = PortfolioLedgerTradeSettlementDomain.build(validSellInput);
    const result2 = PortfolioLedgerTradeSettlementDomain.build({ ...validSellInput, taxVnd: 10n });
    expect(result1.payloadHash).not.toBe(result2.payloadHash);
  });

  it('AZ exact output keys', () => {
    const result = PortfolioLedgerTradeSettlementDomain.build({ ...validBuyInput, evilKey: 'evil' } as any);
    const keys = Object.keys(result);
    expect(keys).toHaveLength(11);
    expect(keys).toContain('contractVersion');
    expect(keys).toContain('postingKind');
    expect(keys).toContain('sourceExecutionHash');
    expect(keys).toContain('instrumentBusinessKey');
    expect(keys).toContain('side');
    expect(keys).toContain('quantityDelta');
    expect(keys).toContain('grossCashDeltaVnd');
    expect(keys).toContain('feeVnd');
    expect(keys).toContain('taxVnd');
    expect(keys).toContain('netCashDeltaVnd');
    expect(keys).toContain('payloadHash');
  });

  it('BA error message/code/name exact', () => {
    const error = new PortfolioLedgerTradeSettlementInvalidError();
    expect(error.message).toBe('Portfolio ledger trade settlement is invalid.');
    expect(error.code).toBe('PORTFOLIO_LEDGER_TRADE_SETTLEMENT_INVALID');
    expect(error.name).toBe('PortfolioLedgerTradeSettlementInvalidError');
    expect(error).toBeInstanceOf(PortfolioLedgerTradeSettlementInvalidError);
  });
});
