import { describe, it, expect } from 'vitest';
import { DatasetSnapshotDomain } from '../../../src/domain/market-data/DatasetSnapshot';
import { DatasetSnapshotInvalidError, DatasetSnapshotInvalidTransitionError } from '../../../src/domain/market-data/MarketDataErrors';
import { MarketDataCanonicalization } from '../../../src/domain/market-data/MarketDataCanonicalization';
import { MARKET_DATA_CONTRACT_VERSIONS } from '../../../src/domain/contracts/MarketDataContracts';

describe('DatasetSnapshotDomain', () => {
  const dummyHash64 = 'a'.repeat(64);
  const dummyHash64B = 'b'.repeat(64);

  describe('A. UNIVERSE', () => {
    it('should build a deterministic canonical universe with correct exact 1.0 version', () => {
      const input = {
        securityTypes: ['EQUITY' as any],
        exchanges: ['UPCOM' as any, 'HOSE' as any, 'HNX' as any],
        instrumentBusinessKeys: [
          'VN|HNX|ACB|EQUITY|2023-01-01',
          'VN|HOSE|VCB|EQUITY|2023-01-01',
          'VN|HOSE|VCB|EQUITY|2023-01-01'
        ],
        qualityFlagAllowlist: ['B', 'A', 'B']
      };

      const result = DatasetSnapshotDomain.buildUniverse(input);

      expect(result.payload.universeContractVersion).toBe('1.0');
      expect(result.payload.securityTypes).toEqual(['EQUITY']);
      // Canonical order for exchanges: HOSE, HNX, UPCOM
      expect(result.payload.exchanges).toEqual(['HOSE', 'HNX', 'UPCOM']);
      // Exact duplicate removed and sorted
      expect(result.payload.instrumentBusinessKeys).toEqual([
        'VN|HNX|ACB|EQUITY|2023-01-01',
        'VN|HOSE|VCB|EQUITY|2023-01-01'
      ]);
      // Exact duplicate removed and sorted
      expect(result.payload.qualityFlagAllowlist).toEqual(['A', 'B']);

      // Equivalent differently ordered set input produces same canonical hash
      const input2 = {
        securityTypes: ['EQUITY' as any, 'EQUITY' as any],
        exchanges: ['HOSE' as any, 'HNX' as any, 'UPCOM' as any, 'HOSE' as any],
        instrumentBusinessKeys: [
          'VN|HOSE|VCB|EQUITY|2023-01-01',
          'VN|HNX|ACB|EQUITY|2023-01-01'
        ],
        qualityFlagAllowlist: ['A', 'B']
      };
      const result2 = DatasetSnapshotDomain.buildUniverse(input2);
      expect(result.hash).toBe(result2.hash);
      expect(result.json).toBe(result2.json);

      // Verify exact JSON and fixed hash vector
      const expectedJson = MarketDataCanonicalization.serialize(result.payload);
      expect(result.json).toBe(expectedJson);
      
      // FIXED HASH VECTOR (calculated via SHA-256)
      const expectedHash = MarketDataCanonicalization.hashPayload(result.payload);
      expect(result.hash).toBe(expectedHash);
      expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should reject invalid inputs for universe', () => {
      // Invalid exchange
      expect(() => DatasetSnapshotDomain.buildUniverse({
        securityTypes: ['EQUITY'], exchanges: ['HOSE', 'NYSE' as any], instrumentBusinessKeys: [], qualityFlagAllowlist: []
      })).toThrow(DatasetSnapshotInvalidError);

      // Invalid instrument business key
      expect(() => DatasetSnapshotDomain.buildUniverse({
        securityTypes: ['EQUITY'], exchanges: ['HOSE'], instrumentBusinessKeys: ['INVALID_KEY'], qualityFlagAllowlist: []
      })).toThrow(DatasetSnapshotInvalidError);

      // Invalid quality flag strings
      expect(() => DatasetSnapshotDomain.buildUniverse({
        securityTypes: ['EQUITY'], exchanges: ['HOSE'], instrumentBusinessKeys: [], qualityFlagAllowlist: ['']
      })).toThrow(DatasetSnapshotInvalidError);

      expect(() => DatasetSnapshotDomain.buildUniverse({
        securityTypes: ['EQUITY'], exchanges: ['HOSE'], instrumentBusinessKeys: [], qualityFlagAllowlist: [' A'] // Leading space
      })).toThrow(DatasetSnapshotInvalidError);
    });

    it('should explicitly reject noncanonical instrument business keys in Universe', () => {
      const buildU = (key: string) => DatasetSnapshotDomain.buildUniverse({
        securityTypes: ['EQUITY'], exchanges: ['HOSE'], instrumentBusinessKeys: [key], qualityFlagAllowlist: []
      });

      // A. 21-character symbol rejected
      try {
        buildU('VN|HOSE|ABCDEFGHIJKLMNOPQRSTU|EQUITY|2023-01-01');
        expect.fail('Should throw');
      } catch (e) {
        expect(e).toBeInstanceOf(DatasetSnapshotInvalidError);
      }

      // B. lowercase symbol rejected
      try {
        buildU('VN|HOSE|vcb|EQUITY|2023-01-01');
        expect.fail('Should throw');
      } catch (e) {
        expect(e).toBeInstanceOf(DatasetSnapshotInvalidError);
      }

      // C. leading/trailing symbol whitespace rejected
      try {
        buildU('VN|HOSE| VCB|EQUITY|2023-01-01');
        expect.fail('Should throw');
      } catch (e) {
        expect(e).toBeInstanceOf(DatasetSnapshotInvalidError);
      }
      try {
        buildU('VN|HOSE|VCB |EQUITY|2023-01-01');
        expect.fail('Should throw');
      } catch (e) {
        expect(e).toBeInstanceOf(DatasetSnapshotInvalidError);
      }

      // D. noncanonical date rejected
      try {
        buildU('VN|HOSE|VCB|EQUITY|2023-1-1');
        expect.fail('Should throw');
      } catch (e) {
        expect(e).toBeInstanceOf(DatasetSnapshotInvalidError);
      }

      // E. valid 20-character symbol accepted
      expect(() => buildU('VN|HOSE|ABCDEFGHIJKLMNOPQRST|EQUITY|2023-01-01')).not.toThrow();

      // F. valid ordinary canonical key accepted
      expect(() => buildU('VN|HOSE|VCB|EQUITY|2023-01-01')).not.toThrow();
    });
  });

  describe('B. DATA CUTOFF', () => {
    it('should build data cutoff and sort deterministically by tuple', () => {
      const input = {
        batches: [
          { batchBusinessKey: dummyHash64B, sourceContentHash: dummyHash64B },
          { batchBusinessKey: dummyHash64, sourceContentHash: dummyHash64B },
          { batchBusinessKey: dummyHash64, sourceContentHash: dummyHash64 }
        ]
      };
      // Duplicate batch key should be rejected
      expect(() => DatasetSnapshotDomain.buildDataCutoff(input)).toThrow(DatasetSnapshotInvalidError);
      
      const validInput = {
        batches: [
          { batchBusinessKey: dummyHash64B, sourceContentHash: dummyHash64B },
          { batchBusinessKey: dummyHash64, sourceContentHash: dummyHash64 }
        ]
      };
      
      const result = DatasetSnapshotDomain.buildDataCutoff(validInput);
      expect(result.payload.cutoffContractVersion).toBe('1.0');
      // Should sort by batchBusinessKey ASC
      expect(result.payload.batches[0].batchBusinessKey).toBe(dummyHash64);
      expect(result.payload.batches[1].batchBusinessKey).toBe(dummyHash64B);
      
      expect(result.key).toMatch(/^[a-f0-9]{64}$/);
      expect(result.key).toBe(MarketDataCanonicalization.hashPayload(result.payload));
    });

    it('should reject malformed hashes', () => {
      expect(() => DatasetSnapshotDomain.buildDataCutoff({
        batches: [{ batchBusinessKey: 'not-a-hash', sourceContentHash: dummyHash64 }]
      })).toThrow(DatasetSnapshotInvalidError);
    });

    it('should allow empty cutoff deterministically', () => {
      const result = DatasetSnapshotDomain.buildDataCutoff({ batches: [] });
      expect(result.payload.batches).toEqual([]);
      expect(result.key).toMatch(/^[a-f0-9]{64}$/);
      expect(result.key).toBe(MarketDataCanonicalization.hashPayload(result.payload));
    });
  });

  describe('C. BUSINESS KEY', () => {
    it('should build deterministic business key with valid inputs', () => {
      const input = {
        sourceVersionKey: `VN|MARKET_DATA_SOURCE|${dummyHash64}`,
        rangeStart: '2023-01-01',
        rangeEnd: '2023-12-31',
        universeHash: dummyHash64,
        dataCutoffKey: dummyHash64,
        canonicalizationVersion: '1.0'
      };

      const result = DatasetSnapshotDomain.buildBusinessKey(input);
      expect(result.payload.snapshotContractVersion).toBe('1.0');
      expect(result.businessKey).toMatch(/^[a-f0-9]{64}$/);
      expect(result.businessKey).toBe(MarketDataCanonicalization.hashPayload(result.payload));
      
      // Same-day range accepted
      const sameDayInput = { ...input, rangeStart: '2023-01-01', rangeEnd: '2023-01-01' };
      const sameDayResult = DatasetSnapshotDomain.buildBusinessKey(sameDayInput);
      expect(sameDayResult.payload.rangeStart).toBe('2023-01-01');
    });

    it('should reject invalid inputs for business key', () => {
      const valid = {
        sourceVersionKey: `VN|MARKET_DATA_SOURCE|${dummyHash64}`,
        rangeStart: '2023-01-01',
        rangeEnd: '2023-12-31',
        universeHash: dummyHash64,
        dataCutoffKey: dummyHash64,
        canonicalizationVersion: '1.0'
      };

      // rangeEnd < rangeStart rejected
      expect(() => DatasetSnapshotDomain.buildBusinessKey({ ...valid, rangeStart: '2023-12-31', rangeEnd: '2023-01-01' }))
        .toThrow(DatasetSnapshotInvalidError);

      // malformed dates rejected
      expect(() => DatasetSnapshotDomain.buildBusinessKey({ ...valid, rangeStart: '2023-1-1' })).toThrow(DatasetSnapshotInvalidError);
      expect(() => DatasetSnapshotDomain.buildBusinessKey({ ...valid, rangeStart: ' 2023-01-01' })).toThrow(DatasetSnapshotInvalidError);

      // malformed hashes rejected
      expect(() => DatasetSnapshotDomain.buildBusinessKey({ ...valid, universeHash: 'not-hash' })).toThrow(DatasetSnapshotInvalidError);
      expect(() => DatasetSnapshotDomain.buildBusinessKey({ ...valid, dataCutoffKey: 'not-hash' })).toThrow(DatasetSnapshotInvalidError);

      // invalid sourceVersionKey
      expect(() => DatasetSnapshotDomain.buildBusinessKey({ ...valid, sourceVersionKey: `VN|MARKET_DATA_SOURCE|NOTHASH` })).toThrow(DatasetSnapshotInvalidError);
    });
  });

  describe('D. ENTRY HASH', () => {
    it('should build entry hash', () => {
      const input = {
        entrySequence: 1,
        instrumentBusinessKey: 'VN|HOSE|VCB|EQUITY|2023-01-01',
        marketDate: '2023-01-01',
        barCanonicalHash: dummyHash64
      };
      const result = DatasetSnapshotDomain.buildEntryHash(input);
      expect(result.payload.entryContractVersion).toBe('1.0');
      expect(result.entryHash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.entryHash).toBe(MarketDataCanonicalization.hashPayload(result.payload));
      expect((result.payload as any).dailyBarId).toBeUndefined(); // Should not be in payload
    });

    it('should reject invalid inputs for entry hash', () => {
      const valid = {
        entrySequence: 1,
        instrumentBusinessKey: 'VN|HOSE|VCB|EQUITY|2023-01-01',
        marketDate: '2023-01-01',
        barCanonicalHash: dummyHash64
      };

      expect(() => DatasetSnapshotDomain.buildEntryHash({ ...valid, entrySequence: 0 })).toThrow(DatasetSnapshotInvalidError);
      expect(() => DatasetSnapshotDomain.buildEntryHash({ ...valid, entrySequence: -1 })).toThrow(DatasetSnapshotInvalidError);
      expect(() => DatasetSnapshotDomain.buildEntryHash({ ...valid, entrySequence: 1.5 })).toThrow(DatasetSnapshotInvalidError);

      expect(() => DatasetSnapshotDomain.buildEntryHash({ ...valid, instrumentBusinessKey: 'INVALID' })).toThrow(DatasetSnapshotInvalidError);
      expect(() => DatasetSnapshotDomain.buildEntryHash({ ...valid, marketDate: '2023-13-01' })).toThrow(DatasetSnapshotInvalidError);
      expect(() => DatasetSnapshotDomain.buildEntryHash({ ...valid, barCanonicalHash: 'not-hash' })).toThrow(DatasetSnapshotInvalidError);
    });

    it('should explicitly reject noncanonical instrument business keys in EntryHash', () => {
      const buildE = (key: string) => DatasetSnapshotDomain.buildEntryHash({
        entrySequence: 1,
        instrumentBusinessKey: key,
        marketDate: '2023-01-01',
        barCanonicalHash: dummyHash64
      });

      // A. 21-character symbol rejected
      try {
        buildE('VN|HOSE|ABCDEFGHIJKLMNOPQRSTU|EQUITY|2023-01-01');
        expect.fail('Should throw');
      } catch (e) {
        expect(e).toBeInstanceOf(DatasetSnapshotInvalidError);
      }

      // B. lowercase symbol rejected
      try {
        buildE('VN|HOSE|vcb|EQUITY|2023-01-01');
        expect.fail('Should throw');
      } catch (e) {
        expect(e).toBeInstanceOf(DatasetSnapshotInvalidError);
      }

      // C. leading/trailing symbol whitespace rejected
      try {
        buildE('VN|HOSE| VCB|EQUITY|2023-01-01');
        expect.fail('Should throw');
      } catch (e) {
        expect(e).toBeInstanceOf(DatasetSnapshotInvalidError);
      }
      try {
        buildE('VN|HOSE|VCB |EQUITY|2023-01-01');
        expect.fail('Should throw');
      } catch (e) {
        expect(e).toBeInstanceOf(DatasetSnapshotInvalidError);
      }

      // D. noncanonical date rejected
      try {
        buildE('VN|HOSE|VCB|EQUITY|2023-1-1');
        expect.fail('Should throw');
      } catch (e) {
        expect(e).toBeInstanceOf(DatasetSnapshotInvalidError);
      }

      // E. valid 20-character symbol accepted
      expect(() => buildE('VN|HOSE|ABCDEFGHIJKLMNOPQRST|EQUITY|2023-01-01')).not.toThrow();

      // F. valid ordinary canonical key accepted
      expect(() => buildE('VN|HOSE|VCB|EQUITY|2023-01-01')).not.toThrow();
    });
  });

  describe('E. MANIFEST', () => {
    it('should build manifest preserving order', () => {
      const resultAB = DatasetSnapshotDomain.buildManifestHash([dummyHash64, dummyHash64B]);
      const resultBA = DatasetSnapshotDomain.buildManifestHash([dummyHash64B, dummyHash64]);
      
      expect(resultAB.payload.entries).toEqual([dummyHash64, dummyHash64B]);
      expect(resultBA.payload.entries).toEqual([dummyHash64B, dummyHash64]);
      expect(resultAB.manifestHash).not.toBe(resultBA.manifestHash);
      
      expect(resultAB.manifestHash).toBe(MarketDataCanonicalization.hashPayload(resultAB.payload));
    });

    it('should reject duplicate entryHash and malformed hash', () => {
      expect(() => DatasetSnapshotDomain.buildManifestHash([dummyHash64, dummyHash64])).toThrow(DatasetSnapshotInvalidError);
      expect(() => DatasetSnapshotDomain.buildManifestHash(['not-hash'])).toThrow(DatasetSnapshotInvalidError);
    });

    it('should allow empty manifest deterministically', () => {
      const result = DatasetSnapshotDomain.buildManifestHash([]);
      expect(result.payload.entries).toEqual([]);
      expect(result.manifestHash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.manifestHash).toBe(MarketDataCanonicalization.hashPayload(result.payload));
    });
  });

  describe('F. CONTENT', () => {
    it('should build content hash with valid inputs', () => {
      const input = {
        businessKey: dummyHash64,
        rowCount: 0, // rowCount 0 accepted
        manifestHash: dummyHash64B
      };
      const result = DatasetSnapshotDomain.buildContentHash(input);
      expect(result.payload.snapshotContractVersion).toBe('1.0');
      expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.contentHash).toBe(MarketDataCanonicalization.hashPayload(result.payload));
      
      // positive integer accepted
      const resultPos = DatasetSnapshotDomain.buildContentHash({ ...input, rowCount: 100 });
      expect(resultPos.contentHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should reject invalid inputs for content', () => {
      const valid = { businessKey: dummyHash64, rowCount: 10, manifestHash: dummyHash64B };
      expect(() => DatasetSnapshotDomain.buildContentHash({ ...valid, rowCount: -1 })).toThrow(DatasetSnapshotInvalidError);
      expect(() => DatasetSnapshotDomain.buildContentHash({ ...valid, rowCount: 10.5 })).toThrow(DatasetSnapshotInvalidError);
    });
  });

  describe('G. LIFECYCLE', () => {
    it('should accept DRAFT to SEALED transition', () => {
      expect(() => DatasetSnapshotDomain.validateTransition('DRAFT', 'SEALED')).not.toThrow();
    });

    it('should reject invalid transitions', () => {
      expect(() => DatasetSnapshotDomain.validateTransition('DRAFT', 'DRAFT')).toThrow(DatasetSnapshotInvalidTransitionError);
      expect(() => DatasetSnapshotDomain.validateTransition('SEALED', 'SEALED')).toThrow(DatasetSnapshotInvalidTransitionError);
      expect(() => DatasetSnapshotDomain.validateTransition('SEALED', 'DRAFT')).toThrow(DatasetSnapshotInvalidTransitionError);
      expect(() => DatasetSnapshotDomain.validateTransition('UNKNOWN', 'SEALED')).toThrow(DatasetSnapshotInvalidTransitionError);
    });
  });

  describe('H. ERRORS', () => {
    it('should have correct error metadata for Validation Error', () => {
      const err = new DatasetSnapshotInvalidError();
      expect(err).toBeInstanceOf(DatasetSnapshotInvalidError);
      expect(err.code).toBe('DATASET_SNAPSHOT_INVALID');
      expect(err.category).toBe('VALIDATION');
      expect(err.retryable).toBe(false);
      expect(err.safeMessage).toBe('The provided dataset snapshot data is invalid.');
    });

    it('should have correct error metadata for Transition Error', () => {
      const err = new DatasetSnapshotInvalidTransitionError();
      expect(err).toBeInstanceOf(DatasetSnapshotInvalidTransitionError);
      expect(err.code).toBe('DATASET_SNAPSHOT_INVALID_TRANSITION');
      expect(err.category).toBe('BUSINESS_RULE');
      expect(err.retryable).toBe(false);
      expect(err.safeMessage).toBe('The requested dataset snapshot operation is invalid for its current state.');
    });
  });

  describe('Fixed Hash Vectors', () => {
    it('should produce exact known SHA-256 for Universe', () => {
      const result = DatasetSnapshotDomain.buildUniverse({
        securityTypes: ['EQUITY'],
        exchanges: ['HOSE'],
        instrumentBusinessKeys: ['VN|HOSE|VCB|EQUITY|2023-01-01'],
        qualityFlagAllowlist: ['OK']
      });
      // FIXED HASH VECTOR
      const expectedSha256 = '880834e9c5476a352f09412a54a43294b53773993d149d724cc07b0be5a2d69d';
      expect(result.hash).toBe(expectedSha256);
      expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should produce exact known SHA-256 for DataCutoff', () => {
      const result = DatasetSnapshotDomain.buildDataCutoff({
        batches: [{ batchBusinessKey: dummyHash64, sourceContentHash: dummyHash64B }]
      });
      const expectedSha256 = '1ee17e8ff4c3acfdaeb744e62796c63176c5bd5c81d3971d5b78a4723773b01f';
      expect(result.key).toBe(expectedSha256);
    });

    it('should produce exact known SHA-256 for BusinessKey', () => {
      const result = DatasetSnapshotDomain.buildBusinessKey({
        sourceVersionKey: `VN|MARKET_DATA_SOURCE|${dummyHash64}`,
        rangeStart: '2023-01-01',
        rangeEnd: '2023-12-31',
        universeHash: dummyHash64,
        dataCutoffKey: dummyHash64B,
        canonicalizationVersion: '1.0'
      });
      const expectedSha256 = '39adff145e50a45c2d44fee1f86c0aec3e9b79a25af8e0abd27a59b0c2350863';
      expect(result.businessKey).toBe(expectedSha256);
    });

    it('should produce exact known SHA-256 for Entry', () => {
      const result = DatasetSnapshotDomain.buildEntryHash({
        entrySequence: 1,
        instrumentBusinessKey: 'VN|HOSE|VCB|EQUITY|2023-01-01',
        marketDate: '2023-01-01',
        barCanonicalHash: dummyHash64
      });
      const expectedSha256 = '93ff4f82e79b26e5b8083d44e23345a93bc9bb89104d8c36e67a52e3dd571df0';
      expect(result.entryHash).toBe(expectedSha256);
    });

    it('should produce exact known SHA-256 for Manifest', () => {
      const result = DatasetSnapshotDomain.buildManifestHash([dummyHash64, dummyHash64B]);
      const expectedSha256 = 'e843d08a713e5fb717178a57884417a89e0b05056f2251539ba426e3662bdadd';
      expect(result.manifestHash).toBe(expectedSha256);
    });

    it('should produce exact known SHA-256 for Content', () => {
      const result = DatasetSnapshotDomain.buildContentHash({
        businessKey: dummyHash64,
        rowCount: 100,
        manifestHash: dummyHash64B
      });
      const expectedSha256 = 'b5b7b2681312cd8655b1857c3ac818c59777d3b79f638ec43920380b58dbd0dc';
      expect(result.contentHash).toBe(expectedSha256);
    });
  });
});
