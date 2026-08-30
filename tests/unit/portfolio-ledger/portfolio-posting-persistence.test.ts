import { describe, it, expect } from 'vitest';
import { deriveNextPortfolioEntrySequence } from '../../../src/infrastructure/repositories/portfolio-ledger/PrismaPortfolioPostingRepository';
import { PortfolioPostingIntegrityError } from '../../../src/application/ports/portfolio-ledger/PortfolioPostingRepositoryPorts';

describe('Portfolio Posting Persistence Unit', () => {
  it('A: last = 0n -> 1', () => {
    expect(deriveNextPortfolioEntrySequence(0n)).toBe(1);
  });

  it('B: last = 9007199254740990n -> 9007199254740991', () => {
    expect(deriveNextPortfolioEntrySequence(9007199254740990n)).toBe(9007199254740991);
  });

  it('C: last = 9007199254740991n -> PortfolioPostingIntegrityError', () => {
    expect(() => deriveNextPortfolioEntrySequence(9007199254740991n)).toThrowError(PortfolioPostingIntegrityError);
  });

  it('D: last = -1n -> PortfolioPostingIntegrityError', () => {
    expect(() => deriveNextPortfolioEntrySequence(-1n)).toThrowError(PortfolioPostingIntegrityError);
  });
});
