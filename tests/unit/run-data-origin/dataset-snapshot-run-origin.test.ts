import { describe, it, expect, beforeEach } from 'vitest';
import {
  DatasetSnapshotRunOriginDomain,
  DatasetSnapshotRunOriginInvalidError
} from '../../../src/domain/run-data-origin/DatasetSnapshotRunOrigin';
import { DatasetSnapshot } from '../../../src/domain/market-data/DatasetSnapshot';

describe('DatasetSnapshotRunOriginDomain', () => {
  let validSnapshot: DatasetSnapshot;

  beforeEach(() => {
    validSnapshot = Object.freeze({
      id: 'db-only-id-123',
      businessKey: 'a'.repeat(64),
      contentHash: 'b'.repeat(64),
      dataCutoffKey: 'c'.repeat(64),
      rangeStart: '2025-01-01',
      rangeEnd: '2025-01-31',
      status: 'SEALED',
      sealedAt: new Date('2025-01-31T23:59:59Z'),
      rowCount: 2,
      sourceVersionId: 'sv-id-123',
      creationIdempotencyKey: 'idem-key',
      creationRequestHash: 'd'.repeat(64),
      createdAt: new Date('2025-01-01T00:00:00Z'),
      dataCutoffAt: new Date('2025-01-31T23:59:59Z')
    }) as unknown as DatasetSnapshot;
  });

  const expectDomainError = (fn: () => void) => {
    try {
      fn();
      expect.fail('Expected error was not thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(DatasetSnapshotRunOriginInvalidError);
      const e = error as DatasetSnapshotRunOriginInvalidError;
      expect(e.code).toBe('DATASET_SNAPSHOT_RUN_ORIGIN_INVALID');
      expect(e.category).toBe('BUSINESS_RULE');
      expect(e.retryable).toBe(false);
    }
  };

  it('A. valid SEALED snapshot builds exact origin', () => {
    const origin = DatasetSnapshotRunOriginDomain.build(validSnapshot, '2025-01-15');
    expect(origin).toEqual({
      originKind: 'DATASET_SNAPSHOT',
      snapshotBusinessKey: validSnapshot.businessKey,
      dataOriginHash: validSnapshot.contentHash,
      canonicalStartDate: '2025-01-15',
      rangeStart: validSnapshot.rangeStart,
      rangeEnd: validSnapshot.rangeEnd,
      dataCutoffKey: validSnapshot.dataCutoffKey,
      rowCount: validSnapshot.rowCount
    });
  });

  it('B. dataOriginHash EXACTLY equals contentHash', () => {
    const origin = DatasetSnapshotRunOriginDomain.build(validSnapshot, '2025-01-15');
    expect(origin.dataOriginHash).toBe(validSnapshot.contentHash);
  });

  it('C. canonicalStartDate at rangeStart accepted', () => {
    const origin = DatasetSnapshotRunOriginDomain.build(validSnapshot, '2025-01-01');
    expect(origin.canonicalStartDate).toBe('2025-01-01');
  });

  it('D. canonicalStartDate at rangeEnd accepted', () => {
    const origin = DatasetSnapshotRunOriginDomain.build(validSnapshot, '2025-01-31');
    expect(origin.canonicalStartDate).toBe('2025-01-31');
  });

  it('E. canonicalStartDate before range rejected', () => {
    expectDomainError(() => DatasetSnapshotRunOriginDomain.build(validSnapshot, '2024-12-31'));
  });

  it('F. canonicalStartDate after range rejected', () => {
    expectDomainError(() => DatasetSnapshotRunOriginDomain.build(validSnapshot, '2025-02-01'));
  });

  it('G. malformed canonicalStartDate rejected', () => {
    expectDomainError(() => DatasetSnapshotRunOriginDomain.build(validSnapshot, '2025-1-15'));
    expectDomainError(() => DatasetSnapshotRunOriginDomain.build(validSnapshot, ' 2025-01-15'));
    expectDomainError(() => DatasetSnapshotRunOriginDomain.build(validSnapshot, '2025-01-15T00:00:00Z'));
  });

  it('H. DRAFT rejected', () => {
    const draft = { ...validSnapshot, status: 'DRAFT' } as unknown as DatasetSnapshot;
    expectDomainError(() => DatasetSnapshotRunOriginDomain.build(draft, '2025-01-15'));
  });

  it('I. SEALED + sealedAt null rejected', () => {
    const bad = { ...validSnapshot, sealedAt: null } as unknown as DatasetSnapshot;
    expectDomainError(() => DatasetSnapshotRunOriginDomain.build(bad, '2025-01-15'));
  });

  it('J. invalid sealedAt Date rejected', () => {
    const bad = { ...validSnapshot, sealedAt: new Date('invalid') } as unknown as DatasetSnapshot;
    expectDomainError(() => DatasetSnapshotRunOriginDomain.build(bad, '2025-01-15'));
  });

  it('K. malformed snapshot businessKey rejected', () => {
    const keys = ['A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), ' a' + 'a'.repeat(62), ''];
    keys.forEach(k => {
      const bad = { ...validSnapshot, businessKey: k } as unknown as DatasetSnapshot;
      expectDomainError(() => DatasetSnapshotRunOriginDomain.build(bad, '2025-01-15'));
    });
  });

  it('L. malformed contentHash rejected', () => {
    const bad = { ...validSnapshot, contentHash: 'b'.repeat(63) } as unknown as DatasetSnapshot;
    expectDomainError(() => DatasetSnapshotRunOriginDomain.build(bad, '2025-01-15'));
  });

  it('M. malformed dataCutoffKey rejected', () => {
    const bad = { ...validSnapshot, dataCutoffKey: 'c'.repeat(63) } as unknown as DatasetSnapshot;
    expectDomainError(() => DatasetSnapshotRunOriginDomain.build(bad, '2025-01-15'));
  });

  it('N. malformed rangeStart rejected', () => {
    const bad = { ...validSnapshot, rangeStart: '2025-1-01' } as unknown as DatasetSnapshot;
    expectDomainError(() => DatasetSnapshotRunOriginDomain.build(bad, '2025-01-15'));
  });

  it('O. malformed rangeEnd rejected', () => {
    const bad = { ...validSnapshot, rangeEnd: '2025-01-1' } as unknown as DatasetSnapshot;
    expectDomainError(() => DatasetSnapshotRunOriginDomain.build(bad, '2025-01-15'));
  });

  it('P. rangeEnd < rangeStart rejected', () => {
    const bad = { ...validSnapshot, rangeStart: '2025-01-31', rangeEnd: '2025-01-01' } as unknown as DatasetSnapshot;
    expectDomainError(() => DatasetSnapshotRunOriginDomain.build(bad, '2025-01-15'));
  });

  it('Q. negative rowCount rejected', () => {
    const bad = { ...validSnapshot, rowCount: -1 } as unknown as DatasetSnapshot;
    expectDomainError(() => DatasetSnapshotRunOriginDomain.build(bad, '2025-01-15'));
  });

  it('R. fractional rowCount rejected', () => {
    const bad = { ...validSnapshot, rowCount: 1.5 } as unknown as DatasetSnapshot;
    expectDomainError(() => DatasetSnapshotRunOriginDomain.build(bad, '2025-01-15'));
  });

  it('S. zero rowCount accepted', () => {
    const zero = { ...validSnapshot, rowCount: 0 } as unknown as DatasetSnapshot;
    const origin = DatasetSnapshotRunOriginDomain.build(zero, '2025-01-15');
    expect(origin.rowCount).toBe(0);
  });

  it('T. repeated build is deterministic', () => {
    const o1 = DatasetSnapshotRunOriginDomain.build(validSnapshot, '2025-01-15');
    const o2 = DatasetSnapshotRunOriginDomain.build(validSnapshot, '2025-01-15');
    expect(o1).toEqual(o2);
  });

  it('U. input snapshot is not mutated', () => {
    const cloned = { ...validSnapshot } as unknown as DatasetSnapshot;
    const original = JSON.stringify(cloned);
    DatasetSnapshotRunOriginDomain.build(cloned, '2025-01-15');
    expect(JSON.stringify(cloned)).toBe(original);
  });

  it('V. null/undefined runtime input fails with domain error rather than TypeError', () => {
    expectDomainError(() => DatasetSnapshotRunOriginDomain.build(null as any, '2025-01-15'));
    expectDomainError(() => DatasetSnapshotRunOriginDomain.build(undefined as any, '2025-01-15'));
    expectDomainError(() => DatasetSnapshotRunOriginDomain.build('not an object' as any, '2025-01-15'));
  });
});
