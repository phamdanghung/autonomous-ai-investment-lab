import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import {
  LegacySimulationRunDataOriginBinder,
  LegacyBindDataOriginExecutor,
  LegacySimulationRunDataOriginBinderIntegrityError
} from '../../../src/infrastructure/adapters/run-data-origin/LegacySimulationRunDataOriginBinder';
import { BindSimulationRunDataOriginCommand } from '../../../src/application/ports/run-data-origin/RunDataOriginPorts';

describe('LegacySimulationRunDataOriginBinder', () => {
  let mockExecutor: { execute: Mock };
  let binder: LegacySimulationRunDataOriginBinder;
  let validCommand: BindSimulationRunDataOriginCommand;
  let validLegacyResult: any;

  beforeEach(() => {
    mockExecutor = {
      execute: vi.fn()
    };
    binder = new LegacySimulationRunDataOriginBinder(mockExecutor as unknown as LegacyBindDataOriginExecutor);

    validCommand = Object.freeze({
      runId: 'run-123',
      expectedVersion: 1,
      dataOriginHash: 'b'.repeat(64),
      canonicalStartDate: '2025-01-15',
      idempotencyKey: 'idem-456',
      actor: {
        type: 'SYSTEM',
        id: 'sys-1'
      }
    });

    validLegacyResult = {
      id: 'run-123',
      version: 2,
      status: 'CONFIGURED',
      dataOriginHash: 'b'.repeat(64),
      canonicalStartDate: '2025-01-15',
      runBusinessKey: 'd'.repeat(64)
    };

    mockExecutor.execute.mockResolvedValue(validLegacyResult);
  });

  const expectIntegrityError = async (cmd: any) => {
    try {
      await binder.bind(cmd);
      expect.fail('Expected error not thrown');
    } catch (e: any) {
      expect(e).toBeInstanceOf(LegacySimulationRunDataOriginBinderIntegrityError);
      expect(e.code).toBe('LEGACY_SIMULATION_RUN_DATA_ORIGIN_BINDER_INTEGRITY');
    }
  };

  it('A. valid command maps exactly to legacy execute arguments', async () => {
    const res = await binder.bind(validCommand);
    expect(mockExecutor.execute).toHaveBeenCalledWith(
      validCommand.runId,
      validCommand.expectedVersion,
      {
        dataOriginHash: validCommand.dataOriginHash,
        canonicalStartDate: validCommand.canonicalStartDate,
        idempotencyKey: validCommand.idempotencyKey
      },
      {
        type: validCommand.actor.type,
        id: validCommand.actor.id
      }
    );
    expect(res.runId).toBe(validCommand.runId);
  });

  it('B. executor called exactly once', async () => {
    await binder.bind(validCommand);
    expect(mockExecutor.execute).toHaveBeenCalledTimes(1);
  });

  it('C. returned Date canonicalStartDate maps to YYYY-MM-DD', async () => {
    mockExecutor.execute.mockResolvedValue({
      ...validLegacyResult,
      canonicalStartDate: new Date('2025-01-15T12:00:00Z')
    });
    const res = await binder.bind(validCommand);
    expect(res.canonicalStartDate).toBe('2025-01-15');
  });

  it('D. returned strict string canonicalStartDate accepted', async () => {
    const res = await binder.bind(validCommand);
    expect(res.canonicalStartDate).toBe('2025-01-15');
  });

  it('E. runId mismatch rejected', async () => {
    mockExecutor.execute.mockResolvedValue({ ...validLegacyResult, id: 'run-999' });
    await expectIntegrityError(validCommand);
  });

  it('F. version mismatch rejected', async () => {
    mockExecutor.execute.mockResolvedValue({ ...validLegacyResult, version: 3 });
    await expectIntegrityError(validCommand);
  });

  it('G. status mismatch rejected', async () => {
    mockExecutor.execute.mockResolvedValue({ ...validLegacyResult, status: 'DRAFT' });
    await expectIntegrityError(validCommand);
  });

  it('H. dataOriginHash mismatch rejected', async () => {
    mockExecutor.execute.mockResolvedValue({ ...validLegacyResult, dataOriginHash: 'e'.repeat(64) });
    await expectIntegrityError(validCommand);
  });

  it('I. canonicalStartDate mismatch rejected', async () => {
    mockExecutor.execute.mockResolvedValue({ ...validLegacyResult, canonicalStartDate: '2025-01-16' });
    await expectIntegrityError(validCommand);
  });

  it('J. malformed runBusinessKey rejected', async () => {
    mockExecutor.execute.mockResolvedValue({ ...validLegacyResult, runBusinessKey: 'd'.repeat(63) });
    await expectIntegrityError(validCommand);
  });

  it('K. null result rejected', async () => {
    mockExecutor.execute.mockResolvedValue(null);
    await expectIntegrityError(validCommand);
  });

  it('L. primitive result rejected', async () => {
    mockExecutor.execute.mockResolvedValue('run-123');
    await expectIntegrityError(validCommand);
  });

  it('M. invalid Date rejected', async () => {
    mockExecutor.execute.mockResolvedValue({
      ...validLegacyResult,
      canonicalStartDate: new Date('invalid-date-string')
    });
    await expectIntegrityError(validCommand);
  });

  describe('N. malformed date string validation', () => {
    it.each([
      ['2025-01'],
      ['2025-1-15'],
      ['2025-02-30'],
      ['2025-01-15T00:00:00Z'],
      [' 2025-01-15']
    ])('rejects %s even if command date matches', async (badDate) => {
      const badCommand = { ...validCommand, canonicalStartDate: badDate };
      mockExecutor.execute.mockResolvedValue({
        ...validLegacyResult,
        canonicalStartDate: badDate
      });
      await expectIntegrityError(badCommand);
    });
  });

  it('O. executor error propagated by object identity', async () => {
    const fakeError = new Error('Random executor error');
    mockExecutor.execute.mockRejectedValue(fakeError);
    try {
      await binder.bind(validCommand);
      expect.fail('Expected error not thrown');
    } catch (e) {
      expect(e).toBe(fakeError);
    }
  });

  it('P. no retry after executor failure', async () => {
    const fakeError = new Error('Random executor error');
    mockExecutor.execute.mockRejectedValue(fakeError);
    try {
      await binder.bind(validCommand);
    } catch (e) {}
    expect(mockExecutor.execute).toHaveBeenCalledTimes(1);
  });

  it('Q. no rehash/transformation of dataOriginHash', async () => {
    await binder.bind(validCommand);
    const args = mockExecutor.execute.mock.calls[0];
    expect(args[2].dataOriginHash).toBe(validCommand.dataOriginHash);
  });

  it('R. actor forwarded exactly', async () => {
    await binder.bind(validCommand);
    const args = mockExecutor.execute.mock.calls[0];
    expect(args[3]).toEqual(validCommand.actor);
  });

  it('S. idempotency key forwarded exactly', async () => {
    await binder.bind(validCommand);
    const args = mockExecutor.execute.mock.calls[0];
    expect(args[2].idempotencyKey).toBe(validCommand.idempotencyKey);
  });

  it('T. expectedVersion forwarded as legacy version argument', async () => {
    await binder.bind(validCommand);
    const args = mockExecutor.execute.mock.calls[0];
    expect(args[1]).toBe(validCommand.expectedVersion);
  });

  it('U. array result rejected', async () => {
    mockExecutor.execute.mockResolvedValue([{ ...validLegacyResult }]);
    await expectIntegrityError(validCommand);
  });
});
