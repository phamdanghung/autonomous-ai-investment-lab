import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { 
  BindDatasetSnapshotRunOriginService,
  BindDatasetSnapshotRunOriginRequest,
  DatasetSnapshotRunOriginNotFoundError,
  DatasetSnapshotRunOriginBindingIntegrityError
} from '../../../src/application/services/run-data-origin/BindDatasetSnapshotRunOriginService';
import { DatasetSnapshotRunOriginInvalidError } from '../../../src/domain/run-data-origin/DatasetSnapshotRunOrigin';
import { IDatasetSnapshotQueryRepository } from '../../../src/application/ports/market-data/DatasetSnapshotPorts';
import { ISimulationRunDataOriginBinder, BoundSimulationRunDataOrigin, BindSimulationRunDataOriginCommand } from '../../../src/application/ports/run-data-origin/RunDataOriginPorts';
import { DatasetSnapshot } from '../../../src/domain/market-data/DatasetSnapshot';

describe('BindDatasetSnapshotRunOriginService', () => {
  let mockSnapshotQuery: { findByBusinessKey: Mock };
  let mockRunBinder: { bind: Mock };
  let service: BindDatasetSnapshotRunOriginService;
  
  let validSnapshot: DatasetSnapshot;
  let validRequest: BindDatasetSnapshotRunOriginRequest;
  let validBinding: BoundSimulationRunDataOrigin;

  beforeEach(() => {
    mockSnapshotQuery = {
      findByBusinessKey: vi.fn()
    };
    
    mockRunBinder = {
      bind: vi.fn()
    };

    service = new BindDatasetSnapshotRunOriginService(
      mockSnapshotQuery as unknown as IDatasetSnapshotQueryRepository,
      mockRunBinder as unknown as ISimulationRunDataOriginBinder
    );

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

    validRequest = Object.freeze({
      runId: 'run-123',
      expectedVersion: 1,
      snapshotBusinessKey: 'a'.repeat(64),
      canonicalStartDate: '2025-01-15',
      idempotencyKey: 'idem-456',
      actor: {
        type: 'SYSTEM',
        id: 'sys-1'
      }
    });

    validBinding = Object.freeze({
      runId: 'run-123',
      version: 2,
      status: 'CONFIGURED',
      dataOriginHash: 'b'.repeat(64),
      canonicalStartDate: '2025-01-15',
      runBusinessKey: 'd'.repeat(64)
    });

    mockSnapshotQuery.findByBusinessKey.mockResolvedValue(validSnapshot);
    mockRunBinder.bind.mockResolvedValue(validBinding);
  });

  const expectAsyncError = async (req: any, errorClass: any, code: string) => {
    try {
      await service.execute(req);
      expect.fail('Expected error not thrown');
    } catch (e: any) {
      expect(e).toBeInstanceOf(errorClass);
      expect(e.code).toBe(code);
    }
  };

  it('A. valid request loads Snapshot and binds successfully', async () => {
    const res = await service.execute(validRequest);
    expect(res.origin.snapshotBusinessKey).toBe(validSnapshot.businessKey);
    expect(res.binding.runId).toBe(validRequest.runId);
  });

  it('B. query uses exact snapshotBusinessKey', async () => {
    await service.execute(validRequest);
    expect(mockSnapshotQuery.findByBusinessKey).toHaveBeenCalledWith(validRequest.snapshotBusinessKey);
    expect(mockSnapshotQuery.findByBusinessKey).toHaveBeenCalledTimes(1);
  });

  it('C. binder receives snapshot.contentHash exactly', async () => {
    await service.execute(validRequest);
    const cmd: BindSimulationRunDataOriginCommand = mockRunBinder.bind.mock.calls[0][0];
    expect(cmd.dataOriginHash).toBe(validSnapshot.contentHash);
  });

  it('D. caller extra dataOriginHash is ignored', async () => {
    const maliciousReq = {
      ...validRequest,
      dataOriginHash: 'evil-caller-hash'
    } as any;
    await service.execute(maliciousReq);
    const cmd: BindSimulationRunDataOriginCommand = mockRunBinder.bind.mock.calls[0][0];
    expect(cmd.dataOriginHash).toBe(validSnapshot.contentHash); // Should NOT be evil-caller-hash
  });

  it('E. canonicalStartDate forwarded exactly from validated origin', async () => {
    await service.execute(validRequest);
    const cmd: BindSimulationRunDataOriginCommand = mockRunBinder.bind.mock.calls[0][0];
    expect(cmd.canonicalStartDate).toBe(validRequest.canonicalStartDate);
  });

  it('F. runId forwarded exactly', async () => {
    await service.execute(validRequest);
    const cmd: BindSimulationRunDataOriginCommand = mockRunBinder.bind.mock.calls[0][0];
    expect(cmd.runId).toBe(validRequest.runId);
  });

  it('G. expectedVersion forwarded exactly', async () => {
    await service.execute(validRequest);
    const cmd: BindSimulationRunDataOriginCommand = mockRunBinder.bind.mock.calls[0][0];
    expect(cmd.expectedVersion).toBe(validRequest.expectedVersion);
  });

  it('H. idempotencyKey forwarded exactly', async () => {
    await service.execute(validRequest);
    const cmd: BindSimulationRunDataOriginCommand = mockRunBinder.bind.mock.calls[0][0];
    expect(cmd.idempotencyKey).toBe(validRequest.idempotencyKey);
  });

  it('I. actor forwarded exactly', async () => {
    await service.execute(validRequest);
    const cmd: BindSimulationRunDataOriginCommand = mockRunBinder.bind.mock.calls[0][0];
    expect(cmd.actor).toEqual(validRequest.actor);
  });

  it('J. result returns exact origin + binding', async () => {
    const res = await service.execute(validRequest);
    expect(res.origin.dataOriginHash).toBe(validSnapshot.contentHash);
    expect(res.binding).toEqual(validBinding);
  });

  it('K. malformed snapshotBusinessKey rejected before lookup', async () => {
    const badReq = { ...validRequest, snapshotBusinessKey: 'a'.repeat(63) };
    await expectAsyncError(badReq, DatasetSnapshotRunOriginInvalidError, 'DATASET_SNAPSHOT_RUN_ORIGIN_INVALID');
    expect(mockSnapshotQuery.findByBusinessKey).not.toHaveBeenCalled();
  });

  it('L. malformed canonicalStartDate rejected before lookup', async () => {
    const badReq = { ...validRequest, canonicalStartDate: '2025-01-1' };
    await expectAsyncError(badReq, DatasetSnapshotRunOriginInvalidError, 'DATASET_SNAPSHOT_RUN_ORIGIN_INVALID');
    expect(mockSnapshotQuery.findByBusinessKey).not.toHaveBeenCalled();
  });

  it('M. invalid runId rejected before lookup', async () => {
    const badReq = { ...validRequest, runId: ' run-123' };
    await expectAsyncError(badReq, DatasetSnapshotRunOriginInvalidError, 'DATASET_SNAPSHOT_RUN_ORIGIN_INVALID');
    expect(mockSnapshotQuery.findByBusinessKey).not.toHaveBeenCalled();
  });

  it('N. invalid expectedVersion rejected before lookup', async () => {
    const badReq = { ...validRequest, expectedVersion: 0 };
    await expectAsyncError(badReq, DatasetSnapshotRunOriginInvalidError, 'DATASET_SNAPSHOT_RUN_ORIGIN_INVALID');
    expect(mockSnapshotQuery.findByBusinessKey).not.toHaveBeenCalled();
  });

  it('O. invalid idempotencyKey rejected before lookup', async () => {
    const badReq = { ...validRequest, idempotencyKey: '' };
    await expectAsyncError(badReq, DatasetSnapshotRunOriginInvalidError, 'DATASET_SNAPSHOT_RUN_ORIGIN_INVALID');
    expect(mockSnapshotQuery.findByBusinessKey).not.toHaveBeenCalled();
  });

  it('P. invalid actor rejected before lookup', async () => {
    const badReq = { ...validRequest, actor: { type: '', id: 'sys-1' } };
    await expectAsyncError(badReq, DatasetSnapshotRunOriginInvalidError, 'DATASET_SNAPSHOT_RUN_ORIGIN_INVALID');
    expect(mockSnapshotQuery.findByBusinessKey).not.toHaveBeenCalled();
  });

  it('Q. missing Snapshot throws DatasetSnapshotRunOriginNotFoundError', async () => {
    mockSnapshotQuery.findByBusinessKey.mockResolvedValue(null);
    await expectAsyncError(validRequest, DatasetSnapshotRunOriginNotFoundError, 'DATASET_SNAPSHOT_RUN_ORIGIN_NOT_FOUND');
    expect(mockRunBinder.bind).not.toHaveBeenCalled();
  });

  it('R. DRAFT Snapshot propagates DatasetSnapshotRunOriginInvalidError', async () => {
    mockSnapshotQuery.findByBusinessKey.mockResolvedValue({ ...validSnapshot, status: 'DRAFT' });
    await expectAsyncError(validRequest, DatasetSnapshotRunOriginInvalidError, 'DATASET_SNAPSHOT_RUN_ORIGIN_INVALID');
    expect(mockRunBinder.bind).not.toHaveBeenCalled();
  });

  it('S. canonicalStartDate outside Snapshot range propagates domain error', async () => {
    mockSnapshotQuery.findByBusinessKey.mockResolvedValue({ ...validSnapshot, rangeStart: '2025-02-01', rangeEnd: '2025-02-28' });
    await expectAsyncError(validRequest, DatasetSnapshotRunOriginInvalidError, 'DATASET_SNAPSHOT_RUN_ORIGIN_INVALID');
    expect(mockRunBinder.bind).not.toHaveBeenCalled();
  });

  it('T. binder error object propagated by identity', async () => {
    const fakeError = new Error('Random binder error');
    mockRunBinder.bind.mockRejectedValue(fakeError);
    try {
      await service.execute(validRequest);
      expect.fail('Expected error not thrown');
    } catch (e) {
      expect(e).toBe(fakeError);
    }
  });

  it('U. mismatched binding.runId fails closed', async () => {
    mockRunBinder.bind.mockResolvedValue({ ...validBinding, runId: 'run-999' });
    await expectAsyncError(validRequest, DatasetSnapshotRunOriginBindingIntegrityError, 'DATASET_SNAPSHOT_RUN_ORIGIN_BINDING_INTEGRITY');
  });

  it('V. mismatched binding.status fails closed', async () => {
    mockRunBinder.bind.mockResolvedValue({ ...validBinding, status: 'DRAFT' });
    await expectAsyncError(validRequest, DatasetSnapshotRunOriginBindingIntegrityError, 'DATASET_SNAPSHOT_RUN_ORIGIN_BINDING_INTEGRITY');
  });

  it('W. mismatched binding.version fails closed', async () => {
    mockRunBinder.bind.mockResolvedValue({ ...validBinding, version: 1 }); // Expected is 2
    await expectAsyncError(validRequest, DatasetSnapshotRunOriginBindingIntegrityError, 'DATASET_SNAPSHOT_RUN_ORIGIN_BINDING_INTEGRITY');
  });

  it('X. mismatched binding.dataOriginHash fails closed', async () => {
    mockRunBinder.bind.mockResolvedValue({ ...validBinding, dataOriginHash: 'e'.repeat(64) });
    await expectAsyncError(validRequest, DatasetSnapshotRunOriginBindingIntegrityError, 'DATASET_SNAPSHOT_RUN_ORIGIN_BINDING_INTEGRITY');
  });

  it('Y. mismatched binding.canonicalStartDate fails closed', async () => {
    mockRunBinder.bind.mockResolvedValue({ ...validBinding, canonicalStartDate: '2025-01-01' });
    await expectAsyncError(validRequest, DatasetSnapshotRunOriginBindingIntegrityError, 'DATASET_SNAPSHOT_RUN_ORIGIN_BINDING_INTEGRITY');
  });

  it('Z. malformed binding.runBusinessKey fails closed', async () => {
    mockRunBinder.bind.mockResolvedValue({ ...validBinding, runBusinessKey: 'd'.repeat(63) });
    await expectAsyncError(validRequest, DatasetSnapshotRunOriginBindingIntegrityError, 'DATASET_SNAPSHOT_RUN_ORIGIN_BINDING_INTEGRITY');
  });

  it('AA. snapshot query call count exactly one on success', async () => {
    await service.execute(validRequest);
    expect(mockSnapshotQuery.findByBusinessKey).toHaveBeenCalledTimes(1);
  });

  it('AB. binder call count exactly one on success', async () => {
    await service.execute(validRequest);
    expect(mockRunBinder.bind).toHaveBeenCalledTimes(1);
  });

  it('AC. no binder call on pre-binding failures', async () => {
    const badReq = { ...validRequest, runId: ' run-123' };
    await expectAsyncError(badReq, DatasetSnapshotRunOriginInvalidError, 'DATASET_SNAPSHOT_RUN_ORIGIN_INVALID');
    expect(mockRunBinder.bind).not.toHaveBeenCalled();
  });

  it('AD. no retry on binder failure/integrity failure', async () => {
    mockRunBinder.bind.mockResolvedValue({ ...validBinding, runId: 'run-999' });
    await expectAsyncError(validRequest, DatasetSnapshotRunOriginBindingIntegrityError, 'DATASET_SNAPSHOT_RUN_ORIGIN_BINDING_INTEGRITY');
    expect(mockRunBinder.bind).toHaveBeenCalledTimes(1);
  });
});
