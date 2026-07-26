import { describe, it, expect } from 'vitest';
import { TransitionGuards } from '../../src/domain/guards/TransitionGuards';
import { RunStatus } from '../../src/domain/types/RunStatus';
import { RunMode } from '../../src/domain/types/RunMode';
import { CanonicalSerializer } from '../../src/domain/hashing/CanonicalSerializer';
import { ConfigContentHashCalculator } from '../../src/domain/hashing/calculators/OtherCalculators';
import { InvalidStateTransitionError } from '../../src/domain/errors/DomainErrors';
import { CanonicalDate } from '../../src/domain/models/CanonicalDate';

describe('Domain Core Unit Tests', () => {
  it('should validate valid transitions', () => {
    expect(() => TransitionGuards.validate(RunStatus.INITIALIZED, RunStatus.CONFIGURED, RunMode.LIVE_FORWARD)).not.toThrow();
  });

  it('should throw on invalid transitions', () => {
    expect(() => TransitionGuards.validate(RunStatus.INITIALIZED, RunStatus.RUNNING, RunMode.LIVE_FORWARD)).toThrow(InvalidStateTransitionError);
  });
  
  it('RUNNING -> SEALED is only allowed for HISTORICAL_REPLAY', () => {
    expect(() => TransitionGuards.validate(RunStatus.RUNNING, RunStatus.SEALED, RunMode.HISTORICAL_REPLAY)).not.toThrow();
    expect(() => TransitionGuards.validate(RunStatus.RUNNING, RunStatus.SEALED, RunMode.LIVE_FORWARD)).toThrow();
  });

  it('should canonicalize JSON securely', () => {
    const obj1 = { b: 2, a: 1 };
    const obj2 = { a: 1, b: 2 };
    expect(CanonicalSerializer.serialize(obj1)).toBe(CanonicalSerializer.serialize(obj2));
    
    // BigInt to string
    expect(CanonicalSerializer.serialize({ n: BigInt(123) })).toBe('{"n":"123"}');
  });

  it('should hash consistently', () => {
    const hash1 = ConfigContentHashCalculator.calculate({ a: 1 });
    const hash2 = ConfigContentHashCalculator.calculate({ a: 1 });
    expect(hash1).toBe(hash2);
  });
  
  it('should validate canonical dates', () => {
    expect(() => new CanonicalDate('2026-01-01')).not.toThrow();
    expect(() => new CanonicalDate('2026/01/01')).toThrow();
    expect(() => new CanonicalDate('2026-02-30')).toThrow(); // Invalid date
  });
});
