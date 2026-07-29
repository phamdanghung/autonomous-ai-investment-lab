import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RegisterMarketDataSourceVersionService } from '../../../../src/application/services/market-data/source-version/RegisterMarketDataSourceVersionService';
import { GetMarketDataSourceVersionService } from '../../../../src/application/services/market-data/source-version/GetMarketDataSourceVersionService';
import { ListMarketDataSourceVersionsService } from '../../../../src/application/services/market-data/source-version/ListMarketDataSourceVersionsService';
import { MarketDatasetKind, MarketAdapterKind, MarketPriceUnit, SourceEncoding } from '../../../../src/domain/contracts/MarketDataContracts';
import { MarketSourceVersionInvalidError, MarketSourceVersionConflictError, MarketDataIntegrityError, MarketSourceVersionNotFoundError } from '../../../../src/domain/market-data/MarketDataErrors';
import { MarketDataSourceVersionDomain } from '../../../../src/domain/market-data/MarketDataSourceVersion';
import { SourceVersionUniqueCollisionError } from '../../../../src/application/ports/market-data/MarketDataSourcePorts';

describe('Source Version Services', () => {
  let mockRepo: any;
  let mockClock: any;

  beforeEach(() => {
    mockRepo = {
      transaction: vi.fn().mockImplementation(async (family, cb) => cb({ _family: family })),
      insert: vi.fn(),
      findBySourceKey: vi.fn(),
      findByContractHash: vi.fn(),
      listVersions: vi.fn()
    };
    mockClock = {
      now: vi.fn().mockReturnValue(new Date('2023-01-01T00:00:00Z'))
    };
  });

  describe('RegisterMarketDataSourceVersionService', () => {
    const validRequest = {
      providerCode: 'TEST',
      datasetKind: "EOD_MARKET_DATA" as any,
      adapterKind: "REPOSITORY_CSV_FIXTURE" as any,
      adapterVersion: '1.0',
      schemaVersion: '1.0',
      canonicalizationVersion: '1.0',
      priceUnit: "VND_PER_SHARE" as any,
      encoding: "UTF8" as any
    };

    it('should insert a new version', async () => {
      const service = new RegisterMarketDataSourceVersionService(mockRepo, mockClock, 'FAM1');
      mockRepo.insert.mockResolvedValueOnce({ sourceVersion: { id: 'uuid-1', providerCode: 'TEST' } });

      const result = await service.execute(validRequest);
      
      expect(result.outcome).toBe('CREATED');
      expect(result.record.id).toBe('uuid-1');
      expect(mockClock.now).toHaveBeenCalledTimes(1);
    });

    it('should throw MarketSourceVersionInvalidError if clock returns invalid date', async () => {
      const service = new RegisterMarketDataSourceVersionService(mockRepo, mockClock, 'FAM1');
      mockClock.now.mockReturnValueOnce(new Date('invalid'));

      await expect(service.execute(validRequest)).rejects.toThrow(MarketSourceVersionInvalidError);
    });

    it('should handle REPLAYED outcome', async () => {
      const service = new RegisterMarketDataSourceVersionService(mockRepo, mockClock, 'FAM1');
      mockRepo.insert.mockRejectedValueOnce(new SourceVersionUniqueCollisionError());
      const { hash } = MarketDataSourceVersionDomain.buildContractHash(validRequest);
      const sourceKey = MarketDataSourceVersionDomain.buildSourceKey(hash);
      mockRepo.findBySourceKey.mockResolvedValueOnce({
        ...validRequest,
        sourceKey,
        contractHash: hash
      });

      const result = await service.execute(validRequest);
      expect(result.outcome).toBe('REPLAYED');
    });

    it('should throw MarketSourceVersionConflictError on canonical mismatch', async () => {
      const service = new RegisterMarketDataSourceVersionService(mockRepo, mockClock, 'FAM1');
      mockRepo.insert.mockRejectedValueOnce(new SourceVersionUniqueCollisionError());
      mockRepo.findBySourceKey.mockResolvedValueOnce({
        ...validRequest,
        adapterVersion: '2.0' // different
      });

      await expect(service.execute(validRequest)).rejects.toThrow(MarketSourceVersionConflictError);
    });

    it('should throw MarketDataIntegrityError if sourceKey is missing but contractHash exists', async () => {
      const service = new RegisterMarketDataSourceVersionService(mockRepo, mockClock, 'FAM1');
      mockRepo.insert.mockRejectedValueOnce(new SourceVersionUniqueCollisionError());
      mockRepo.findBySourceKey.mockResolvedValueOnce(null);
      mockRepo.findByContractHash.mockResolvedValueOnce({ id: 'some-id' });

      await expect(service.execute(validRequest)).rejects.toThrow(MarketDataIntegrityError);
    });

    it('should throw MarketDataIntegrityError if sourceKey and contractHash are both missing', async () => {
      const service = new RegisterMarketDataSourceVersionService(mockRepo, mockClock, 'FAM1');
      mockRepo.insert.mockRejectedValueOnce(new SourceVersionUniqueCollisionError());
      mockRepo.findBySourceKey.mockResolvedValueOnce(null);
      mockRepo.findByContractHash.mockResolvedValueOnce(null);

      await expect(service.execute(validRequest)).rejects.toThrow(MarketDataIntegrityError);
    });
  });

  describe('GetMarketDataSourceVersionService', () => {
    it('should return found record', async () => {
      const service = new GetMarketDataSourceVersionService(mockRepo, 'FAM1');
      mockRepo.findBySourceKey.mockResolvedValueOnce({ id: '1' });
      const res = await service.execute({ sourceKey: 'KEY' });
      expect(res.id).toBe('1');
    });

    it('should throw MarketSourceVersionNotFoundError if not found', async () => {
      const service = new GetMarketDataSourceVersionService(mockRepo, 'FAM1');
      mockRepo.findBySourceKey.mockResolvedValueOnce(null);
      await expect(service.execute({ sourceKey: 'KEY' })).rejects.toThrow(MarketSourceVersionNotFoundError);
    });
  });

  describe('ListMarketDataSourceVersionsService', () => {
    it('should return items and nextCursor', async () => {
      const service = new ListMarketDataSourceVersionsService(mockRepo, 'FAM1');
      mockRepo.listVersions.mockResolvedValueOnce([
        { sourceVersion: { id: '1' }, createdAt: '2023-01-01T00:00:00.000Z' },
        { sourceVersion: { id: '2' }, createdAt: '2023-01-02T00:00:00.000Z' }
      ]);

      const res = await service.execute({ limit: 1 });
      expect(res.items).toHaveLength(1);
      expect(res.items[0].id).toBe('1');
      expect(res.nextCursor).toBeTruthy();
    });
  });
});
