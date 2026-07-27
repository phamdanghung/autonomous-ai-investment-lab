import { describe, it, expect } from 'vitest';
import { MarketDataImportBatchDomain, ProgressDelta } from '../../../src/domain/market-data/MarketDataImportBatch';
import { MarketImportInvalidError, MarketImportInvalidTransitionError } from '../../../src/domain/market-data/MarketDataErrors';

describe('MarketDataImportBatchDomain', () => {
  describe('evaluateIdempotency', () => {
    it('should return CREATE_NEW when no existing', () => {
      expect(MarketDataImportBatchDomain.evaluateIdempotency('key1', 'hash1', 'biz1', null)).toBe('CREATE_NEW');
    });

    it('should return REPLAY_BY_IDEMPOTENCY_KEY on exact match', () => {
      expect(MarketDataImportBatchDomain.evaluateIdempotency('key1', 'hash1', 'biz1', {
        creationIdempotencyKey: 'key1',
        creationRequestHash: 'hash1',
        batchBusinessKey: 'biz1'
      })).toBe('REPLAY_BY_IDEMPOTENCY_KEY');
    });

    it('should return IDEMPOTENCY_CONFLICT on hash mismatch with same key', () => {
      expect(MarketDataImportBatchDomain.evaluateIdempotency('key1', 'hash2', 'biz1', {
        creationIdempotencyKey: 'key1',
        creationRequestHash: 'hash1',
        batchBusinessKey: 'biz1'
      })).toBe('IDEMPOTENCY_CONFLICT');
    });

    it('should return REPLAY_BY_BUSINESS_KEY on business key match with same hash', () => {
      expect(MarketDataImportBatchDomain.evaluateIdempotency('key2', 'hash1', 'biz1', {
        creationIdempotencyKey: 'key1',
        creationRequestHash: 'hash1',
        batchBusinessKey: 'biz1'
      })).toBe('REPLAY_BY_BUSINESS_KEY');
    });

    it('should return BUSINESS_KEY_CONFLICT on business key match with diff hash', () => {
      expect(MarketDataImportBatchDomain.evaluateIdempotency('key2', 'hash2', 'biz1', {
        creationIdempotencyKey: 'key1',
        creationRequestHash: 'hash1',
        batchBusinessKey: 'biz1'
      })).toBe('BUSINESS_KEY_CONFLICT');
    });
  });

  describe('buildCreationRequestHash', () => {
    const validPayload = {
      sourceVersionKey: 'key1',
      fixtureKey: 'fx1',
      sourceObjectKey: 'obj1',
      sourceContentHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      sourceByteSize: '1024',
      importMode: 'INITIAL' as const,
      adapterVersion: '1.0',
      schemaVersion: '1.0',
      canonicalizationVersion: '1.0'
    };

    it('should require valid non-negative decimal string without leading zeros for byte size', () => {
      expect(() => MarketDataImportBatchDomain.buildCreationRequestHash({
        ...validPayload,
        sourceByteSize: '-100', // negative
      })).toThrow(MarketImportInvalidError);

      expect(() => MarketDataImportBatchDomain.buildCreationRequestHash({
        ...validPayload,
        sourceByteSize: '01', // leading zero
      })).toThrow(MarketImportInvalidError);
    });

    it('should assert lowercase exact 64-char hash requirements', () => {
      // 64 lowercase hexadecimal characters → accepted
      expect(() => MarketDataImportBatchDomain.buildCreationRequestHash({
        ...validPayload,
        sourceContentHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
      })).not.toThrow();

      // 64 uppercase hexadecimal characters → rejected
      expect(() => MarketDataImportBatchDomain.buildCreationRequestHash({
        ...validPayload,
        sourceContentHash: '0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF'
      })).toThrow(MarketImportInvalidError);

      // mixed uppercase/lowercase → rejected
      expect(() => MarketDataImportBatchDomain.buildCreationRequestHash({
        ...validPayload,
        sourceContentHash: '0123456789abcDEF0123456789abcDEF0123456789abcDEF0123456789abcDEF'
      })).toThrow(MarketImportInvalidError);

      // leading whitespace → rejected
      expect(() => MarketDataImportBatchDomain.buildCreationRequestHash({
        ...validPayload,
        sourceContentHash: ' 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcde'
      })).toThrow(MarketImportInvalidError);

      // trailing whitespace → rejected
      expect(() => MarketDataImportBatchDomain.buildCreationRequestHash({
        ...validPayload,
        sourceContentHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcde '
      })).toThrow(MarketImportInvalidError);

      // 63 characters → rejected
      expect(() => MarketDataImportBatchDomain.buildCreationRequestHash({
        ...validPayload,
        sourceContentHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcde'
      })).toThrow(MarketImportInvalidError);

      // 65 characters → rejected
      expect(() => MarketDataImportBatchDomain.buildCreationRequestHash({
        ...validPayload,
        sourceContentHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0'
      })).toThrow(MarketImportInvalidError);

      // non-hex character g → rejected
      expect(() => MarketDataImportBatchDomain.buildCreationRequestHash({
        ...validPayload,
        sourceContentHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdeg'
      })).toThrow(MarketImportInvalidError);
    });

    it('should reject URLs, absolute paths, empty strings, and whitespace in logical keys', () => {
      // Reject empty or whitespace
      expect(() => MarketDataImportBatchDomain.buildCreationRequestHash({ ...validPayload, fixtureKey: '' })).toThrow();
      expect(() => MarketDataImportBatchDomain.buildCreationRequestHash({ ...validPayload, fixtureKey: '   ' })).toThrow();
      expect(() => MarketDataImportBatchDomain.buildCreationRequestHash({ ...validPayload, fixtureKey: ' fx1' })).toThrow();
      expect(() => MarketDataImportBatchDomain.buildCreationRequestHash({ ...validPayload, fixtureKey: 'fx1 ' })).toThrow();

      expect(() => MarketDataImportBatchDomain.buildCreationRequestHash({ ...validPayload, sourceObjectKey: '' })).toThrow();
      expect(() => MarketDataImportBatchDomain.buildCreationRequestHash({ ...validPayload, sourceObjectKey: '   ' })).toThrow();
      expect(() => MarketDataImportBatchDomain.buildCreationRequestHash({ ...validPayload, sourceObjectKey: ' obj1' })).toThrow();
      expect(() => MarketDataImportBatchDomain.buildCreationRequestHash({ ...validPayload, sourceObjectKey: 'obj1 ' })).toThrow();

      // Reject absolute path / urls
      expect(() => MarketDataImportBatchDomain.buildCreationRequestHash({ ...validPayload, fixtureKey: 'http://test' })).toThrow();
      expect(() => MarketDataImportBatchDomain.buildCreationRequestHash({ ...validPayload, fixtureKey: 'C:\\test' })).toThrow();
      expect(() => MarketDataImportBatchDomain.buildCreationRequestHash({ ...validPayload, fixtureKey: '/absolute/path' })).toThrow();
      expect(() => MarketDataImportBatchDomain.buildCreationRequestHash({ ...validPayload, sourceObjectKey: 'https://url' })).toThrow();

      // Exact traversal tests
      expect(() => MarketDataImportBatchDomain.buildCreationRequestHash({ ...validPayload, fixtureKey: '../fixture.csv' })).toThrow();
      expect(() => MarketDataImportBatchDomain.buildCreationRequestHash({ ...validPayload, fixtureKey: '..\\fixture.csv' })).toThrow();
      expect(() => MarketDataImportBatchDomain.buildCreationRequestHash({ ...validPayload, sourceObjectKey: '../object.csv' })).toThrow();
      expect(() => MarketDataImportBatchDomain.buildCreationRequestHash({ ...validPayload, sourceObjectKey: '..\\object.csv' })).toThrow();
    });

    it('should hash a valid request', () => {
      const { hash } = MarketDataImportBatchDomain.buildCreationRequestHash({
        ...validPayload,
        sourceByteSize: '0', // Valid zero
      });
      expect(hash.length).toBe(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('validateProgressDelta', () => {
    it('should validate correctly when sums match', () => {
      expect(() => MarketDataImportBatchDomain.validateProgressDelta({
        parsedDelta: 10,
        acceptedDelta: 8,
        flaggedDelta: 1,
        quarantinedDelta: 1
      })).not.toThrow();
    });

    it('should throw if negative deltas', () => {
      expect(() => MarketDataImportBatchDomain.validateProgressDelta({
        parsedDelta: -1,
        acceptedDelta: 0,
        flaggedDelta: 0,
        quarantinedDelta: -1
      })).toThrow(MarketImportInvalidError);
    });

    it('should throw if sum does not match', () => {
      expect(() => MarketDataImportBatchDomain.validateProgressDelta({
        parsedDelta: 10,
        acceptedDelta: 8,
        flaggedDelta: 0,
        quarantinedDelta: 0
      })).toThrow(MarketImportInvalidError);
    });
  });

  describe('validateTransition', () => {
    it('should allow PENDING to PENDING', () => {
      expect(() => MarketDataImportBatchDomain.validateTransition('PENDING', 'PENDING')).not.toThrow();
    });
    it('should allow PENDING to COMPLETED', () => {
      expect(() => MarketDataImportBatchDomain.validateTransition('PENDING', 'COMPLETED')).not.toThrow();
    });
    it('should allow PENDING to COMPLETED_WITH_QUARANTINE', () => {
      expect(() => MarketDataImportBatchDomain.validateTransition('PENDING', 'COMPLETED_WITH_QUARANTINE')).not.toThrow();
    });
    it('should allow PENDING to FAILED', () => {
      expect(() => MarketDataImportBatchDomain.validateTransition('PENDING', 'FAILED')).not.toThrow();
    });

    it('should reject terminal status transitioning to itself', () => {
      expect(() => MarketDataImportBatchDomain.validateTransition('COMPLETED', 'COMPLETED')).toThrow(MarketImportInvalidTransitionError);
      expect(() => MarketDataImportBatchDomain.validateTransition('COMPLETED_WITH_QUARANTINE', 'COMPLETED_WITH_QUARANTINE')).toThrow(MarketImportInvalidTransitionError);
      expect(() => MarketDataImportBatchDomain.validateTransition('FAILED', 'FAILED')).toThrow(MarketImportInvalidTransitionError);
    });

    it('should reject terminal status transitioning to anything else', () => {
      expect(() => MarketDataImportBatchDomain.validateTransition('COMPLETED', 'PENDING')).toThrow(MarketImportInvalidTransitionError);
      expect(() => MarketDataImportBatchDomain.validateTransition('FAILED', 'COMPLETED')).toThrow(MarketImportInvalidTransitionError);
      expect(() => MarketDataImportBatchDomain.validateTransition('COMPLETED_WITH_QUARANTINE', 'FAILED')).toThrow(MarketImportInvalidTransitionError);
    });
  });
});
