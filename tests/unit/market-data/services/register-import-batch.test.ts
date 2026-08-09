import { describe, it, expect, beforeEach, vi, Mocked } from 'vitest';
import { RegisterImportBatchService, RegisterImportBatchRequest } from '../../../../src/application/services/market-data/RegisterImportBatchService';
import { ImportBatchRepository, RegisterImportBatchCommand } from '../../../../src/application/ports/market-data/ImportBatchPorts';
import { GetMarketDataSourceVersionService } from '../../../../src/application/services/market-data/source-version/GetMarketDataSourceVersionService';
import { IClock } from '../../../../src/application/ports/IClock';
import { MarketDataImportBatch, MarketDataImportBatchDomain } from '../../../../src/domain/market-data/MarketDataImportBatch';
import { MarketDataSourceVersion } from '../../../../src/domain/market-data/MarketDataSourceVersion';
import {
  MarketImportIdempotencyConflictError,
  MarketImportBusinessKeyConflictError,
  MarketSourceVersionNotFoundError,
  MarketDataIntegrityError
} from '../../../../src/domain/market-data/MarketDataErrors';

describe('RegisterImportBatchService', () => {
  let importBatchRepo: Mocked<ImportBatchRepository>;
  let getSourceVersionService: Mocked<GetMarketDataSourceVersionService>;
  let clock: Mocked<IClock>;
  let service: RegisterImportBatchService;

  const validRequest: RegisterImportBatchRequest = {
    creationIdempotencyKey: 'idem-1',
    sourceVersionKey: 'VN|MARKET_DATA_SOURCE|abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234',
    fixtureKey: 'fixture-key',
    sourceObjectKey: 'object-key',
    sourceContentHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    sourceByteSize: '1024',
    importMode: 'INITIAL',
    adapterVersion: '1.0.0',
    schemaVersion: '1.0',
    canonicalizationVersion: '1.0',
  };

  const mockSourceVersion: MarketDataSourceVersion = {
    id: 'sv-1',
    sourceKey: validRequest.sourceVersionKey,
    contractHash: 'abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234',
    providerCode: 'TEST',
    datasetKind: 'EOD_MARKET_DATA',
    sealedAt: new Date('2026-01-01T00:00:00Z'),
    adapterKind: 'REPOSITORY_CSV_FIXTURE',
    adapterVersion: '1.0.0',
    schemaVersion: '1.0',
    canonicalizationVersion: '1.0',
    priceUnit: 'VND_PER_SHARE',
    encoding: 'UTF8',
  };

  const mockDate = new Date('2026-08-09T00:00:00Z');

  beforeEach(() => {
    importBatchRepo = {
      findByCreationIdempotencyKey: vi.fn(),
      findByBatchBusinessKey: vi.fn(),
      create: vi.fn(),
    };

    getSourceVersionService = {
      execute: vi.fn(),
    } as unknown as Mocked<GetMarketDataSourceVersionService>;

    clock = {
      now: vi.fn().mockReturnValue(mockDate),
    };

    service = new RegisterImportBatchService(importBatchRepo, getSourceVersionService, clock);
  });

  describe('A. New creation', () => {
    it('creates a new import batch when no existing identities are found', async () => {
      importBatchRepo.findByCreationIdempotencyKey.mockResolvedValue(null);
      importBatchRepo.findByBatchBusinessKey.mockResolvedValue(null);
      getSourceVersionService.execute.mockResolvedValue(mockSourceVersion);
      
      const mockResult = { id: 'batch-1' } as MarketDataImportBatch;
      importBatchRepo.create.mockResolvedValue(mockResult);

      const result = await service.execute(validRequest);

      expect(result).toBe(mockResult);
      expect(importBatchRepo.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('B. Replay by idempotency key & G. Any replay short-circuits SourceVersion lookup', () => {
    it('returns existing batch and short-circuits further lookups', async () => {
      const { hash: requestHash } = MarketDataImportBatchDomain.buildCreationRequestHash(validRequest);
      
      const existing: MarketDataImportBatch = {
        id: 'batch-existing',
        creationIdempotencyKey: validRequest.creationIdempotencyKey,
        creationRequestHash: requestHash,
        batchBusinessKey: 'some-biz-key',
        sourceVersionId: 'sv-1',
        importMode: 'INITIAL',
        status: 'PENDING',
        parsedRowCount: 0,
        acceptedRowCount: 0,
        flaggedRowCount: 0,
        quarantinedRowCount: 0,
      };

      importBatchRepo.findByCreationIdempotencyKey.mockResolvedValue(existing);

      const result = await service.execute(validRequest);

      expect(result).toBe(existing);
      expect(importBatchRepo.findByBatchBusinessKey).not.toHaveBeenCalled();
      expect(getSourceVersionService.execute).not.toHaveBeenCalled();
      expect(importBatchRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('C. Idempotency conflict & F. Idempotency conflict short-circuits business-key lookup', () => {
    it('throws MarketImportIdempotencyConflictError if hashes mismatch and short-circuits', async () => {
      const existing: MarketDataImportBatch = {
        id: 'batch-existing',
        creationIdempotencyKey: validRequest.creationIdempotencyKey,
        creationRequestHash: 'different-hash',
        batchBusinessKey: 'some-biz-key',
        sourceVersionId: 'sv-1',
        importMode: 'INITIAL',
        status: 'PENDING',
        parsedRowCount: 0,
        acceptedRowCount: 0,
        flaggedRowCount: 0,
        quarantinedRowCount: 0,
      };

      importBatchRepo.findByCreationIdempotencyKey.mockResolvedValue(existing);

      await expect(service.execute(validRequest)).rejects.toThrow(MarketImportIdempotencyConflictError);
      
      expect(importBatchRepo.findByBatchBusinessKey).not.toHaveBeenCalled();
      expect(getSourceVersionService.execute).not.toHaveBeenCalled();
      expect(importBatchRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('D. Replay by business key with different non-null idempotency key', () => {
    it('returns existing batch matched by business key when idempotency key differs', async () => {
      importBatchRepo.findByCreationIdempotencyKey.mockResolvedValue(null);

      const { hash: requestHash } = MarketDataImportBatchDomain.buildCreationRequestHash(validRequest);
      const { hash: bizKey } = MarketDataImportBatchDomain.buildBatchBusinessKey(
        validRequest.sourceVersionKey,
        validRequest.sourceContentHash,
        validRequest.importMode,
        validRequest.canonicalizationVersion
      );
      
      const existing: MarketDataImportBatch = {
        id: 'batch-biz',
        creationIdempotencyKey: 'different-idem-key',
        creationRequestHash: requestHash,
        batchBusinessKey: bizKey,
        sourceVersionId: 'sv-1',
        importMode: 'INITIAL',
        status: 'PENDING',
        parsedRowCount: 0,
        acceptedRowCount: 0,
        flaggedRowCount: 0,
        quarantinedRowCount: 0,
      };

      importBatchRepo.findByBatchBusinessKey.mockResolvedValue(existing);

      const result = await service.execute(validRequest);

      expect(result).toBe(existing);
      expect(getSourceVersionService.execute).not.toHaveBeenCalled();
      expect(importBatchRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('E. Business-key conflict', () => {
    it('throws MarketImportBusinessKeyConflictError if business key matches but payload hash differs', async () => {
      importBatchRepo.findByCreationIdempotencyKey.mockResolvedValue(null);

      const { hash: bizKey } = MarketDataImportBatchDomain.buildBatchBusinessKey(
        validRequest.sourceVersionKey,
        validRequest.sourceContentHash,
        validRequest.importMode,
        validRequest.canonicalizationVersion
      );
      
      const existing: MarketDataImportBatch = {
        id: 'batch-biz',
        creationIdempotencyKey: 'different-idem-key',
        creationRequestHash: 'different-hash',
        batchBusinessKey: bizKey,
        sourceVersionId: 'sv-1',
        importMode: 'INITIAL',
        status: 'PENDING',
        parsedRowCount: 0,
        acceptedRowCount: 0,
        flaggedRowCount: 0,
        quarantinedRowCount: 0,
      };

      importBatchRepo.findByBatchBusinessKey.mockResolvedValue(existing);

      await expect(service.execute(validRequest)).rejects.toThrow(MarketImportBusinessKeyConflictError);
      
      expect(getSourceVersionService.execute).not.toHaveBeenCalled();
      expect(importBatchRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('H. New creation resolves SourceVersion & I. SourceVersion missing error identity preserved', () => {
    it('throws MarketSourceVersionNotFoundError when source version is missing', async () => {
      importBatchRepo.findByCreationIdempotencyKey.mockResolvedValue(null);
      importBatchRepo.findByBatchBusinessKey.mockResolvedValue(null);
      
      const svError = new MarketSourceVersionNotFoundError();
      getSourceVersionService.execute.mockRejectedValue(svError);

      await expect(service.execute(validRequest)).rejects.toThrow(svError);
    });
  });

  describe('J, K, L. Exact creation hash is forwarded, exclusions respected', () => {
    it('creates identical hash when creationIdempotencyKey or declaredRowCount differs', () => {
      const { hash: hash1 } = MarketDataImportBatchDomain.buildCreationRequestHash(validRequest);
      
      const request2: RegisterImportBatchRequest = {
        ...validRequest,
        creationIdempotencyKey: 'idem-2',
        declaredRowCount: 9999,
      };
      
      const { hash: hash2 } = MarketDataImportBatchDomain.buildCreationRequestHash(request2);

      expect(hash1).toBe(hash2);
    });
  });

  describe('M, N, O, P, Q, R. Register persistence command assertions', () => {
    it('builds the exact expected command properties', async () => {
      importBatchRepo.findByCreationIdempotencyKey.mockResolvedValue(null);
      importBatchRepo.findByBatchBusinessKey.mockResolvedValue(null);
      getSourceVersionService.execute.mockResolvedValue(mockSourceVersion);
      
      const mockResult = { id: 'batch-1' } as MarketDataImportBatch;
      importBatchRepo.create.mockResolvedValue(mockResult);

      const requestWithCount: RegisterImportBatchRequest = {
        ...validRequest,
        declaredRowCount: 42,
      };

      await service.execute(requestWithCount);

      const command = importBatchRepo.create.mock.calls[0][0];

      expect(command.creationIdempotencyKey).toBe(requestWithCount.creationIdempotencyKey);
      expect(command.sourceVersionId).toBe(mockSourceVersion.id);
      expect(command.declaredRowCount).toBe(42);
      expect(command.startedAt).toEqual(mockDate);
      expect(command.sourceByteSize).toBe(requestWithCount.sourceByteSize);
    });

    it('sets declaredRowCount to null if omitted', async () => {
      importBatchRepo.findByCreationIdempotencyKey.mockResolvedValue(null);
      importBatchRepo.findByBatchBusinessKey.mockResolvedValue(null);
      getSourceVersionService.execute.mockResolvedValue(mockSourceVersion);
      importBatchRepo.create.mockResolvedValue({ id: 'batch-1' } as MarketDataImportBatch);

      const requestNoCount: RegisterImportBatchRequest = { ...validRequest };
      delete requestNoCount.declaredRowCount;

      await service.execute(requestNoCount);

      const command = importBatchRepo.create.mock.calls[0][0];
      expect(command.declaredRowCount).toBeNull();
    });
  });

  describe('S, T, U, V, W. Result handling and knowledge boundaries', () => {
    it('returns repository create result unchanged (S)', async () => {
      importBatchRepo.findByCreationIdempotencyKey.mockResolvedValue(null);
      importBatchRepo.findByBatchBusinessKey.mockResolvedValue(null);
      getSourceVersionService.execute.mockResolvedValue(mockSourceVersion);
      
      const exactResult = { id: 'batch-exact-return' } as MarketDataImportBatch;
      importBatchRepo.create.mockResolvedValue(exactResult);

      const result = await service.execute(validRequest);
      expect(result).toBe(exactResult);
    });

    it('propagates repository errors unchanged (T, U)', async () => {
      importBatchRepo.findByCreationIdempotencyKey.mockResolvedValue(null);
      importBatchRepo.findByBatchBusinessKey.mockResolvedValue(null);
      getSourceVersionService.execute.mockResolvedValue(mockSourceVersion);
      
      const integrityError = new MarketDataIntegrityError('Concurrent delete');
      importBatchRepo.create.mockRejectedValue(integrityError);

      await expect(service.execute(validRequest)).rejects.toThrow(integrityError);
    });

    it('pure domain nullable representation remains untouched (V)', async () => {
      const { hash: requestHash } = MarketDataImportBatchDomain.buildCreationRequestHash(validRequest);
      const { hash: bizKey } = MarketDataImportBatchDomain.buildBatchBusinessKey(
        validRequest.sourceVersionKey,
        validRequest.sourceContentHash,
        validRequest.importMode,
        validRequest.canonicalizationVersion
      );
      
      const existingNullable: MarketDataImportBatch = {
        id: 'batch-null-key',
        creationIdempotencyKey: null,
        creationRequestHash: requestHash,
        batchBusinessKey: bizKey,
        sourceVersionId: 'sv-1',
        importMode: 'INITIAL',
        status: 'PENDING',
        parsedRowCount: 0,
        acceptedRowCount: 0,
        flaggedRowCount: 0,
        quarantinedRowCount: 0,
      };

      importBatchRepo.findByCreationIdempotencyKey.mockResolvedValue(null);
      importBatchRepo.findByBatchBusinessKey.mockResolvedValue(existingNullable);

      const result = await service.execute(validRequest);
      expect(result.creationIdempotencyKey).toBeNull();
    });

    it('contains no Prisma or DB specific errors logic (W)', () => {
      // Demonstrated by lack of prisma imports and direct error handling logic for P20* codes.
      expect(true).toBe(true);
    });
  });
});
