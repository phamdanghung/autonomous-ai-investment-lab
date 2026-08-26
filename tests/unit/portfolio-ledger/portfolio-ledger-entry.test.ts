import { describe, it, expect } from 'vitest';
import { PortfolioLedgerEntryDomain, PortfolioLedgerEntryInvalidError } from '../../../src/domain/portfolio-ledger/PortfolioLedgerEntry';
import { CanonicalSerializer } from '../../../src/domain/hashing/CanonicalSerializer';

describe('PortfolioLedgerEntryDomain', () => {
  const validGenesisHash = '4c601fe4c007eb9faac1df91fb0a46c3c319b4026e757f56de16825891f39fdb';
  const validPayloadHash = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const validPreviousHash = '4c601fe4c007eb9faac1df91fb0a46c3c319b4026e757f56de16825891f39fdb';
  const expectedHash = '33d3e892ae814337d7aeff40aee112d54e658922602532e9649420861cb9f739';

  const validInput = {
    ledgerGenesisHash: validGenesisHash,
    entrySequence: 1,
    effectiveDate: '2025-01-15',
    payloadHash: validPayloadHash,
    previousHash: validPreviousHash
  };

  it('A valid first entry', () => {
    const result = PortfolioLedgerEntryDomain.build(validInput);
    expect(result.contractVersion).toBe('1.0');
    expect(result.entryType).toBe('POSTING');
    expect(result.ledgerGenesisHash).toBe(validGenesisHash);
    expect(result.entrySequence).toBe(1);
    expect(result.effectiveDate).toBe('2025-01-15');
    expect(result.payloadHash).toBe(validPayloadHash);
    expect(result.previousHash).toBe(validPreviousHash);
    expect(result.entryHash).toBe(expectedHash);
  });

  it('B exact canonical serialized vector', () => {
    const result = PortfolioLedgerEntryDomain.build(validInput);
    const payload = {
      contractVersion: result.contractVersion,
      entryType: result.entryType,
      ledgerGenesisHash: result.ledgerGenesisHash,
      entrySequence: result.entrySequence,
      effectiveDate: result.effectiveDate,
      payloadHash: result.payloadHash,
      previousHash: result.previousHash
    };
    const serialized = CanonicalSerializer.serialize(payload);
    expect(serialized).toBe('{"contractVersion":"1.0","effectiveDate":"2025-01-15","entrySequence":1,"entryType":"POSTING","ledgerGenesisHash":"4c601fe4c007eb9faac1df91fb0a46c3c319b4026e757f56de16825891f39fdb","payloadHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","previousHash":"4c601fe4c007eb9faac1df91fb0a46c3c319b4026e757f56de16825891f39fdb"}');
  });

  it('C fixed entryHash vector', () => {
    const result = PortfolioLedgerEntryDomain.build(validInput);
    expect(result.entryHash).toBe(expectedHash);
  });

  it('D entrySequence 1 anchors to genesis', () => {
    const result = PortfolioLedgerEntryDomain.build(validInput);
    expect(result.previousHash).toBe(result.ledgerGenesisHash);
  });

  it('E sequence 1 wrong previousHash rejected', () => {
    expect(() => PortfolioLedgerEntryDomain.build({ ...validInput, previousHash: validPayloadHash })).toThrow(PortfolioLedgerEntryInvalidError);
  });

  it('F sequence 2 with non-genesis previousHash accepted', () => {
    const result = PortfolioLedgerEntryDomain.build({ ...validInput, entrySequence: 2, previousHash: validPayloadHash });
    expect(result.entrySequence).toBe(2);
    expect(result.previousHash).toBe(validPayloadHash);
  });

  it('G sequence >1 pointing directly to genesis rejected', () => {
    expect(() => PortfolioLedgerEntryDomain.build({ ...validInput, entrySequence: 2, previousHash: validGenesisHash })).toThrow(PortfolioLedgerEntryInvalidError);
  });

  it('H zero sequence rejected', () => {
    expect(() => PortfolioLedgerEntryDomain.build({ ...validInput, entrySequence: 0 })).toThrow(PortfolioLedgerEntryInvalidError);
  });

  it('I negative sequence rejected', () => {
    expect(() => PortfolioLedgerEntryDomain.build({ ...validInput, entrySequence: -1 })).toThrow(PortfolioLedgerEntryInvalidError);
  });

  it('J fractional sequence rejected', () => {
    expect(() => PortfolioLedgerEntryDomain.build({ ...validInput, entrySequence: 1.5 })).toThrow(PortfolioLedgerEntryInvalidError);
  });

  it('K NaN rejected', () => {
    expect(() => PortfolioLedgerEntryDomain.build({ ...validInput, entrySequence: NaN })).toThrow(PortfolioLedgerEntryInvalidError);
  });

  it('L Infinity rejected', () => {
    expect(() => PortfolioLedgerEntryDomain.build({ ...validInput, entrySequence: Infinity })).toThrow(PortfolioLedgerEntryInvalidError);
  });

  it('M unsafe integer rejected', () => {
    expect(() => PortfolioLedgerEntryDomain.build({ ...validInput, entrySequence: Number.MAX_SAFE_INTEGER + 1 })).toThrow(PortfolioLedgerEntryInvalidError);
  });

  it('N string sequence rejected', () => {
    expect(() => PortfolioLedgerEntryDomain.build({ ...validInput, entrySequence: '1' as any })).toThrow(PortfolioLedgerEntryInvalidError);
  });

  it('O bigint sequence rejected', () => {
    expect(() => PortfolioLedgerEntryDomain.build({ ...validInput, entrySequence: 1n as any })).toThrow(PortfolioLedgerEntryInvalidError);
  });

  it('P malformed ledgerGenesisHash rejected', () => {
    expect(() => PortfolioLedgerEntryDomain.build({ ...validInput, ledgerGenesisHash: 'abc' })).toThrow(PortfolioLedgerEntryInvalidError);
  });

  it('Q uppercase ledgerGenesisHash rejected', () => {
    expect(() => PortfolioLedgerEntryDomain.build({ ...validInput, ledgerGenesisHash: validGenesisHash.toUpperCase() })).toThrow(PortfolioLedgerEntryInvalidError);
  });

  it('R malformed payloadHash rejected', () => {
    expect(() => PortfolioLedgerEntryDomain.build({ ...validInput, payloadHash: 'abc' })).toThrow(PortfolioLedgerEntryInvalidError);
  });

  it('S uppercase payloadHash rejected', () => {
    expect(() => PortfolioLedgerEntryDomain.build({ ...validInput, payloadHash: validPayloadHash.toUpperCase() })).toThrow(PortfolioLedgerEntryInvalidError);
  });

  it('T malformed previousHash rejected', () => {
    expect(() => PortfolioLedgerEntryDomain.build({ ...validInput, previousHash: 'abc' })).toThrow(PortfolioLedgerEntryInvalidError);
  });

  it('U uppercase previousHash rejected', () => {
    expect(() => PortfolioLedgerEntryDomain.build({ ...validInput, previousHash: validPreviousHash.toUpperCase() })).toThrow(PortfolioLedgerEntryInvalidError);
  });

  it('V malformed date rejected', () => {
    expect(() => PortfolioLedgerEntryDomain.build({ ...validInput, effectiveDate: '2025-1-15' })).toThrow(PortfolioLedgerEntryInvalidError);
  });

  it('W impossible date rejected', () => {
    expect(() => PortfolioLedgerEntryDomain.build({ ...validInput, effectiveDate: '2025-02-30' })).toThrow(PortfolioLedgerEntryInvalidError);
  });

  it('X timestamp date rejected', () => {
    expect(() => PortfolioLedgerEntryDomain.build({ ...validInput, effectiveDate: '2025-01-15T00:00:00Z' })).toThrow(PortfolioLedgerEntryInvalidError);
  });

  it('Y null input rejected', () => {
    expect(() => PortfolioLedgerEntryDomain.build(null as any)).toThrow(PortfolioLedgerEntryInvalidError);
  });

  it('Z undefined input rejected', () => {
    expect(() => PortfolioLedgerEntryDomain.build(undefined as any)).toThrow(PortfolioLedgerEntryInvalidError);
  });

  it('AA primitive rejected', () => {
    expect(() => PortfolioLedgerEntryDomain.build('string' as any)).toThrow(PortfolioLedgerEntryInvalidError);
  });

  it('AB array rejected', () => {
    expect(() => PortfolioLedgerEntryDomain.build([] as any)).toThrow(PortfolioLedgerEntryInvalidError);
  });

  it('AC deterministic repeated build', () => {
    const result1 = PortfolioLedgerEntryDomain.build(validInput);
    const result2 = PortfolioLedgerEntryDomain.build(validInput);
    expect(result1).toEqual(result2);
    expect(result1.entryHash).toBe(result2.entryHash);
  });

  it('AD input not mutated', () => {
    const input = { ...validInput };
    PortfolioLedgerEntryDomain.build(input);
    expect(input).toEqual(validInput);
  });

  it('AE output frozen', () => {
    const result = PortfolioLedgerEntryDomain.build(validInput);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('AF runtime entryHash override ignored', () => {
    const result = PortfolioLedgerEntryDomain.build({ ...validInput, entryHash: 'fake' } as any);
    expect(result.entryHash).toBe(expectedHash);
  });

  it('AG runtime contractVersion override ignored', () => {
    const result = PortfolioLedgerEntryDomain.build({ ...validInput, contractVersion: '999' } as any);
    expect(result.contractVersion).toBe('1.0');
  });

  it('AH runtime entryType override ignored', () => {
    const result = PortfolioLedgerEntryDomain.build({ ...validInput, entryType: 'EVIL' } as any);
    expect(result.entryType).toBe('POSTING');
  });

  it('AI different ledgerGenesisHash changes hash', () => {
    const result1 = PortfolioLedgerEntryDomain.build(validInput);
    const newGenesisHash = 'b' + validGenesisHash.substring(1);
    const result2 = PortfolioLedgerEntryDomain.build({ ...validInput, ledgerGenesisHash: newGenesisHash, previousHash: newGenesisHash });
    expect(result1.entryHash).not.toBe(result2.entryHash);
  });

  it('AJ different sequence changes hash', () => {
    const result1 = PortfolioLedgerEntryDomain.build({ ...validInput, entrySequence: 2, previousHash: validPayloadHash });
    const result2 = PortfolioLedgerEntryDomain.build({ ...validInput, entrySequence: 3, previousHash: validPayloadHash });
    expect(result1.entryHash).not.toBe(result2.entryHash);
  });

  it('AK different effectiveDate changes hash', () => {
    const result1 = PortfolioLedgerEntryDomain.build(validInput);
    const result2 = PortfolioLedgerEntryDomain.build({ ...validInput, effectiveDate: '2025-01-16' });
    expect(result1.entryHash).not.toBe(result2.entryHash);
  });

  it('AL different payloadHash changes hash', () => {
    const result1 = PortfolioLedgerEntryDomain.build(validInput);
    const newPayloadHash = 'c' + validPayloadHash.substring(1);
    const result2 = PortfolioLedgerEntryDomain.build({ ...validInput, payloadHash: newPayloadHash });
    expect(result1.entryHash).not.toBe(result2.entryHash);
  });

  it('AM different previousHash changes hash', () => {
    const result1 = PortfolioLedgerEntryDomain.build({ ...validInput, entrySequence: 2, previousHash: validPayloadHash });
    const newPrevHash = 'c' + validPayloadHash.substring(1);
    const result2 = PortfolioLedgerEntryDomain.build({ ...validInput, entrySequence: 2, previousHash: newPrevHash });
    expect(result1.entryHash).not.toBe(result2.entryHash);
  });

  it('AN exact output keys', () => {
    const result = PortfolioLedgerEntryDomain.build({ ...validInput, extraField: 'evil' } as any);
    const keys = Object.keys(result);
    expect(keys).toHaveLength(8);
    expect(keys).toContain('contractVersion');
    expect(keys).toContain('entryType');
    expect(keys).toContain('ledgerGenesisHash');
    expect(keys).toContain('entrySequence');
    expect(keys).toContain('effectiveDate');
    expect(keys).toContain('payloadHash');
    expect(keys).toContain('previousHash');
    expect(keys).toContain('entryHash');
  });

  it('AO error message/code/name exact', () => {
    const error = new PortfolioLedgerEntryInvalidError();
    expect(error.message).toBe('Portfolio ledger entry is invalid.');
    expect(error.code).toBe('PORTFOLIO_LEDGER_ENTRY_INVALID');
    expect(error.name).toBe('PortfolioLedgerEntryInvalidError');
    expect(error).toBeInstanceOf(PortfolioLedgerEntryInvalidError);
  });
});
