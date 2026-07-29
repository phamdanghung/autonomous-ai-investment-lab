import { describe, it, expect } from 'vitest';
import { SourceVersionCursor } from '../../../../src/application/services/market-data/source-version/SourceVersionCursor';
import { MarketSourceVersionInvalidError } from '../../../../src/domain/market-data/MarketDataErrors';

describe('SourceVersionCursor', () => {
  it('should encode and decode properly', () => {
    const id = '123e4567-e89b-12d3-a456-426614174000';
    const createdAt = '2023-01-01T00:00:00.000Z';
    const encoded = SourceVersionCursor.encode(createdAt, id);
    const decoded = SourceVersionCursor.decode(encoded);
    expect(decoded.id).toBe(id);
    expect(decoded.createdAt.toISOString()).toBe(createdAt);
  });

  it('should throw on invalid base64', () => {
    expect(() => SourceVersionCursor.decode('!!')).toThrow(MarketSourceVersionInvalidError);
  });

  it('should throw on invalid JSON', () => {
    const enc = Buffer.from('invalid-json').toString('base64url');
    expect(() => SourceVersionCursor.decode(enc)).toThrow(MarketSourceVersionInvalidError);
  });

  it('should throw on invalid UUID', () => {
    const id = 'invalid-uuid';
    const createdAt = '2023-01-01T00:00:00.000Z';
    const encoded = SourceVersionCursor.encode(createdAt, id);
    expect(() => SourceVersionCursor.decode(encoded)).toThrow(MarketSourceVersionInvalidError);
  });
});
