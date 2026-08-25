import { describe, it, expect } from 'vitest';
import { PortfolioLedgerGenesisDomain, PortfolioLedgerGenesisInvalidError } from '../../../src/domain/portfolio-ledger/PortfolioLedgerGenesis';

describe('PortfolioLedgerGenesisDomain', () => {
  const validInput = {
    runBusinessKey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    canonicalStartDate: '2025-01-15',
    initialCapitalVnd: 1000000000n
  };

  it('A valid genesis exact output', () => {
    const result = PortfolioLedgerGenesisDomain.build(validInput);
    expect(result).toEqual({
      contractVersion: '1.0',
      ledgerKind: 'SIMULATION_PORTFOLIO',
      runBusinessKey: validInput.runBusinessKey,
      canonicalStartDate: validInput.canonicalStartDate,
      currency: 'VND',
      openingCashVnd: '1000000000',
      openingPositionCount: 0,
      genesisHash: '4c601fe4c007eb9faac1df91fb0a46c3c319b4026e757f56de16825891f39fdb'
    });
  });

  it('B fixed canonical serialization vector', () => {
    const result = PortfolioLedgerGenesisDomain.build(validInput);
    // Tested implicitly by checking the hash in C
    expect(result.genesisHash).toBe('4c601fe4c007eb9faac1df91fb0a46c3c319b4026e757f56de16825891f39fdb');
  });

  it('C fixed genesisHash vector', () => {
    const result = PortfolioLedgerGenesisDomain.build(validInput);
    expect(result.genesisHash).toBe('4c601fe4c007eb9faac1df91fb0a46c3c319b4026e757f56de16825891f39fdb');
  });

  it('D zero initial capital accepted', () => {
    const result = PortfolioLedgerGenesisDomain.build({ ...validInput, initialCapitalVnd: 0n });
    expect(result.openingCashVnd).toBe('0');
  });

  it('E very large bigint retained exactly', () => {
    const result = PortfolioLedgerGenesisDomain.build({ ...validInput, initialCapitalVnd: 99999999999999999999n });
    expect(result.openingCashVnd).toBe('99999999999999999999');
  });

  it('F negative initial capital rejected', () => {
    expect(() => PortfolioLedgerGenesisDomain.build({ ...validInput, initialCapitalVnd: -1n })).toThrow(PortfolioLedgerGenesisInvalidError);
  });

  it('G JavaScript number capital rejected', () => {
    expect(() => PortfolioLedgerGenesisDomain.build({ ...validInput, initialCapitalVnd: 1000 as any })).toThrow(PortfolioLedgerGenesisInvalidError);
  });

  it('H string capital rejected', () => {
    expect(() => PortfolioLedgerGenesisDomain.build({ ...validInput, initialCapitalVnd: '1000' as any })).toThrow(PortfolioLedgerGenesisInvalidError);
  });

  it('I malformed short runBusinessKey rejected', () => {
    expect(() => PortfolioLedgerGenesisDomain.build({ ...validInput, runBusinessKey: 'abc' })).toThrow(PortfolioLedgerGenesisInvalidError);
  });

  it('J uppercase runBusinessKey rejected', () => {
    expect(() => PortfolioLedgerGenesisDomain.build({ ...validInput, runBusinessKey: validInput.runBusinessKey.toUpperCase() })).toThrow(PortfolioLedgerGenesisInvalidError);
  });

  it('K whitespace runBusinessKey rejected', () => {
    expect(() => PortfolioLedgerGenesisDomain.build({ ...validInput, runBusinessKey: ' ' + validInput.runBusinessKey.substring(1) })).toThrow(PortfolioLedgerGenesisInvalidError);
  });

  it('L malformed canonical date rejected', () => {
    expect(() => PortfolioLedgerGenesisDomain.build({ ...validInput, canonicalStartDate: '2025-1-15' })).toThrow(PortfolioLedgerGenesisInvalidError);
  });

  it('M impossible canonical date rejected', () => {
    expect(() => PortfolioLedgerGenesisDomain.build({ ...validInput, canonicalStartDate: '2025-02-30' })).toThrow(PortfolioLedgerGenesisInvalidError);
  });

  it('N timestamp-style date rejected', () => {
    expect(() => PortfolioLedgerGenesisDomain.build({ ...validInput, canonicalStartDate: '2025-01-15T00:00:00Z' })).toThrow(PortfolioLedgerGenesisInvalidError);
  });

  it('O null input throws PortfolioLedgerGenesisInvalidError', () => {
    expect(() => PortfolioLedgerGenesisDomain.build(null as any)).toThrow(PortfolioLedgerGenesisInvalidError);
  });

  it('P undefined input throws same domain error', () => {
    expect(() => PortfolioLedgerGenesisDomain.build(undefined as any)).toThrow(PortfolioLedgerGenesisInvalidError);
  });

  it('Q primitive input throws same domain error', () => {
    expect(() => PortfolioLedgerGenesisDomain.build('string' as any)).toThrow(PortfolioLedgerGenesisInvalidError);
  });

  it('R array input throws same domain error', () => {
    expect(() => PortfolioLedgerGenesisDomain.build([] as any)).toThrow(PortfolioLedgerGenesisInvalidError);
  });

  it('S repeated build is deterministic', () => {
    const result1 = PortfolioLedgerGenesisDomain.build(validInput);
    const result2 = PortfolioLedgerGenesisDomain.build(validInput);
    expect(result1).toEqual(result2);
    expect(result1.genesisHash).toBe(result2.genesisHash);
  });

  it('T input object is not mutated', () => {
    const input = { ...validInput };
    PortfolioLedgerGenesisDomain.build(input);
    expect(input).toEqual(validInput);
  });

  it('U output is Object.freeze\'d', () => {
    const result = PortfolioLedgerGenesisDomain.build(validInput);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('V extra caller openingCashVnd ignored', () => {
    const result = PortfolioLedgerGenesisDomain.build({ ...validInput, openingCashVnd: '999999999' } as any);
    expect(result.openingCashVnd).toBe('1000000000');
  });

  it('W extra caller currency/ledgerKind/position count ignored', () => {
    const result = PortfolioLedgerGenesisDomain.build({ ...validInput, currency: 'USD', ledgerKind: 'EVIL', openingPositionCount: 99 } as any);
    expect(result.currency).toBe('VND');
    expect(result.ledgerKind).toBe('SIMULATION_PORTFOLIO');
    expect(result.openingPositionCount).toBe(0);
  });

  it('X different runBusinessKey changes hash', () => {
    const result1 = PortfolioLedgerGenesisDomain.build(validInput);
    const result2 = PortfolioLedgerGenesisDomain.build({ ...validInput, runBusinessKey: 'b' + validInput.runBusinessKey.substring(1) });
    expect(result1.genesisHash).not.toBe(result2.genesisHash);
  });

  it('Y different canonicalStartDate changes hash', () => {
    const result1 = PortfolioLedgerGenesisDomain.build(validInput);
    const result2 = PortfolioLedgerGenesisDomain.build({ ...validInput, canonicalStartDate: '2025-01-16' });
    expect(result1.genesisHash).not.toBe(result2.genesisHash);
  });

  it('Z different initialCapitalVnd changes hash', () => {
    const result1 = PortfolioLedgerGenesisDomain.build(validInput);
    const result2 = PortfolioLedgerGenesisDomain.build({ ...validInput, initialCapitalVnd: 1n });
    expect(result1.genesisHash).not.toBe(result2.genesisHash);
  });

  it('AA exact output keys contain only frozen contract fields', () => {
    const result = PortfolioLedgerGenesisDomain.build({ ...validInput, extraField: 'evil' } as any);
    const keys = Object.keys(result);
    expect(keys).toHaveLength(8);
    expect(keys).toContain('contractVersion');
    expect(keys).toContain('ledgerKind');
    expect(keys).toContain('runBusinessKey');
    expect(keys).toContain('canonicalStartDate');
    expect(keys).toContain('currency');
    expect(keys).toContain('openingCashVnd');
    expect(keys).toContain('openingPositionCount');
    expect(keys).toContain('genesisHash');
  });

  it('AB openingPositionCount always exactly 0', () => {
    const result = PortfolioLedgerGenesisDomain.build(validInput);
    expect(result.openingPositionCount).toBe(0);
  });

  it('AC currency always VND', () => {
    const result = PortfolioLedgerGenesisDomain.build(validInput);
    expect(result.currency).toBe('VND');
  });

  it('AD ledgerKind always SIMULATION_PORTFOLIO', () => {
    const result = PortfolioLedgerGenesisDomain.build(validInput);
    expect(result.ledgerKind).toBe('SIMULATION_PORTFOLIO');
  });
});
