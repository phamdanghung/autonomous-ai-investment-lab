import { describe, it, expect } from 'vitest';
import { MarketDataSourceVersionDomain } from '../../../src/domain/market-data/MarketDataSourceVersion';
import { MarketSourceVersionInvalidError } from '../../../src/domain/market-data/MarketDataErrors';

describe('MarketDataSourceVersionDomain', () => {
  describe('buildContractHash and buildSourceKey', () => {
    it('should build a fixed canonical payload and hash', () => {
      const { payload, hash } = MarketDataSourceVersionDomain.buildContractHash({
        providerCode: '  XYZ_DATA  ',
        datasetKind: 'EOD_MARKET_DATA',
        adapterKind: 'REPOSITORY_CSV_FIXTURE',
        adapterVersion: '1.0.0',
        schemaVersion: '1.0',
        canonicalizationVersion: '1.0',
        priceUnit: 'VND_PER_SHARE',
        encoding: 'UTF8',
      });

      expect(payload.providerCode).toBe('XYZ_DATA'); // Trimmed
      expect(payload.sourceContractVersion).toBe('1.0');

      // Hash length check
      expect(hash.length).toBe(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/); // Lowercase hex

      const sourceKey = MarketDataSourceVersionDomain.buildSourceKey(hash);
      expect(sourceKey).toBe(`VN|MARKET_DATA_SOURCE|${hash}`);
    });

    it('should reject empty fields', () => {
      expect(() => MarketDataSourceVersionDomain.buildContractHash({
        providerCode: '   ',
        datasetKind: 'EOD_MARKET_DATA',
        adapterKind: 'REPOSITORY_CSV_FIXTURE',
        adapterVersion: '1.0.0',
        schemaVersion: '1.0',
        canonicalizationVersion: '1.0',
        priceUnit: 'VND_PER_SHARE',
        encoding: 'UTF8',
      })).toThrow(MarketSourceVersionInvalidError);
    });

    it('should reject control characters', () => {
      expect(() => MarketDataSourceVersionDomain.buildContractHash({
        providerCode: 'XYZ\nDATA',
        datasetKind: 'EOD_MARKET_DATA',
        adapterKind: 'REPOSITORY_CSV_FIXTURE',
        adapterVersion: '1.0.0',
        schemaVersion: '1.0',
        canonicalizationVersion: '1.0',
        priceUnit: 'VND_PER_SHARE',
        encoding: 'UTF8',
      })).toThrow(MarketSourceVersionInvalidError);
    });
  });
});
