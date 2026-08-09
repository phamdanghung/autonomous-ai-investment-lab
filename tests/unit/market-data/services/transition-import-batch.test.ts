import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TransitionImportBatchService, TransitionImportBatchRequest } from '../../../../src/application/services/market-data/TransitionImportBatchService';
import { ImportBatchMutationRepository } from '../../../../src/application/ports/market-data/ImportBatchMutationPorts';
import { IClock } from '../../../../src/application/ports/IClock';
import { MarketDataImportBatch } from '../../../../src/domain/market-data/MarketDataImportBatch';
import { MarketImportNotFoundError, MarketImportInvalidTransitionError, MarketDataConcurrencyConflictError, MarketDataIntegrityError } from '../../../../src/domain/market-data/MarketDataErrors';

describe('TransitionImportBatchService', () => {
  let repository: import('vitest').Mocked<ImportBatchMutationRepository>;
  let clock: import('vitest').Mocked<IClock>;
  let service: TransitionImportBatchService;

  const mockBatch = (status: any = 'PENDING'): MarketDataImportBatch => ({
    id: 'batch-1',
    sourceVersionId: 'sv-1',
    creationIdempotencyKey: 'idemp-1',
    creationRequestHash: 'hash-1',
    batchBusinessKey: 'biz-1',
    importMode: 'INITIAL',
    status,
    parsedRowCount: 10,
    acceptedRowCount: 10,
    flaggedRowCount: 0,
    quarantinedRowCount: 0
  });

  const frozenTime = new Date('2026-08-09T10:00:00Z');

  beforeEach(() => {
    repository = {
      findById: vi.fn(),
      applyProgressDeltaConditional: vi.fn(),
      transitionConditional: vi.fn()
    };
    clock = {
      now: vi.fn().mockReturnValue(frozenTime)
    };
    service = new TransitionImportBatchService(repository, clock);
  });

  it('should transition PENDING -> PENDING, call no clock, and preserve UPDATED record identity', async () => {
    const record = mockBatch('PENDING');
    repository.findById.mockResolvedValueOnce(record);
    const updatedRecord = { ...record };
    repository.transitionConditional.mockResolvedValueOnce({ outcome: 'UPDATED', record: updatedRecord });

    const result = await service.execute({ id: 'batch-1', targetStatus: 'PENDING' });

    expect(result).toBe(updatedRecord);
    expect(repository.transitionConditional).toHaveBeenCalledWith({
      id: 'batch-1',
      targetStatus: 'PENDING',
      completedAt: null,
      failedAt: null,
      failureCode: null
    });
    expect(clock.now).not.toHaveBeenCalled();
  });

  it('should transition PENDING -> COMPLETED and forward correct completedAt', async () => {
    const record = mockBatch('PENDING');
    repository.findById.mockResolvedValueOnce(record);
    const updatedRecord = mockBatch('COMPLETED');
    repository.transitionConditional.mockResolvedValueOnce({ outcome: 'UPDATED', record: updatedRecord });

    const result = await service.execute({ id: 'batch-1', targetStatus: 'COMPLETED' });

    expect(result).toBe(updatedRecord);
    expect(repository.transitionConditional).toHaveBeenCalledWith({
      id: 'batch-1',
      targetStatus: 'COMPLETED',
      completedAt: frozenTime,
      failedAt: null,
      failureCode: null
    });
    expect(clock.now).toHaveBeenCalledTimes(1);
  });

  it('should transition PENDING -> COMPLETED_WITH_QUARANTINE and forward correct completedAt', async () => {
    const record = mockBatch('PENDING');
    repository.findById.mockResolvedValueOnce(record);
    const updatedRecord = mockBatch('COMPLETED_WITH_QUARANTINE');
    repository.transitionConditional.mockResolvedValueOnce({ outcome: 'UPDATED', record: updatedRecord });

    const result = await service.execute({ id: 'batch-1', targetStatus: 'COMPLETED_WITH_QUARANTINE' });

    expect(result).toBe(updatedRecord);
    expect(repository.transitionConditional).toHaveBeenCalledWith({
      id: 'batch-1',
      targetStatus: 'COMPLETED_WITH_QUARANTINE',
      completedAt: frozenTime,
      failedAt: null,
      failureCode: null
    });
    expect(clock.now).toHaveBeenCalledTimes(1);
  });

  it('should transition PENDING -> FAILED and forward correct failedAt and failureCode', async () => {
    const record = mockBatch('PENDING');
    repository.findById.mockResolvedValueOnce(record);
    const updatedRecord = mockBatch('FAILED');
    repository.transitionConditional.mockResolvedValueOnce({ outcome: 'UPDATED', record: updatedRecord });

    const result = await service.execute({ id: 'batch-1', targetStatus: 'FAILED', failureCode: 'SOME_ERROR' });

    expect(result).toBe(updatedRecord);
    expect(repository.transitionConditional).toHaveBeenCalledWith({
      id: 'batch-1',
      targetStatus: 'FAILED',
      completedAt: null,
      failedAt: frozenTime,
      failureCode: 'SOME_ERROR'
    });
    expect(clock.now).toHaveBeenCalledTimes(1);
  });

  it('should transition PENDING -> FAILED with empty failureCode ("")', async () => {
    const record = mockBatch('PENDING');
    repository.findById.mockResolvedValueOnce(record);
    const updatedRecord = mockBatch('FAILED');
    repository.transitionConditional.mockResolvedValueOnce({ outcome: 'UPDATED', record: updatedRecord });

    const result = await service.execute({ id: 'batch-1', targetStatus: 'FAILED', failureCode: '' });

    expect(result).toBe(updatedRecord);
    expect(repository.transitionConditional).toHaveBeenCalledWith({
      id: 'batch-1',
      targetStatus: 'FAILED',
      completedAt: null,
      failedAt: frozenTime,
      failureCode: ''
    });
  });

  it('should throw MarketImportNotFoundError for unknown preflight ID', async () => {
    repository.findById.mockResolvedValueOnce(null);

    await expect(service.execute({ id: 'batch-1', targetStatus: 'COMPLETED' }))
      .rejects.toThrow(MarketImportNotFoundError);
    expect(repository.transitionConditional).not.toHaveBeenCalled();
  });

  it('should throw MarketImportInvalidTransitionError for pre-existing COMPLETED -> COMPLETED', async () => {
    repository.findById.mockResolvedValueOnce(mockBatch('COMPLETED'));

    await expect(service.execute({ id: 'batch-1', targetStatus: 'COMPLETED' }))
      .rejects.toThrow(MarketImportInvalidTransitionError);
  });

  it('should throw MarketImportInvalidTransitionError for pre-existing COMPLETED -> FAILED', async () => {
    repository.findById.mockResolvedValueOnce(mockBatch('COMPLETED'));

    await expect(service.execute({ id: 'batch-1', targetStatus: 'FAILED', failureCode: 'E1' }))
      .rejects.toThrow(MarketImportInvalidTransitionError);
  });

  it('should throw MarketImportInvalidTransitionError for pre-existing COMPLETED_WITH_QUARANTINE -> PENDING', async () => {
    repository.findById.mockResolvedValueOnce(mockBatch('COMPLETED_WITH_QUARANTINE'));

    await expect(service.execute({ id: 'batch-1', targetStatus: 'PENDING' }))
      .rejects.toThrow(MarketImportInvalidTransitionError);
  });

  it('should throw MarketImportInvalidTransitionError for pre-existing FAILED -> FAILED', async () => {
    repository.findById.mockResolvedValueOnce(mockBatch('FAILED'));

    await expect(service.execute({ id: 'batch-1', targetStatus: 'FAILED', failureCode: 'E1' }))
      .rejects.toThrow(MarketImportInvalidTransitionError);
  });

  it('should throw MarketImportInvalidTransitionError for pre-existing FAILED -> COMPLETED', async () => {
    repository.findById.mockResolvedValueOnce(mockBatch('FAILED'));

    await expect(service.execute({ id: 'batch-1', targetStatus: 'COMPLETED' }))
      .rejects.toThrow(MarketImportInvalidTransitionError);
  });

  it('should throw MarketDataConcurrencyConflictError on NO_MATCH after PENDING + reread terminal (different target)', async () => {
    repository.findById.mockResolvedValueOnce(mockBatch('PENDING'));
    repository.transitionConditional.mockResolvedValueOnce({ outcome: 'NO_MATCH' });
    repository.findById.mockResolvedValueOnce(mockBatch('FAILED'));

    await expect(service.execute({ id: 'batch-1', targetStatus: 'COMPLETED' }))
      .rejects.toThrow(MarketDataConcurrencyConflictError);
  });

  it('should throw MarketDataConcurrencyConflictError on NO_MATCH after PENDING + reread terminal (same-target after lost race)', async () => {
    repository.findById.mockResolvedValueOnce(mockBatch('PENDING'));
    repository.transitionConditional.mockResolvedValueOnce({ outcome: 'NO_MATCH' });
    repository.findById.mockResolvedValueOnce(mockBatch('COMPLETED'));

    await expect(service.execute({ id: 'batch-1', targetStatus: 'COMPLETED' }))
      .rejects.toThrow(MarketDataConcurrencyConflictError);
  });

  it('should throw MarketImportNotFoundError on NO_MATCH + reread missing', async () => {
    repository.findById.mockResolvedValueOnce(mockBatch('PENDING'));
    repository.transitionConditional.mockResolvedValueOnce({ outcome: 'NO_MATCH' });
    repository.findById.mockResolvedValueOnce(null);

    await expect(service.execute({ id: 'batch-1', targetStatus: 'COMPLETED' }))
      .rejects.toThrow(MarketImportNotFoundError);
  });

  it('should throw MarketDataIntegrityError on NO_MATCH + reread still PENDING', async () => {
    repository.findById.mockResolvedValueOnce(mockBatch('PENDING'));
    repository.transitionConditional.mockResolvedValueOnce({ outcome: 'NO_MATCH' });
    repository.findById.mockResolvedValueOnce(mockBatch('PENDING'));

    await expect(service.execute({ id: 'batch-1', targetStatus: 'COMPLETED' }))
      .rejects.toThrow(MarketDataIntegrityError);
  });

  it('should preserve typed repository error identity', async () => {
    const customError = new MarketDataIntegrityError('DB failed');
    repository.findById.mockRejectedValueOnce(customError);

    try {
      await service.execute({ id: 'batch-1', targetStatus: 'COMPLETED' });
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBe(customError);
    }
  });

  it('should preserve ordinary Error identity', async () => {
    const error = new Error('Random error');
    repository.findById.mockRejectedValueOnce(error);

    try {
      await service.execute({ id: 'batch-1', targetStatus: 'COMPLETED' });
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBe(error);
    }
  });
});
