import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UpdateImportProgressService } from '../../../../src/application/services/market-data/UpdateImportProgressService';
import { ImportBatchMutationRepository } from '../../../../src/application/ports/market-data/ImportBatchMutationPorts';
import { MarketDataImportBatch } from '../../../../src/domain/market-data/MarketDataImportBatch';
import { MarketImportNotFoundError, MarketImportInvalidTransitionError, MarketDataConcurrencyConflictError, MarketDataIntegrityError, MarketImportInvalidError } from '../../../../src/domain/market-data/MarketDataErrors';

describe('UpdateImportProgressService', () => {
  let repository: import('vitest').Mocked<ImportBatchMutationRepository>;
  let service: UpdateImportProgressService;

  const mockBatch = (status: any = 'PENDING'): MarketDataImportBatch => ({
    id: 'batch-1',
    sourceVersionId: 'sv-1',
    creationIdempotencyKey: 'idemp-1',
    creationRequestHash: 'hash-1',
    batchBusinessKey: 'biz-1',
    importMode: 'INITIAL',
    status,
    parsedRowCount: 0,
    acceptedRowCount: 0,
    flaggedRowCount: 0,
    quarantinedRowCount: 0
  });

  beforeEach(() => {
    repository = {
      findById: vi.fn(),
      applyProgressDeltaConditional: vi.fn(),
      transitionConditional: vi.fn()
    };
    service = new UpdateImportProgressService(repository);
  });

  it('should update progress and return exact UPDATED record identity', async () => {
    const record = mockBatch('PENDING');
    repository.findById.mockResolvedValueOnce(record);
    const updatedRecord = { ...record, parsedRowCount: 10 };
    repository.applyProgressDeltaConditional.mockResolvedValueOnce({ outcome: 'UPDATED', record: updatedRecord });

    const result = await service.execute({
      id: 'batch-1',
      delta: { parsedDelta: 10, acceptedDelta: 10, flaggedDelta: 0, quarantinedDelta: 0 }
    });

    expect(result).toBe(updatedRecord);
    expect(repository.applyProgressDeltaConditional).toHaveBeenCalledWith('batch-1', {
      parsedDelta: 10, acceptedDelta: 10, flaggedDelta: 0, quarantinedDelta: 0
    });
  });

  it('should allow all-zero delta', async () => {
    const record = mockBatch('PENDING');
    repository.findById.mockResolvedValueOnce(record);
    repository.applyProgressDeltaConditional.mockResolvedValueOnce({ outcome: 'UPDATED', record });

    const result = await service.execute({
      id: 'batch-1',
      delta: { parsedDelta: 0, acceptedDelta: 0, flaggedDelta: 0, quarantinedDelta: 0 }
    });

    expect(result).toBe(record);
  });

  it('should throw MarketImportInvalidError and short-circuit repo on negative delta', async () => {
    await expect(service.execute({
      id: 'batch-1',
      delta: { parsedDelta: -1, acceptedDelta: -1, flaggedDelta: 0, quarantinedDelta: 0 }
    })).rejects.toThrow(MarketImportInvalidError);
    expect(repository.findById).not.toHaveBeenCalled();
  });

  it('should throw MarketImportInvalidError and short-circuit repo on fractional delta', async () => {
    await expect(service.execute({
      id: 'batch-1',
      delta: { parsedDelta: 1.5, acceptedDelta: 1.5, flaggedDelta: 0, quarantinedDelta: 0 }
    })).rejects.toThrow(MarketImportInvalidError);
    expect(repository.findById).not.toHaveBeenCalled();
  });

  it('should throw MarketImportInvalidError and short-circuit repo on sum mismatch', async () => {
    await expect(service.execute({
      id: 'batch-1',
      delta: { parsedDelta: 10, acceptedDelta: 5, flaggedDelta: 0, quarantinedDelta: 0 }
    })).rejects.toThrow(MarketImportInvalidError);
    expect(repository.findById).not.toHaveBeenCalled();
  });

  it('should throw MarketImportNotFoundError for unknown preflight ID', async () => {
    repository.findById.mockResolvedValueOnce(null);

    await expect(service.execute({
      id: 'unknown-id',
      delta: { parsedDelta: 0, acceptedDelta: 0, flaggedDelta: 0, quarantinedDelta: 0 }
    })).rejects.toThrow(MarketImportNotFoundError);
  });

  it('should throw MarketImportInvalidTransitionError for pre-existing COMPLETED', async () => {
    repository.findById.mockResolvedValueOnce(mockBatch('COMPLETED'));

    await expect(service.execute({
      id: 'batch-1',
      delta: { parsedDelta: 0, acceptedDelta: 0, flaggedDelta: 0, quarantinedDelta: 0 }
    })).rejects.toThrow(MarketImportInvalidTransitionError);
    expect(repository.applyProgressDeltaConditional).not.toHaveBeenCalled();
  });

  it('should throw MarketImportInvalidTransitionError for pre-existing COMPLETED_WITH_QUARANTINE', async () => {
    repository.findById.mockResolvedValueOnce(mockBatch('COMPLETED_WITH_QUARANTINE'));

    await expect(service.execute({
      id: 'batch-1',
      delta: { parsedDelta: 0, acceptedDelta: 0, flaggedDelta: 0, quarantinedDelta: 0 }
    })).rejects.toThrow(MarketImportInvalidTransitionError);
  });

  it('should throw MarketImportInvalidTransitionError for pre-existing FAILED', async () => {
    repository.findById.mockResolvedValueOnce(mockBatch('FAILED'));

    await expect(service.execute({
      id: 'batch-1',
      delta: { parsedDelta: 0, acceptedDelta: 0, flaggedDelta: 0, quarantinedDelta: 0 }
    })).rejects.toThrow(MarketImportInvalidTransitionError);
  });

  it('should throw MarketDataConcurrencyConflictError on NO_MATCH and reread COMPLETED', async () => {
    repository.findById.mockResolvedValueOnce(mockBatch('PENDING'));
    repository.applyProgressDeltaConditional.mockResolvedValueOnce({ outcome: 'NO_MATCH' });
    repository.findById.mockResolvedValueOnce(mockBatch('COMPLETED'));

    await expect(service.execute({
      id: 'batch-1',
      delta: { parsedDelta: 0, acceptedDelta: 0, flaggedDelta: 0, quarantinedDelta: 0 }
    })).rejects.toThrow(MarketDataConcurrencyConflictError);
  });

  it('should throw MarketDataConcurrencyConflictError on NO_MATCH and reread COMPLETED_WITH_QUARANTINE', async () => {
    repository.findById.mockResolvedValueOnce(mockBatch('PENDING'));
    repository.applyProgressDeltaConditional.mockResolvedValueOnce({ outcome: 'NO_MATCH' });
    repository.findById.mockResolvedValueOnce(mockBatch('COMPLETED_WITH_QUARANTINE'));

    await expect(service.execute({
      id: 'batch-1',
      delta: { parsedDelta: 0, acceptedDelta: 0, flaggedDelta: 0, quarantinedDelta: 0 }
    })).rejects.toThrow(MarketDataConcurrencyConflictError);
  });

  it('should throw MarketDataConcurrencyConflictError on NO_MATCH and reread FAILED', async () => {
    repository.findById.mockResolvedValueOnce(mockBatch('PENDING'));
    repository.applyProgressDeltaConditional.mockResolvedValueOnce({ outcome: 'NO_MATCH' });
    repository.findById.mockResolvedValueOnce(mockBatch('FAILED'));

    await expect(service.execute({
      id: 'batch-1',
      delta: { parsedDelta: 0, acceptedDelta: 0, flaggedDelta: 0, quarantinedDelta: 0 }
    })).rejects.toThrow(MarketDataConcurrencyConflictError);
  });

  it('should throw MarketImportNotFoundError on NO_MATCH and reread missing', async () => {
    repository.findById.mockResolvedValueOnce(mockBatch('PENDING'));
    repository.applyProgressDeltaConditional.mockResolvedValueOnce({ outcome: 'NO_MATCH' });
    repository.findById.mockResolvedValueOnce(null);

    await expect(service.execute({
      id: 'batch-1',
      delta: { parsedDelta: 0, acceptedDelta: 0, flaggedDelta: 0, quarantinedDelta: 0 }
    })).rejects.toThrow(MarketImportNotFoundError);
  });

  it('should throw MarketDataIntegrityError on NO_MATCH and reread still PENDING', async () => {
    repository.findById.mockResolvedValueOnce(mockBatch('PENDING'));
    repository.applyProgressDeltaConditional.mockResolvedValueOnce({ outcome: 'NO_MATCH' });
    repository.findById.mockResolvedValueOnce(mockBatch('PENDING'));

    await expect(service.execute({
      id: 'batch-1',
      delta: { parsedDelta: 0, acceptedDelta: 0, flaggedDelta: 0, quarantinedDelta: 0 }
    })).rejects.toThrow(MarketDataIntegrityError);
  });

  it('should preserve typed repository error identity', async () => {
    const customError = new MarketDataIntegrityError('DB failed');
    repository.findById.mockRejectedValueOnce(customError);

    try {
      await service.execute({
        id: 'batch-1',
        delta: { parsedDelta: 0, acceptedDelta: 0, flaggedDelta: 0, quarantinedDelta: 0 }
      });
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBe(customError);
    }
  });

  it('should preserve ordinary Error identity', async () => {
    const error = new Error('Random error');
    repository.findById.mockRejectedValueOnce(error);

    try {
      await service.execute({
        id: 'batch-1',
        delta: { parsedDelta: 0, acceptedDelta: 0, flaggedDelta: 0, quarantinedDelta: 0 }
      });
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBe(error);
    }
  });
});
