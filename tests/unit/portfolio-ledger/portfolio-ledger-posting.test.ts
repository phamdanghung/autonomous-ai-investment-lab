import { describe, it, expect } from 'vitest';
import { PortfolioLedgerPostingDomain, PortfolioLedgerPostingInvalidError } from '../../../src/domain/portfolio-ledger/PortfolioLedgerPosting';
import { PortfolioLedgerTradeSettlementDomain } from '../../../src/domain/portfolio-ledger/PortfolioLedgerTradeSettlement';
import { CanonicalSerializer } from '../../../src/domain/hashing/CanonicalSerializer';

describe('PortfolioLedgerPostingDomain', () => {
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

  const validFirstInput = {
    ledgerGenesisHash,
    entrySequence: 1,
    effectiveDate: '2025-01-15',
    previousHash: ledgerGenesisHash,
    cashBalanceBeforeVnd: 10000000n,
    positionQuantityBefore: 0n,
    settlement: validBuySettlement
  };

  const expectedTransitionHash = 'c03b7fe9b1d09592d0cac6bab7f0f69ffa8c59cccd5816ab01335ad7b7cabf88';
  const expectedLedgerPayloadStr = '{"contractVersion":"1.0","effectiveDate":"2025-01-15","entrySequence":1,"entryType":"POSTING","ledgerGenesisHash":"4c601fe4c007eb9faac1df91fb0a46c3c319b4026e757f56de16825891f39fdb","payloadHash":"c03b7fe9b1d09592d0cac6bab7f0f69ffa8c59cccd5816ab01335ad7b7cabf88","previousHash":"4c601fe4c007eb9faac1df91fb0a46c3c319b4026e757f56de16825891f39fdb"}';
  
  let actualEntryHash = '';

  it('A valid first posting', () => {
    const result = PortfolioLedgerPostingDomain.compose(validFirstInput);
    expect(result.transition).toBeDefined();
    expect(result.entry).toBeDefined();
  });

  it('B transition fixed hash exact', () => {
    const result = PortfolioLedgerPostingDomain.compose(validFirstInput);
    expect(result.transition.transitionHash).toBe(expectedTransitionHash);
  });

  it('C entry uses transitionHash as payloadHash', () => {
    const result = PortfolioLedgerPostingDomain.compose(validFirstInput);
    expect(result.entry.payloadHash).toBe(result.transition.transitionHash);
  });

  it('D entry does NOT directly use settlement payloadHash', () => {
    const result = PortfolioLedgerPostingDomain.compose(validFirstInput);
    expect(result.entry.payloadHash).not.toBe(validBuySettlement.payloadHash);
  });

  it('E fixed LedgerEntry canonical serialization exact', () => {
    const result = PortfolioLedgerPostingDomain.compose(validFirstInput);
    const entryPayload = {
      contractVersion: result.entry.contractVersion,
      effectiveDate: result.entry.effectiveDate,
      entrySequence: result.entry.entrySequence,
      entryType: result.entry.entryType,
      ledgerGenesisHash: result.entry.ledgerGenesisHash,
      payloadHash: result.entry.payloadHash,
      previousHash: result.entry.previousHash
    };
    expect(CanonicalSerializer.serialize(entryPayload)).toBe(expectedLedgerPayloadStr);
  });

  it('F fixed entryHash exact', () => {
    const result = PortfolioLedgerPostingDomain.compose(validFirstInput);
    actualEntryHash = result.entry.entryHash;
    console.log('actualEntryHash:', actualEntryHash);
    expect(result.entry.entryHash).toBe('8e1b42c8e1393558a508c024c3be8cc63e9b0473ff53ea7b3bdd9c0d941cdca4');
  });

  it('G first entry anchors genesis', () => {
    const result = PortfolioLedgerPostingDomain.compose(validFirstInput);
    expect(result.entry.entrySequence).toBe(1);
    expect(result.entry.previousHash).toBe(ledgerGenesisHash);
  });

  it('H valid second posting accepted', () => {
    const first = PortfolioLedgerPostingDomain.compose(validFirstInput);
    const result = PortfolioLedgerPostingDomain.compose({
      ledgerGenesisHash,
      entrySequence: 2,
      effectiveDate: '2025-01-16',
      previousHash: first.entry.entryHash,
      cashBalanceBeforeVnd: BigInt(first.transition.cashBalanceAfterVnd),
      positionQuantityBefore: BigInt(first.transition.positionQuantityAfter),
      settlement: validSellSettlement
    });
    expect(result.entry.entrySequence).toBe(2);
  });

  it('I second previousHash equals first entryHash', () => {
    const first = PortfolioLedgerPostingDomain.compose(validFirstInput);
    const result = PortfolioLedgerPostingDomain.compose({
      ledgerGenesisHash,
      entrySequence: 2,
      effectiveDate: '2025-01-16',
      previousHash: first.entry.entryHash,
      cashBalanceBeforeVnd: BigInt(first.transition.cashBalanceAfterVnd),
      positionQuantityBefore: BigInt(first.transition.positionQuantityAfter),
      settlement: validSellSettlement
    });
    expect(result.entry.previousHash).toBe(first.entry.entryHash);
  });

  it('J second entry sequence equals 2', () => {
    const first = PortfolioLedgerPostingDomain.compose(validFirstInput);
    const result = PortfolioLedgerPostingDomain.compose({
      ledgerGenesisHash,
      entrySequence: 2,
      effectiveDate: '2025-01-16',
      previousHash: first.entry.entryHash,
      cashBalanceBeforeVnd: BigInt(first.transition.cashBalanceAfterVnd),
      positionQuantityBefore: BigInt(first.transition.positionQuantityAfter),
      settlement: validSellSettlement
    });
    expect(result.entry.entrySequence).toBe(2);
  });

  it('K second entry pointing genesis rejected', () => {
    const first = PortfolioLedgerPostingDomain.compose(validFirstInput);
    expect(() => PortfolioLedgerPostingDomain.compose({
      ledgerGenesisHash,
      entrySequence: 2,
      effectiveDate: '2025-01-16',
      previousHash: ledgerGenesisHash,
      cashBalanceBeforeVnd: BigInt(first.transition.cashBalanceAfterVnd),
      positionQuantityBefore: BigInt(first.transition.positionQuantityAfter),
      settlement: validSellSettlement
    })).toThrow(PortfolioLedgerPostingInvalidError);
  });

  it('L malformed effectiveDate rejected', () => {
    expect(() => PortfolioLedgerPostingDomain.compose({ ...validFirstInput, effectiveDate: '2025-1-1' })).toThrow(PortfolioLedgerPostingInvalidError);
  });

  it('M impossible effectiveDate rejected', () => {
    expect(() => PortfolioLedgerPostingDomain.compose({ ...validFirstInput, effectiveDate: '2025-13-40' })).toThrow(PortfolioLedgerPostingInvalidError);
  });

  it('N timestamp effectiveDate rejected', () => {
    expect(() => PortfolioLedgerPostingDomain.compose({ ...validFirstInput, effectiveDate: '2025-01-01T00:00:00Z' })).toThrow(PortfolioLedgerPostingInvalidError);
  });

  it('O insufficient cash rejected', () => {
    expect(() => PortfolioLedgerPostingDomain.compose({ ...validFirstInput, cashBalanceBeforeVnd: 10n })).toThrow(PortfolioLedgerPostingInvalidError);
  });

  it('P oversell rejected', () => {
    expect(() => PortfolioLedgerPostingDomain.compose({ ...validFirstInput, settlement: validSellSettlement, positionQuantityBefore: 10n })).toThrow(PortfolioLedgerPostingInvalidError);
  });

  it('Q exact cash consumption accepted', () => {
    const result = PortfolioLedgerPostingDomain.compose({ ...validFirstInput, cashBalanceBeforeVnd: 2503750n });
    expect(result.transition.cashBalanceAfterVnd).toBe('0');
  });

  it('R sell-entire-position accepted', () => {
    const first = PortfolioLedgerPostingDomain.compose(validFirstInput);
    const result = PortfolioLedgerPostingDomain.compose({
      ledgerGenesisHash,
      entrySequence: 2,
      effectiveDate: '2025-01-16',
      previousHash: first.entry.entryHash,
      cashBalanceBeforeVnd: BigInt(first.transition.cashBalanceAfterVnd),
      positionQuantityBefore: 50n,
      settlement: validSellSettlement
    });
    expect(result.transition.positionQuantityAfter).toBe('0');
  });

  it('S forged settlement side rejected', () => {
    const forged = { ...validBuySettlement, side: 'SELL' };
    expect(() => PortfolioLedgerPostingDomain.compose({ ...validFirstInput, settlement: forged as any })).toThrow(PortfolioLedgerPostingInvalidError);
  });

  it('T forged settlement net cash rejected', () => {
    const forged = { ...validBuySettlement, netCashDeltaVnd: '999' };
    expect(() => PortfolioLedgerPostingDomain.compose({ ...validFirstInput, settlement: forged as any })).toThrow(PortfolioLedgerPostingInvalidError);
  });

  it('U forged settlement hash rejected', () => {
    const forged = { ...validBuySettlement, payloadHash: 'fake' };
    expect(() => PortfolioLedgerPostingDomain.compose({ ...validFirstInput, settlement: forged as any })).toThrow(PortfolioLedgerPostingInvalidError);
  });

  it('V forged settlement quantity rejected', () => {
    const forged = { ...validBuySettlement, quantityDelta: '999' };
    expect(() => PortfolioLedgerPostingDomain.compose({ ...validFirstInput, settlement: forged as any })).toThrow(PortfolioLedgerPostingInvalidError);
  });

  it('W null input rejected', () => {
    expect(() => PortfolioLedgerPostingDomain.compose(null as any)).toThrow(PortfolioLedgerPostingInvalidError);
  });

  it('X undefined input rejected', () => {
    expect(() => PortfolioLedgerPostingDomain.compose(undefined as any)).toThrow(PortfolioLedgerPostingInvalidError);
  });

  it('Y primitive input rejected', () => {
    expect(() => PortfolioLedgerPostingDomain.compose('string' as any)).toThrow(PortfolioLedgerPostingInvalidError);
  });

  it('Z array input rejected', () => {
    expect(() => PortfolioLedgerPostingDomain.compose([] as any)).toThrow(PortfolioLedgerPostingInvalidError);
  });

  it('AA null settlement rejected', () => {
    expect(() => PortfolioLedgerPostingDomain.compose({ ...validFirstInput, settlement: null as any })).toThrow(PortfolioLedgerPostingInvalidError);
  });

  it('AB deterministic repeated compose', () => {
    const res1 = PortfolioLedgerPostingDomain.compose(validFirstInput);
    const res2 = PortfolioLedgerPostingDomain.compose(validFirstInput);
    expect(res1).toEqual(res2);
  });

  it('AC input not mutated', () => {
    const input = { ...validFirstInput };
    PortfolioLedgerPostingDomain.compose(input);
    expect(input).toEqual(validFirstInput);
  });

  it('AD settlement not mutated', () => {
    const settl = { ...validBuySettlement };
    PortfolioLedgerPostingDomain.compose({ ...validFirstInput, settlement: settl });
    expect(settl).toEqual(validBuySettlement);
  });

  it('AE top-level output frozen', () => {
    const result = PortfolioLedgerPostingDomain.compose(validFirstInput);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('AF transition frozen', () => {
    const result = PortfolioLedgerPostingDomain.compose(validFirstInput);
    expect(Object.isFrozen(result.transition)).toBe(true);
  });

  it('AG entry frozen', () => {
    const result = PortfolioLedgerPostingDomain.compose(validFirstInput);
    expect(Object.isFrozen(result.entry)).toBe(true);
  });

  it('AH runtime payloadHash override ignored', () => {
    const result = PortfolioLedgerPostingDomain.compose({ ...validFirstInput, payloadHash: 'evil' } as any);
    expect(result.entry.payloadHash).toBe(result.transition.transitionHash);
  });

  it('AI runtime transitionHash override ignored', () => {
    const result = PortfolioLedgerPostingDomain.compose({ ...validFirstInput, transitionHash: 'evil' } as any);
    expect(result.transition.transitionHash).toBe(expectedTransitionHash);
  });

  it('AJ runtime entryHash override ignored', () => {
    const result = PortfolioLedgerPostingDomain.compose({ ...validFirstInput, entryHash: 'evil' } as any);
    expect(result.entry.entryHash).toBe('8e1b42c8e1393558a508c024c3be8cc63e9b0473ff53ea7b3bdd9c0d941cdca4');
  });

  it('AK runtime after-state overrides ignored', () => {
    const result = PortfolioLedgerPostingDomain.compose({ ...validFirstInput, cashBalanceAfterVnd: 'evil', positionQuantityAfter: 'evil' } as any);
    expect(result.transition.cashBalanceAfterVnd).toBe('7496250');
    expect(result.transition.positionQuantityAfter).toBe('100');
  });

  it('AL runtime transition object override ignored', () => {
    const result = PortfolioLedgerPostingDomain.compose({ ...validFirstInput, transition: { evil: true } } as any);
    expect(result.transition.transitionHash).toBe(expectedTransitionHash);
  });

  it('AM runtime entry object override ignored', () => {
    const result = PortfolioLedgerPostingDomain.compose({ ...validFirstInput, entry: { evil: true } } as any);
    expect(result.entry.entryHash).toBe('8e1b42c8e1393558a508c024c3be8cc63e9b0473ff53ea7b3bdd9c0d941cdca4');
  });

  it('AN different effectiveDate changes entryHash', () => {
    const res1 = PortfolioLedgerPostingDomain.compose(validFirstInput);
    const res2 = PortfolioLedgerPostingDomain.compose({ ...validFirstInput, effectiveDate: '2025-01-16' });
    expect(res1.entry.entryHash).not.toBe(res2.entry.entryHash);
    expect(res1.transition.transitionHash).toBe(res2.transition.transitionHash);
  });

  it('AO different valid cash-before changes transitionHash', () => {
    const res1 = PortfolioLedgerPostingDomain.compose(validFirstInput);
    const res2 = PortfolioLedgerPostingDomain.compose({ ...validFirstInput, cashBalanceBeforeVnd: 20000000n });
    expect(res1.transition.transitionHash).not.toBe(res2.transition.transitionHash);
  });

  it('AP different valid cash-before changes entryHash', () => {
    const res1 = PortfolioLedgerPostingDomain.compose(validFirstInput);
    const res2 = PortfolioLedgerPostingDomain.compose({ ...validFirstInput, cashBalanceBeforeVnd: 20000000n });
    expect(res1.entry.entryHash).not.toBe(res2.entry.entryHash);
  });

  it('AQ different valid position-before changes transitionHash', () => {
    const res1 = PortfolioLedgerPostingDomain.compose(validFirstInput);
    const res2 = PortfolioLedgerPostingDomain.compose({ ...validFirstInput, positionQuantityBefore: 100n });
    expect(res1.transition.transitionHash).not.toBe(res2.transition.transitionHash);
  });

  it('AR different valid position-before changes entryHash', () => {
    const res1 = PortfolioLedgerPostingDomain.compose(validFirstInput);
    const res2 = PortfolioLedgerPostingDomain.compose({ ...validFirstInput, positionQuantityBefore: 100n });
    expect(res1.entry.entryHash).not.toBe(res2.entry.entryHash);
  });

  it('AS different valid settlement changes transitionHash', () => {
    const anotherSettlement = PortfolioLedgerTradeSettlementDomain.build({
      sourceExecutionHash: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      instrumentBusinessKey: 'VN|HOSE|VNM|EQUITY|2025-01-01',
      quantityDelta: 100n,
      grossCashDeltaVnd: -2500000n,
      feeVnd: 3750n,
      taxVnd: 0n
    });
    const res1 = PortfolioLedgerPostingDomain.compose(validFirstInput);
    const res2 = PortfolioLedgerPostingDomain.compose({ ...validFirstInput, settlement: anotherSettlement });
    expect(res1.transition.transitionHash).not.toBe(res2.transition.transitionHash);
  });

  it('AT different valid settlement changes entryHash', () => {
    const anotherSettlement = PortfolioLedgerTradeSettlementDomain.build({
      sourceExecutionHash: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      instrumentBusinessKey: 'VN|HOSE|VNM|EQUITY|2025-01-01',
      quantityDelta: 100n,
      grossCashDeltaVnd: -2500000n,
      feeVnd: 3750n,
      taxVnd: 0n
    });
    const res1 = PortfolioLedgerPostingDomain.compose(validFirstInput);
    const res2 = PortfolioLedgerPostingDomain.compose({ ...validFirstInput, settlement: anotherSettlement });
    expect(res1.entry.entryHash).not.toBe(res2.entry.entryHash);
  });

  it('AU exact top-level output keys', () => {
    const res = PortfolioLedgerPostingDomain.compose(validFirstInput);
    const keys = Object.keys(res);
    expect(keys).toHaveLength(2);
    expect(keys).toContain('transition');
    expect(keys).toContain('entry');
  });

  it('AV exact nested relationship', () => {
    const res = PortfolioLedgerPostingDomain.compose(validFirstInput);
    expect(res.entry.payloadHash).toBe(res.transition.transitionHash);
  });

  it('AW error message/code/name exact', () => {
    const err = new PortfolioLedgerPostingInvalidError();
    expect(err.message).toBe('Portfolio ledger posting is invalid.');
    expect(err.code).toBe('PORTFOLIO_LEDGER_POSTING_INVALID');
    expect(err.name).toBe('PortfolioLedgerPostingInvalidError');
  });
});
