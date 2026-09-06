import { describe, it, expect } from 'vitest';
import { SimulationOrderIntentDomain, SimulationOrderIntentInvalidError } from '../../../src/domain/order-execution/SimulationOrderIntent';
import { CanonicalSerializer } from '../../../src/domain/hashing/CanonicalSerializer';

describe('SimulationOrderIntentDomain', () => {
  const validRunBusinessKey = 'a'.repeat(64);
  const validSourceDecisionHash = 'b'.repeat(64);
  const validDate = '2026-08-01';
  const validInstrument = 'VN|HOSE|VNM|EQUITY|2026-08-01';

  const validBuyInput = {
    runBusinessKey: validRunBusinessKey,
    simulationDate: validDate,
    instrumentBusinessKey: validInstrument,
    side: 'BUY' as const,
    quantity: 100n,
    orderType: 'MARKET' as const,
    sourceDecisionHash: validSourceDecisionHash,
  };

  const validSellInput = {
    ...validBuyInput,
    side: 'SELL' as const,
  };

  it('A: valid BUY MARKET intent', () => {
    const result = SimulationOrderIntentDomain.build(validBuyInput);
    expect(result.side).toBe('BUY');
    expect(result.intentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.quantity).toBe('100');
  });

  it('B: valid SELL MARKET intent', () => {
    const result = SimulationOrderIntentDomain.build(validSellInput);
    expect(result.side).toBe('SELL');
    expect(result.intentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.quantity).toBe('100');
  });

  it('C: deterministic same input => same intentHash', () => {
    const res1 = SimulationOrderIntentDomain.build(validBuyInput);
    const res2 = SimulationOrderIntentDomain.build(validBuyInput);
    expect(res1.intentHash).toBe(res2.intentHash);
  });

  it('D: changing runBusinessKey changes intentHash', () => {
    const res1 = SimulationOrderIntentDomain.build(validBuyInput);
    const res2 = SimulationOrderIntentDomain.build({ ...validBuyInput, runBusinessKey: 'c'.repeat(64) });
    expect(res1.intentHash).not.toBe(res2.intentHash);
  });

  it('E: changing simulationDate changes intentHash', () => {
    const res1 = SimulationOrderIntentDomain.build(validBuyInput);
    const res2 = SimulationOrderIntentDomain.build({ ...validBuyInput, simulationDate: '2026-08-02' });
    expect(res1.intentHash).not.toBe(res2.intentHash);
  });

  it('F: changing instrumentBusinessKey changes intentHash', () => {
    const res1 = SimulationOrderIntentDomain.build(validBuyInput);
    const res2 = SimulationOrderIntentDomain.build({ ...validBuyInput, instrumentBusinessKey: 'VN|HOSE|FPT|EQUITY|2026-08-01' });
    expect(res1.intentHash).not.toBe(res2.intentHash);
  });

  it('G: changing side changes intentHash', () => {
    const res1 = SimulationOrderIntentDomain.build(validBuyInput);
    const res2 = SimulationOrderIntentDomain.build(validSellInput);
    expect(res1.intentHash).not.toBe(res2.intentHash);
  });

  it('H: changing quantity changes intentHash', () => {
    const res1 = SimulationOrderIntentDomain.build(validBuyInput);
    const res2 = SimulationOrderIntentDomain.build({ ...validBuyInput, quantity: 200n });
    expect(res1.intentHash).not.toBe(res2.intentHash);
  });

  it('I: changing sourceDecisionHash changes intentHash', () => {
    const res1 = SimulationOrderIntentDomain.build(validBuyInput);
    const res2 = SimulationOrderIntentDomain.build({ ...validBuyInput, sourceDecisionHash: 'c'.repeat(64) });
    expect(res1.intentHash).not.toBe(res2.intentHash);
  });

  it('J: invalid runBusinessKey', () => {
    expect(() => SimulationOrderIntentDomain.build({ ...validBuyInput, runBusinessKey: 'short' })).toThrow(SimulationOrderIntentInvalidError);
  });

  it('K: uppercase runBusinessKey rejected', () => {
    expect(() => SimulationOrderIntentDomain.build({ ...validBuyInput, runBusinessKey: 'A'.repeat(64) })).toThrow(SimulationOrderIntentInvalidError);
  });

  it('L: invalid simulationDate format', () => {
    expect(() => SimulationOrderIntentDomain.build({ ...validBuyInput, simulationDate: '2026/08/01' })).toThrow(SimulationOrderIntentInvalidError);
  });

  it('M: impossible simulationDate rejected', () => {
    expect(() => SimulationOrderIntentDomain.build({ ...validBuyInput, simulationDate: '2026-02-30' })).toThrow(SimulationOrderIntentInvalidError);
  });

  it('N: invalid instrument country', () => {
    expect(() => SimulationOrderIntentDomain.build({ ...validBuyInput, instrumentBusinessKey: 'US|HOSE|VNM|EQUITY|2026-08-01' })).toThrow(SimulationOrderIntentInvalidError);
  });

  it('O: invalid exchange', () => {
    expect(() => SimulationOrderIntentDomain.build({ ...validBuyInput, instrumentBusinessKey: 'VN|INVALID|VNM|EQUITY|2026-08-01' })).toThrow(SimulationOrderIntentInvalidError);
  });

  it('P: lowercase instrument canonical symbol rejected', () => {
    expect(() => SimulationOrderIntentDomain.build({ ...validBuyInput, instrumentBusinessKey: 'VN|HOSE|vnm|EQUITY|2026-08-01' })).toThrow(SimulationOrderIntentInvalidError);
  });

  it('Q: invalid symbol characters', () => {
    expect(() => SimulationOrderIntentDomain.build({ ...validBuyInput, instrumentBusinessKey: 'VN|HOSE|VNM-1|EQUITY|2026-08-01' })).toThrow(SimulationOrderIntentInvalidError);
  });

  it('R: invalid instrument effectiveFrom calendar date', () => {
    expect(() => SimulationOrderIntentDomain.build({ ...validBuyInput, instrumentBusinessKey: 'VN|HOSE|VNM|EQUITY|2026-02-30' })).toThrow(SimulationOrderIntentInvalidError);
  });

  it('S: invalid securityType', () => {
    expect(() => SimulationOrderIntentDomain.build({ ...validBuyInput, instrumentBusinessKey: 'VN|HOSE|VNM|BOND|2026-08-01' })).toThrow(SimulationOrderIntentInvalidError);
  });

  it('T: malformed instrument component count', () => {
    expect(() => SimulationOrderIntentDomain.build({ ...validBuyInput, instrumentBusinessKey: 'VN|HOSE|VNM|EQUITY' })).toThrow(SimulationOrderIntentInvalidError);
  });

  it('U: quantity zero', () => {
    expect(() => SimulationOrderIntentDomain.build({ ...validBuyInput, quantity: 0n })).toThrow(SimulationOrderIntentInvalidError);
  });

  it('V: quantity negative', () => {
    expect(() => SimulationOrderIntentDomain.build({ ...validBuyInput, quantity: -100n })).toThrow(SimulationOrderIntentInvalidError);
  });

  it('W: quantity number rejected', () => {
    expect(() => SimulationOrderIntentDomain.build({ ...validBuyInput, quantity: 100 as any })).toThrow(SimulationOrderIntentInvalidError);
  });

  it('X: quantity string rejected', () => {
    expect(() => SimulationOrderIntentDomain.build({ ...validBuyInput, quantity: '100' as any })).toThrow(SimulationOrderIntentInvalidError);
  });

  it('Y: invalid side', () => {
    expect(() => SimulationOrderIntentDomain.build({ ...validBuyInput, side: 'buy' as any })).toThrow(SimulationOrderIntentInvalidError);
  });

  it('Z: invalid orderType', () => {
    expect(() => SimulationOrderIntentDomain.build({ ...validBuyInput, orderType: 'LIMIT' as any })).toThrow(SimulationOrderIntentInvalidError);
  });

  it('AA: invalid sourceDecisionHash', () => {
    expect(() => SimulationOrderIntentDomain.build({ ...validBuyInput, sourceDecisionHash: 'short' })).toThrow(SimulationOrderIntentInvalidError);
  });

  it('AB: uppercase sourceDecisionHash rejected', () => {
    expect(() => SimulationOrderIntentDomain.build({ ...validBuyInput, sourceDecisionHash: 'B'.repeat(64) })).toThrow(SimulationOrderIntentInvalidError);
  });

  it('AC: null input', () => {
    expect(() => SimulationOrderIntentDomain.build(null as any)).toThrow(SimulationOrderIntentInvalidError);
  });

  it('AD: array input', () => {
    expect(() => SimulationOrderIntentDomain.build([] as any)).toThrow(SimulationOrderIntentInvalidError);
  });

  it('AE: non-object input', () => {
    expect(() => SimulationOrderIntentDomain.build('string' as any)).toThrow(SimulationOrderIntentInvalidError);
  });

  it('AF: output Object.freeze', () => {
    const result = SimulationOrderIntentDomain.build(validBuyInput);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('AG: quantity output exactly decimal string', () => {
    const result = SimulationOrderIntentDomain.build(validBuyInput);
    expect(result.quantity).toBe('100');
    expect(typeof result.quantity).toBe('string');
  });

  it('AH: canonical serialized known vector exact', () => {
    const result = SimulationOrderIntentDomain.build(validBuyInput);
    
    const expectedPayload = {
      contractVersion: '1.0',
      orderKind: 'SIMULATION_ORDER_INTENT',
      runBusinessKey: validRunBusinessKey,
      simulationDate: validDate,
      instrumentBusinessKey: validInstrument,
      side: 'BUY',
      quantity: '100',
      orderType: 'MARKET',
      sourceDecisionHash: validSourceDecisionHash,
    };
    const serialized = CanonicalSerializer.serialize(expectedPayload);
    const EXPECTED_SERIALIZED = '{"contractVersion":"1.0","instrumentBusinessKey":"VN|HOSE|VNM|EQUITY|2026-08-01","orderKind":"SIMULATION_ORDER_INTENT","orderType":"MARKET","quantity":"100","runBusinessKey":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","side":"BUY","simulationDate":"2026-08-01","sourceDecisionHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}';
    expect(serialized).toBe(EXPECTED_SERIALIZED);
  });

  it('AI: frozen known-vector intentHash exact', () => {
    const result = SimulationOrderIntentDomain.build(validBuyInput);
    expect(result.intentHash).toBe('f4699f1b21c9c6d99534d4ee01a0454c91705df645adf2a5053be32cf95c433e');
  });

  it('AJ: no mutation of input object', () => {
    const inputCopy = { ...validBuyInput };
    SimulationOrderIntentDomain.build(validBuyInput);
    expect(validBuyInput).toEqual(inputCopy);
  });
});
