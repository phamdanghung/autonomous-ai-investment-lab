import { describe, it, expect } from 'vitest';
import { PortfolioAccountingTransitionDomain, PortfolioAccountingTransitionInvalidError } from '../../../src/domain/portfolio-ledger/PortfolioAccountingTransition';
import { PortfolioLedgerTradeSettlementDomain } from '../../../src/domain/portfolio-ledger/PortfolioLedgerTradeSettlement';
import { CanonicalSerializer } from '../../../src/domain/hashing/CanonicalSerializer';

describe('PortfolioAccountingTransitionDomain', () => {
  const ledgerGenesisHash = '4c601fe4c007eb9faac1df91fb0a46c3c319b4026e757f56de16825891f39fdb';
  
  const validBuySettlement = PortfolioLedgerTradeSettlementDomain.build({
    sourceExecutionHash: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    instrumentBusinessKey: 'VN|HOSE|HPG|EQUITY|2025-01-01',
    quantityDelta: 100n,
    grossCashDeltaVnd: -2500000n,
    feeVnd: 3750n,
    taxVnd: 0n
  });

  const validSellSettlement = PortfolioLedgerTradeSettlementDomain.build({
    sourceExecutionHash: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    instrumentBusinessKey: 'VN|HOSE|HPG|EQUITY|2025-01-01',
    quantityDelta: -50n,
    grossCashDeltaVnd: 1250000n,
    feeVnd: 1875n,
    taxVnd: 0n
  });

  const expectedFixedPayload = '{"cashBalanceAfterVnd":"7496250","cashBalanceBeforeVnd":"10000000","cashDeltaVnd":"-2503750","contractVersion":"1.0","instrumentBusinessKey":"VN|HOSE|HPG|EQUITY|2025-01-01","ledgerGenesisHash":"4c601fe4c007eb9faac1df91fb0a46c3c319b4026e757f56de16825891f39fdb","positionQuantityAfter":"100","positionQuantityBefore":"0","quantityDelta":"100","settlementPayloadHash":"04e5afc80d09798b010cf14dfe628e9393061716891813be2c6868756c5e777c","side":"BUY","transitionKind":"TRADE_SETTLEMENT_APPLIED"}';

  const validBuyInput = {
    ledgerGenesisHash,
    cashBalanceBeforeVnd: 10000000n,
    positionQuantityBefore: 0n,
    settlement: validBuySettlement
  };

  let fixedTransitionHash = '';

  it('A valid BUY exact output', () => {
    const result = PortfolioAccountingTransitionDomain.apply(validBuyInput);
    expect(result.contractVersion).toBe('1.0');
    expect(result.transitionKind).toBe('TRADE_SETTLEMENT_APPLIED');
    expect(result.ledgerGenesisHash).toBe(ledgerGenesisHash);
    expect(result.settlementPayloadHash).toBe('04e5afc80d09798b010cf14dfe628e9393061716891813be2c6868756c5e777c');
    expect(result.instrumentBusinessKey).toBe('VN|HOSE|HPG|EQUITY|2025-01-01');
    expect(result.side).toBe('BUY');
    expect(result.cashBalanceBeforeVnd).toBe('10000000');
    expect(result.cashDeltaVnd).toBe('-2503750');
    expect(result.cashBalanceAfterVnd).toBe('7496250');
    expect(result.positionQuantityBefore).toBe('0');
    expect(result.quantityDelta).toBe('100');
    expect(result.positionQuantityAfter).toBe('100');
    expect(result.transitionHash).toHaveLength(64);
  });

  it('B exact canonical serialized vector', () => {
    const result = PortfolioAccountingTransitionDomain.apply(validBuyInput);
    const payload = {
      contractVersion: result.contractVersion,
      transitionKind: result.transitionKind,
      ledgerGenesisHash: result.ledgerGenesisHash,
      settlementPayloadHash: result.settlementPayloadHash,
      instrumentBusinessKey: result.instrumentBusinessKey,
      side: result.side,
      cashBalanceBeforeVnd: result.cashBalanceBeforeVnd,
      cashDeltaVnd: result.cashDeltaVnd,
      cashBalanceAfterVnd: result.cashBalanceAfterVnd,
      positionQuantityBefore: result.positionQuantityBefore,
      quantityDelta: result.quantityDelta,
      positionQuantityAfter: result.positionQuantityAfter
    };
    const serialized = CanonicalSerializer.serialize(payload);
    expect(serialized).toBe(expectedFixedPayload);
  });

  it('C fixed transitionHash vector', () => {
    const result = PortfolioAccountingTransitionDomain.apply(validBuyInput);
    fixedTransitionHash = result.transitionHash;
    console.log('Calculated fixed transitionHash:', fixedTransitionHash);
    expect(fixedTransitionHash).toBe('c03b7fe9b1d09592d0cac6bab7f0f69ffa8c59cccd5816ab01335ad7b7cabf88');
  });

  it('D BUY cash decreases', () => {
    const result = PortfolioAccountingTransitionDomain.apply(validBuyInput);
    expect(BigInt(result.cashBalanceAfterVnd) < BigInt(result.cashBalanceBeforeVnd)).toBe(true);
  });

  it('E BUY position increases', () => {
    const result = PortfolioAccountingTransitionDomain.apply(validBuyInput);
    expect(BigInt(result.positionQuantityAfter) > BigInt(result.positionQuantityBefore)).toBe(true);
  });

  it('F valid SELL cash increases', () => {
    const result = PortfolioAccountingTransitionDomain.apply({
      ledgerGenesisHash,
      cashBalanceBeforeVnd: 0n,
      positionQuantityBefore: 100n,
      settlement: validSellSettlement
    });
    expect(BigInt(result.cashBalanceAfterVnd) > BigInt(result.cashBalanceBeforeVnd)).toBe(true);
  });

  it('G valid SELL position decreases', () => {
    const result = PortfolioAccountingTransitionDomain.apply({
      ledgerGenesisHash,
      cashBalanceBeforeVnd: 0n,
      positionQuantityBefore: 100n,
      settlement: validSellSettlement
    });
    expect(BigInt(result.positionQuantityAfter) < BigInt(result.positionQuantityBefore)).toBe(true);
  });

  it('H zero cash before accepted when settlement increases cash', () => {
    const result = PortfolioAccountingTransitionDomain.apply({
      ledgerGenesisHash,
      cashBalanceBeforeVnd: 0n,
      positionQuantityBefore: 100n,
      settlement: validSellSettlement
    });
    expect(result.cashBalanceBeforeVnd).toBe('0');
  });

  it('I zero position before accepted for BUY', () => {
    const result = PortfolioAccountingTransitionDomain.apply(validBuyInput);
    expect(result.positionQuantityBefore).toBe('0');
  });

  it('J negative cash before rejected', () => {
    expect(() => PortfolioAccountingTransitionDomain.apply({ ...validBuyInput, cashBalanceBeforeVnd: -1n })).toThrow(PortfolioAccountingTransitionInvalidError);
  });

  it('K number cash rejected', () => {
    expect(() => PortfolioAccountingTransitionDomain.apply({ ...validBuyInput, cashBalanceBeforeVnd: 10000000 as any })).toThrow(PortfolioAccountingTransitionInvalidError);
  });

  it('L negative position before rejected', () => {
    expect(() => PortfolioAccountingTransitionDomain.apply({ ...validBuyInput, positionQuantityBefore: -1n })).toThrow(PortfolioAccountingTransitionInvalidError);
  });

  it('M number position rejected', () => {
    expect(() => PortfolioAccountingTransitionDomain.apply({ ...validBuyInput, positionQuantityBefore: 10 as any })).toThrow(PortfolioAccountingTransitionInvalidError);
  });

  it('N insufficient cash rejected', () => {
    expect(() => PortfolioAccountingTransitionDomain.apply({ ...validBuyInput, cashBalanceBeforeVnd: 1000000n })).toThrow(PortfolioAccountingTransitionInvalidError);
  });

  it('O exact cash consumption accepted', () => {
    const result = PortfolioAccountingTransitionDomain.apply({ ...validBuyInput, cashBalanceBeforeVnd: 2503750n });
    expect(result.cashBalanceAfterVnd).toBe('0');
  });

  it('P oversell rejected', () => {
    expect(() => PortfolioAccountingTransitionDomain.apply({
      ledgerGenesisHash,
      cashBalanceBeforeVnd: 0n,
      positionQuantityBefore: 10n,
      settlement: validSellSettlement
    })).toThrow(PortfolioAccountingTransitionInvalidError);
  });

  it('Q sell entire position accepted', () => {
    const result = PortfolioAccountingTransitionDomain.apply({
      ledgerGenesisHash,
      cashBalanceBeforeVnd: 0n,
      positionQuantityBefore: 50n,
      settlement: validSellSettlement
    });
    expect(result.positionQuantityAfter).toBe('0');
  });

  it('R malformed genesis hash rejected', () => {
    expect(() => PortfolioAccountingTransitionDomain.apply({ ...validBuyInput, ledgerGenesisHash: 'short' })).toThrow(PortfolioAccountingTransitionInvalidError);
  });

  it('S uppercase genesis hash rejected', () => {
    expect(() => PortfolioAccountingTransitionDomain.apply({ ...validBuyInput, ledgerGenesisHash: ledgerGenesisHash.toUpperCase() })).toThrow(PortfolioAccountingTransitionInvalidError);
  });

  it('T null input rejected', () => {
    expect(() => PortfolioAccountingTransitionDomain.apply(null as any)).toThrow(PortfolioAccountingTransitionInvalidError);
  });

  it('U undefined input rejected', () => {
    expect(() => PortfolioAccountingTransitionDomain.apply(undefined as any)).toThrow(PortfolioAccountingTransitionInvalidError);
  });

  it('V primitive rejected', () => {
    expect(() => PortfolioAccountingTransitionDomain.apply('string' as any)).toThrow(PortfolioAccountingTransitionInvalidError);
  });

  it('W array rejected', () => {
    expect(() => PortfolioAccountingTransitionDomain.apply([] as any)).toThrow(PortfolioAccountingTransitionInvalidError);
  });

  it('X null settlement rejected', () => {
    expect(() => PortfolioAccountingTransitionDomain.apply({ ...validBuyInput, settlement: null as any })).toThrow(PortfolioAccountingTransitionInvalidError);
  });

  it('Y forged settlement side rejected', () => {
    const forged = { ...validBuySettlement, side: 'SELL' };
    expect(() => PortfolioAccountingTransitionDomain.apply({ ...validBuyInput, settlement: forged as any })).toThrow(PortfolioAccountingTransitionInvalidError);
  });

  it('Z forged settlement net cash rejected', () => {
    const forged = { ...validBuySettlement, netCashDeltaVnd: '999' };
    expect(() => PortfolioAccountingTransitionDomain.apply({ ...validBuyInput, settlement: forged as any })).toThrow(PortfolioAccountingTransitionInvalidError);
  });

  it('AA forged settlement payloadHash rejected', () => {
    const forged = { ...validBuySettlement, payloadHash: 'fake' };
    expect(() => PortfolioAccountingTransitionDomain.apply({ ...validBuyInput, settlement: forged as any })).toThrow(PortfolioAccountingTransitionInvalidError);
  });

  it('AB forged settlement quantity rejected', () => {
    const forged = { ...validBuySettlement, quantityDelta: '999' };
    expect(() => PortfolioAccountingTransitionDomain.apply({ ...validBuyInput, settlement: forged as any })).toThrow(PortfolioAccountingTransitionInvalidError);
  });

  it('AC forged settlement fee rejected', () => {
    const forged = { ...validBuySettlement, feeVnd: '999' };
    expect(() => PortfolioAccountingTransitionDomain.apply({ ...validBuyInput, settlement: forged as any })).toThrow(PortfolioAccountingTransitionInvalidError);
  });

  it('AD forged instrument key rejected', () => {
    const forged = { ...validBuySettlement, instrumentBusinessKey: 'VN|HOSE|VNM|EQUITY|2025-01-01' };
    expect(() => PortfolioAccountingTransitionDomain.apply({ ...validBuyInput, settlement: forged as any })).toThrow(PortfolioAccountingTransitionInvalidError);
  });

  it('AE malformed quantity canonical string rejected', () => {
    const forged = { ...validBuySettlement, quantityDelta: '+100' };
    expect(() => PortfolioAccountingTransitionDomain.apply({ ...validBuyInput, settlement: forged as any })).toThrow(PortfolioAccountingTransitionInvalidError);
  });

  it('AF quantity leading-zero string rejected', () => {
    const forged = { ...validBuySettlement, quantityDelta: '0100' };
    expect(() => PortfolioAccountingTransitionDomain.apply({ ...validBuyInput, settlement: forged as any })).toThrow(PortfolioAccountingTransitionInvalidError);
  });

  it('AG fee leading-zero string rejected', () => {
    const forged = { ...validBuySettlement, feeVnd: '03750' };
    expect(() => PortfolioAccountingTransitionDomain.apply({ ...validBuyInput, settlement: forged as any })).toThrow(PortfolioAccountingTransitionInvalidError);
  });

  it('AH scientific notation rejected', () => {
    const forged = { ...validBuySettlement, grossCashDeltaVnd: '-2.5e6' };
    expect(() => PortfolioAccountingTransitionDomain.apply({ ...validBuyInput, settlement: forged as any })).toThrow(PortfolioAccountingTransitionInvalidError);
  });

  it('AI repeated build deterministic', () => {
    const result1 = PortfolioAccountingTransitionDomain.apply(validBuyInput);
    const result2 = PortfolioAccountingTransitionDomain.apply(validBuyInput);
    expect(result1).toEqual(result2);
  });

  it('AJ input not mutated', () => {
    const input = { ...validBuyInput };
    PortfolioAccountingTransitionDomain.apply(input);
    expect(input).toEqual(validBuyInput);
  });

  it('AK settlement not mutated', () => {
    const settl = { ...validBuySettlement };
    PortfolioAccountingTransitionDomain.apply({ ...validBuyInput, settlement: settl });
    expect(settl).toEqual(validBuySettlement);
  });

  it('AL output frozen', () => {
    const result = PortfolioAccountingTransitionDomain.apply(validBuyInput);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('AM runtime cash-after override ignored', () => {
    const result = PortfolioAccountingTransitionDomain.apply({ ...validBuyInput, cashBalanceAfterVnd: '999' } as any);
    expect(result.cashBalanceAfterVnd).toBe('7496250');
  });

  it('AN runtime position-after override ignored', () => {
    const result = PortfolioAccountingTransitionDomain.apply({ ...validBuyInput, positionQuantityAfter: '999' } as any);
    expect(result.positionQuantityAfter).toBe('100');
  });

  it('AO runtime transitionHash override ignored', () => {
    const result = PortfolioAccountingTransitionDomain.apply({ ...validBuyInput, transitionHash: 'fake' } as any);
    expect(result.transitionHash).toBe('c03b7fe9b1d09592d0cac6bab7f0f69ffa8c59cccd5816ab01335ad7b7cabf88');
  });

  it('AP runtime transitionKind override ignored', () => {
    const result = PortfolioAccountingTransitionDomain.apply({ ...validBuyInput, transitionKind: 'EVIL' } as any);
    expect(result.transitionKind).toBe('TRADE_SETTLEMENT_APPLIED');
  });

  it('AQ different genesis changes hash', () => {
    const result1 = PortfolioAccountingTransitionDomain.apply(validBuyInput);
    const result2 = PortfolioAccountingTransitionDomain.apply({ ...validBuyInput, ledgerGenesisHash: 'f' + ledgerGenesisHash.substring(1) });
    expect(result1.transitionHash).not.toBe(result2.transitionHash);
  });

  it('AR different valid cash-before changes hash', () => {
    const result1 = PortfolioAccountingTransitionDomain.apply(validBuyInput);
    const result2 = PortfolioAccountingTransitionDomain.apply({ ...validBuyInput, cashBalanceBeforeVnd: 20000000n });
    expect(result1.transitionHash).not.toBe(result2.transitionHash);
  });

  it('AS different valid position-before changes hash', () => {
    const result1 = PortfolioAccountingTransitionDomain.apply(validBuyInput);
    const result2 = PortfolioAccountingTransitionDomain.apply({ ...validBuyInput, positionQuantityBefore: 10n });
    expect(result1.transitionHash).not.toBe(result2.transitionHash);
  });

  it('AT different valid settlement changes hash', () => {
    const result1 = PortfolioAccountingTransitionDomain.apply(validBuyInput);
    
    const anotherSettlement = PortfolioLedgerTradeSettlementDomain.build({
      sourceExecutionHash: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      instrumentBusinessKey: 'VN|HOSE|VNM|EQUITY|2025-01-01',
      quantityDelta: 100n,
      grossCashDeltaVnd: -2500000n,
      feeVnd: 3750n,
      taxVnd: 0n
    });

    const result2 = PortfolioAccountingTransitionDomain.apply({ ...validBuyInput, settlement: anotherSettlement });
    expect(result1.transitionHash).not.toBe(result2.transitionHash);
  });

  it('AU exact output keys', () => {
    const result = PortfolioAccountingTransitionDomain.apply({ ...validBuyInput, evil: 'evil' } as any);
    const keys = Object.keys(result);
    expect(keys).toHaveLength(13);
    expect(keys).toContain('contractVersion');
    expect(keys).toContain('transitionKind');
    expect(keys).toContain('ledgerGenesisHash');
    expect(keys).toContain('settlementPayloadHash');
    expect(keys).toContain('instrumentBusinessKey');
    expect(keys).toContain('side');
    expect(keys).toContain('cashBalanceBeforeVnd');
    expect(keys).toContain('cashDeltaVnd');
    expect(keys).toContain('cashBalanceAfterVnd');
    expect(keys).toContain('positionQuantityBefore');
    expect(keys).toContain('quantityDelta');
    expect(keys).toContain('positionQuantityAfter');
    expect(keys).toContain('transitionHash');
  });

  it('AV error message/code/name exact', () => {
    const error = new PortfolioAccountingTransitionInvalidError();
    expect(error.message).toBe('Portfolio accounting transition is invalid.');
    expect(error.code).toBe('PORTFOLIO_ACCOUNTING_TRANSITION_INVALID');
    expect(error.name).toBe('PortfolioAccountingTransitionInvalidError');
  });
});
