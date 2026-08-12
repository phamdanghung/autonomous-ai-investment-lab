import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RegisterDailyMarketBarService, RegisterDailyMarketBarRequest } from '../../../../src/application/services/market-data/RegisterDailyMarketBarService';
import {
  AppendDailyMarketBarCommand,
  DailyMarketBarImportBatchRef,
  DailyMarketBarUniqueCollisionError,
  IDailyMarketBarAppendRepository,
  IDailyMarketBarImportBatchLookup,
  IDailyMarketBarQueryRepository
} from '../../../../src/application/ports/market-data/DailyMarketBarPorts';
import { GetMarketDataSourceVersionService } from '../../../../src/application/services/market-data/source-version/GetMarketDataSourceVersionService';
import { MarketInstrumentRecord, IMarketInstrumentQueryRepository } from '../../../../src/application/ports/market-data/IMarketInstrumentQueryRepository';
import { MarketDataSourceVersion } from '../../../../src/domain/market-data/MarketDataSourceVersion';
import { DailyMarketBar } from '../../../../src/domain/market-data/DailyMarketBar';
import {
  DailyMarketBarInvalidError,
  MarketDataIntegrityError,
  MarketImportInvalidTransitionError,
  MarketImportNotFoundError,
  MarketInstrumentNotFoundError,
  MarketSourceVersionNotFoundError
} from '../../../../src/domain/market-data/MarketDataErrors';
import { DailyMarketBarDomain } from '../../../../src/domain/market-data/DailyMarketBar';

function createMocks() {
  const queryRepository: IDailyMarketBarQueryRepository = {
    findByCanonicalHash: vi.fn(),
    findBySourceInstrumentDateVersion: vi.fn(),
    findBySourceRecordVersion: vi.fn(),
    findBySupersedesBarId: vi.fn(),
  };
  const appendRepository: IDailyMarketBarAppendRepository = {
    insert: vi.fn(),
  };
  const importBatchLookup: IDailyMarketBarImportBatchLookup = {
    findById: vi.fn(),
  };
  const getSourceVersionService = {
    execute: vi.fn(),
  } as unknown as GetMarketDataSourceVersionService;
  const instrumentQueryRepository: IMarketInstrumentQueryRepository = {
    findByBusinessKey: vi.fn(),
    findById: vi.fn(),
    list: vi.fn(),
  };
  return { queryRepository, appendRepository, importBatchLookup, getSourceVersionService, instrumentQueryRepository };
}

describe('RegisterDailyMarketBarService', () => {
  let mocks = createMocks();
  let service: RegisterDailyMarketBarService;

  beforeEach(() => {
    mocks = createMocks();
    service = new RegisterDailyMarketBarService(
      mocks.queryRepository,
      mocks.appendRepository,
      mocks.importBatchLookup,
      mocks.getSourceVersionService,
      mocks.instrumentQueryRepository
    );
  });

  const validRequest: RegisterDailyMarketBarRequest = {
    importBatchId: 'batch-123',
    sourceVersionKey: 'VN|MARKET_DATA_SOURCE|' + '1'.repeat(64),
    sourceRecordKey: 'VN|MARKET_RECORD|' + '1'.repeat(64),
    instrumentBusinessKey: 'VN|HOSE|ABC|EQUITY|2024-01-01',
    marketDate: '2025-01-01',
    barKind: 'TRADED',
    open: '10000',
    high: '10000',
    low: '10000',
    close: '10000',
    volume: '100',
    tradingValue: '1000000',
    correctionVersion: 0,
    qualityDecision: 'ACCEPTED',
    qualityFlags: '',
    sourceRowHash: 'a'.repeat(64),
    supersedesBarHash: null,
  };

  const mockSourceVersion: MarketDataSourceVersion = {
    id: 'sv-1',
    sourceVersionKey: 'VN|MARKET_DATA_SOURCE|' + '1'.repeat(64),
  } as any;

  const mockInstrument: MarketInstrumentRecord = {
    id: 'inst-1',
    businessKey: 'VN|HOSE|ABC|EQUITY|2024-01-01',
    exchange: 'HOSE',
    canonicalSymbol: 'ABC',
    securityType: 'EQUITY',
    effectiveFrom: '2024-01-01',
    effectiveTo: null,
    sealedAt: '2024-01-01T00:00:00.000Z',
    createdAt: '2024-01-01T00:00:00.000Z'
  };

  const mockImportBatch: DailyMarketBarImportBatchRef = {
    id: 'batch-123',
    sourceVersionId: 'sv-1',
    status: 'PENDING'
  };

  const setupSuccess = () => {
    vi.mocked(mocks.getSourceVersionService.execute).mockResolvedValue(mockSourceVersion);
    vi.mocked(mocks.instrumentQueryRepository.findByBusinessKey).mockResolvedValue(mockInstrument);
    vi.mocked(mocks.importBatchLookup.findById).mockResolvedValue(mockImportBatch);
    vi.mocked(mocks.queryRepository.findByCanonicalHash).mockResolvedValue(null);
    vi.mocked(mocks.queryRepository.findBySourceInstrumentDateVersion).mockResolvedValue(null);
    vi.mocked(mocks.queryRepository.findBySourceRecordVersion).mockResolvedValue(null);
  };

  const getCanonicalHash = (req: RegisterDailyMarketBarRequest) => {
    const { importBatchId, ...payload } = req;
    return DailyMarketBarDomain.buildCanonicalHash(payload).hash;
  };

  it('A. Valid initial creation', async () => {
    setupSuccess();
    const mockBar = { id: 'bar-1' } as DailyMarketBar;
    vi.mocked(mocks.appendRepository.insert).mockResolvedValue(mockBar);

    const result = await service.execute(validRequest);
    expect(result.outcome).toBe('CREATED');
    expect(result.bar).toBe(mockBar);
    expect(mocks.appendRepository.insert).toHaveBeenCalledTimes(1);

    const command = vi.mocked(mocks.appendRepository.insert).mock.calls[0][0];
    expect(command.supersedesBarId).toBeNull();
  });

  it('B. Domain invalid short-circuit', async () => {
    const cases = [
      { ...validRequest, open: 'invalid' }, // malformed canonical integer
      { ...validRequest, correctionVersion: 1, supersedesBarHash: null }, // invalid correction relation
      { ...validRequest, sourceRowHash: 'short' } // invalid sourceRowHash
    ];
    for (const req of cases) {
      await expect(service.execute(req)).rejects.toThrow(DailyMarketBarInvalidError);
    }
    expect(mocks.getSourceVersionService.execute).not.toHaveBeenCalled();
    expect(mocks.instrumentQueryRepository.findByBusinessKey).not.toHaveBeenCalled();
    expect(mocks.importBatchLookup.findById).not.toHaveBeenCalled();
    expect(mocks.queryRepository.findByCanonicalHash).not.toHaveBeenCalled();
    expect(mocks.appendRepository.insert).not.toHaveBeenCalled();
  });

  it('C. Missing SourceVersion', async () => {
    setupSuccess();
    const error = new MarketSourceVersionNotFoundError();
    vi.mocked(mocks.getSourceVersionService.execute).mockRejectedValue(error);
    await expect(service.execute(validRequest)).rejects.toBe(error);
  });

  it('D. Missing Instrument', async () => {
    setupSuccess();
    vi.mocked(mocks.instrumentQueryRepository.findByBusinessKey).mockResolvedValue(null);
    await expect(service.execute(validRequest)).rejects.toThrow(MarketInstrumentNotFoundError);
  });

  describe('E. Instrument not active on marketDate', () => {
    it('marketDate before effectiveFrom', async () => {
      setupSuccess();
      vi.mocked(mocks.instrumentQueryRepository.findByBusinessKey).mockResolvedValue({
        ...mockInstrument,
        effectiveFrom: '2026-01-01'
      });
      await expect(service.execute(validRequest)).rejects.toThrow(DailyMarketBarInvalidError);
    });

    it('marketDate after non-null effectiveTo', async () => {
      setupSuccess();
      vi.mocked(mocks.instrumentQueryRepository.findByBusinessKey).mockResolvedValue({
        ...mockInstrument,
        effectiveTo: '2024-12-31'
      });
      await expect(service.execute(validRequest)).rejects.toThrow(DailyMarketBarInvalidError);
    });

    it('boundary effectiveFrom allowed', async () => {
      setupSuccess();
      vi.mocked(mocks.instrumentQueryRepository.findByBusinessKey).mockResolvedValue({
        ...mockInstrument,
        effectiveFrom: validRequest.marketDate
      });
      const mockBar = { id: 'bar-1' } as DailyMarketBar;
      vi.mocked(mocks.appendRepository.insert).mockResolvedValue(mockBar);
      const res = await service.execute(validRequest);
      expect(res.outcome).toBe('CREATED');
    });

    it('boundary effectiveTo allowed', async () => {
      setupSuccess();
      vi.mocked(mocks.instrumentQueryRepository.findByBusinessKey).mockResolvedValue({
        ...mockInstrument,
        effectiveTo: validRequest.marketDate
      });
      const mockBar = { id: 'bar-1' } as DailyMarketBar;
      vi.mocked(mocks.appendRepository.insert).mockResolvedValue(mockBar);
      const res = await service.execute(validRequest);
      expect(res.outcome).toBe('CREATED');
    });
  });

  it('F. Missing ImportBatch', async () => {
    setupSuccess();
    vi.mocked(mocks.importBatchLookup.findById).mockResolvedValue(null);
    await expect(service.execute(validRequest)).rejects.toThrow(MarketImportNotFoundError);
  });

  it('G. ImportBatch/source mismatch', async () => {
    setupSuccess();
    vi.mocked(mocks.importBatchLookup.findById).mockResolvedValue({
      ...mockImportBatch,
      sourceVersionId: 'other-sv'
    });
    await expect(service.execute(validRequest)).rejects.toThrow(MarketDataIntegrityError);
  });

  describe('H. Terminal ImportBatch', () => {
    it('COMPLETED', async () => {
      setupSuccess();
      vi.mocked(mocks.importBatchLookup.findById).mockResolvedValue({
        ...mockImportBatch,
        status: 'COMPLETED'
      });
      await expect(service.execute(validRequest)).rejects.toThrow(MarketImportInvalidTransitionError);
    });

    it('COMPLETED_WITH_QUARANTINE', async () => {
      setupSuccess();
      vi.mocked(mocks.importBatchLookup.findById).mockResolvedValue({
        ...mockImportBatch,
        status: 'COMPLETED_WITH_QUARANTINE'
      });
      await expect(service.execute(validRequest)).rejects.toThrow(MarketImportInvalidTransitionError);
    });

    it('FAILED', async () => {
      setupSuccess();
      vi.mocked(mocks.importBatchLookup.findById).mockResolvedValue({
        ...mockImportBatch,
        status: 'FAILED'
      });
      await expect(service.execute(validRequest)).rejects.toThrow(MarketImportInvalidTransitionError);
    });
  });

  it('I. PENDING ImportBatch', async () => {
    setupSuccess(); // Default is PENDING
    const mockBar = { id: 'bar-1' } as DailyMarketBar;
    vi.mocked(mocks.appendRepository.insert).mockResolvedValue(mockBar);
    const result = await service.execute(validRequest);
    expect(result.outcome).toBe('CREATED');
  });

  it('J. Canonical replay', async () => {
    setupSuccess();
    const existing: DailyMarketBar = {
      id: 'bar-existing',
      sourceVersionId: mockSourceVersion.id,
      instrumentId: mockInstrument.id,
      sourceRecordKey: validRequest.sourceRecordKey,
      marketDate: validRequest.marketDate,
      correctionVersion: validRequest.correctionVersion,
      canonicalHash: getCanonicalHash(validRequest),
    } as any;
    vi.mocked(mocks.queryRepository.findByCanonicalHash).mockResolvedValue(existing);

    const result = await service.execute(validRequest);
    expect(result.outcome).toBe('REPLAYED');
    expect(result.bar).toBe(existing);
    expect(mocks.appendRepository.insert).not.toHaveBeenCalled();
  });

  it('J2. Canonical replay with different importBatchId', async () => {
    setupSuccess();
    const newReq = { ...validRequest, importBatchId: 'batch-999' };
    vi.mocked(mocks.importBatchLookup.findById).mockResolvedValue({
      id: 'batch-999',
      sourceVersionId: mockSourceVersion.id,
      status: 'PENDING'
    });
    const existing: DailyMarketBar = {
      id: 'bar-existing',
      sourceVersionId: mockSourceVersion.id,
      instrumentId: mockInstrument.id,
      sourceRecordKey: newReq.sourceRecordKey,
      marketDate: newReq.marketDate,
      correctionVersion: newReq.correctionVersion,
      canonicalHash: getCanonicalHash(newReq),
    } as any;
    vi.mocked(mocks.queryRepository.findByCanonicalHash).mockResolvedValue(existing);

    const result = await service.execute(newReq);
    expect(result.outcome).toBe('REPLAYED');
    expect(result.bar).toBe(existing);
    expect(mocks.appendRepository.insert).not.toHaveBeenCalled();
  });

  it('K. Canonical hash inconsistent identity', async () => {
    setupSuccess();
    const existing: DailyMarketBar = {
      id: 'bar-existing',
      sourceVersionId: 'different-sv', // Mismatch!
      instrumentId: mockInstrument.id,
      sourceRecordKey: validRequest.sourceRecordKey,
      marketDate: validRequest.marketDate,
      correctionVersion: validRequest.correctionVersion,
      canonicalHash: getCanonicalHash(validRequest),
    } as any;
    vi.mocked(mocks.queryRepository.findByCanonicalHash).mockResolvedValue(existing);

    await expect(service.execute(validRequest)).rejects.toThrow(MarketDataIntegrityError);
  });

  it('L. Initial bar', async () => {
    setupSuccess(); // correctionVersion 0
    const mockBar = { id: 'bar-1' } as DailyMarketBar;
    vi.mocked(mocks.appendRepository.insert).mockResolvedValue(mockBar);

    await service.execute(validRequest);
    // supersedesBarHash is null, no predecessor lookup
    const callCount = vi.mocked(mocks.queryRepository.findByCanonicalHash).mock.calls.length;
    // 1 call for canonical replay check
    expect(callCount).toBe(1);
    expect(vi.mocked(mocks.queryRepository.findBySupersedesBarId)).not.toHaveBeenCalled();
  });

  const correctionRequest = {
    ...validRequest,
    correctionVersion: 1,
    supersedesBarHash: 'b'.repeat(64),
  };

  const setupCorrection = () => {
    setupSuccess();
    const predecessor: DailyMarketBar = {
      id: 'bar-0',
      sourceVersionId: mockSourceVersion.id,
      instrumentId: mockInstrument.id,
      marketDate: correctionRequest.marketDate,
      sourceRecordKey: correctionRequest.sourceRecordKey,
      correctionVersion: 0,
      canonicalHash: 'b'.repeat(64),
    } as any;
    // Mock findByCanonicalHash: first call is replay check (returns null), second is predecessor lookup
    vi.mocked(mocks.queryRepository.findByCanonicalHash).mockImplementation((hash: string) => {
      if (hash === getCanonicalHash(correctionRequest)) return Promise.resolve(null);
      if (hash === 'b'.repeat(64)) return Promise.resolve(predecessor);
      return Promise.resolve(null);
    });
    vi.mocked(mocks.queryRepository.findBySupersedesBarId).mockResolvedValue(null);
  };

  it('M. Valid correction', async () => {
    setupCorrection();
    const mockBar = { id: 'bar-1' } as DailyMarketBar;
    vi.mocked(mocks.appendRepository.insert).mockResolvedValue(mockBar);

    const result = await service.execute(correctionRequest);
    expect(result.outcome).toBe('CREATED');
    expect(vi.mocked(mocks.appendRepository.insert).mock.calls[0][0].supersedesBarId).toBe('bar-0');
  });

  it('M2. Exact N-1 correction rule (v3 -> v2 allowed)', async () => {
    setupSuccess();
    const v3Req = { ...validRequest, correctionVersion: 3, supersedesBarHash: 'b'.repeat(64) };
    const predecessorV2: DailyMarketBar = {
      id: 'bar-v2',
      sourceVersionId: mockSourceVersion.id,
      instrumentId: mockInstrument.id,
      marketDate: v3Req.marketDate,
      sourceRecordKey: v3Req.sourceRecordKey,
      correctionVersion: 2, // exactly N-1
      canonicalHash: 'b'.repeat(64),
    } as any;
    
    vi.mocked(mocks.queryRepository.findByCanonicalHash).mockImplementation(async (hash: string) => {
      if (hash === 'b'.repeat(64)) return predecessorV2;
      return null;
    });
    
    const mockBar = { id: 'bar-v3' } as DailyMarketBar;
    vi.mocked(mocks.appendRepository.insert).mockResolvedValue(mockBar);

    const result = await service.execute(v3Req);
    expect(result.outcome).toBe('CREATED');
    expect(vi.mocked(mocks.appendRepository.insert).mock.calls[0][0].supersedesBarId).toBe('bar-v2');
  });

  it('M3. Exact N-1 correction rule (v3 -> v1 rejected)', async () => {
    setupSuccess();
    const v3Req = { ...validRequest, correctionVersion: 3, supersedesBarHash: 'c'.repeat(64) };
    const predecessorV1: DailyMarketBar = {
      id: 'bar-v1',
      sourceVersionId: mockSourceVersion.id,
      instrumentId: mockInstrument.id,
      marketDate: v3Req.marketDate,
      sourceRecordKey: v3Req.sourceRecordKey,
      correctionVersion: 1, // NOT N-1
      canonicalHash: 'c'.repeat(64),
    } as any;
    
    vi.mocked(mocks.queryRepository.findByCanonicalHash).mockImplementation(async (hash: string) => {
      if (hash === 'c'.repeat(64)) return predecessorV1;
      return null;
    });

    await expect(service.execute(v3Req)).rejects.toThrow(/correction predecessor is inconsistent/);
  });

  it('N. Missing predecessor', async () => {
    setupCorrection();
    vi.mocked(mocks.queryRepository.findByCanonicalHash).mockImplementation((hash: string) => {
      return Promise.resolve(null); // Neither replay nor predecessor found
    });
    await expect(service.execute(correctionRequest)).rejects.toThrow(/Daily market bar predecessor was not found/);
  });

  it('O. Predecessor source mismatch', async () => {
    setupCorrection();
    vi.mocked(mocks.queryRepository.findByCanonicalHash).mockImplementation(async (hash) => {
      if (hash === 'b'.repeat(64)) return {
        id: 'bar-0', sourceVersionId: 'other', instrumentId: mockInstrument.id,
        marketDate: correctionRequest.marketDate, sourceRecordKey: correctionRequest.sourceRecordKey, correctionVersion: 0, canonicalHash: hash
      } as any;
      return null;
    });
    await expect(service.execute(correctionRequest)).rejects.toThrow(/correction predecessor is inconsistent/);
  });

  it('P. Predecessor instrument mismatch', async () => {
    setupCorrection();
    vi.mocked(mocks.queryRepository.findByCanonicalHash).mockImplementation(async (hash) => {
      if (hash === 'b'.repeat(64)) return {
        id: 'bar-0', sourceVersionId: mockSourceVersion.id, instrumentId: 'other',
        marketDate: correctionRequest.marketDate, sourceRecordKey: correctionRequest.sourceRecordKey, correctionVersion: 0, canonicalHash: hash
      } as any;
      return null;
    });
    await expect(service.execute(correctionRequest)).rejects.toThrow(/correction predecessor is inconsistent/);
  });

  it('Q. Predecessor marketDate mismatch', async () => {
    setupCorrection();
    vi.mocked(mocks.queryRepository.findByCanonicalHash).mockImplementation(async (hash) => {
      if (hash === 'b'.repeat(64)) return {
        id: 'bar-0', sourceVersionId: mockSourceVersion.id, instrumentId: mockInstrument.id,
        marketDate: '2020-01-01', sourceRecordKey: correctionRequest.sourceRecordKey, correctionVersion: 0, canonicalHash: hash
      } as any;
      return null;
    });
    await expect(service.execute(correctionRequest)).rejects.toThrow(/correction predecessor is inconsistent/);
  });

  it('R. Predecessor sourceRecordKey mismatch', async () => {
    setupCorrection();
    vi.mocked(mocks.queryRepository.findByCanonicalHash).mockImplementation(async (hash) => {
      if (hash === 'b'.repeat(64)) return {
        id: 'bar-0', sourceVersionId: mockSourceVersion.id, instrumentId: mockInstrument.id,
        marketDate: correctionRequest.marketDate, sourceRecordKey: 'other', correctionVersion: 0, canonicalHash: hash
      } as any;
      return null;
    });
    await expect(service.execute(correctionRequest)).rejects.toThrow(/correction predecessor is inconsistent/);
  });

  it('S. Predecessor correctionVersion mismatch', async () => {
    setupCorrection();
    vi.mocked(mocks.queryRepository.findByCanonicalHash).mockImplementation(async (hash) => {
      if (hash === 'b'.repeat(64)) return {
        id: 'bar-0', sourceVersionId: mockSourceVersion.id, instrumentId: mockInstrument.id,
        marketDate: correctionRequest.marketDate, sourceRecordKey: correctionRequest.sourceRecordKey, correctionVersion: 99, canonicalHash: hash
      } as any;
      return null;
    });
    await expect(service.execute(correctionRequest)).rejects.toThrow(/correction predecessor is inconsistent/);
  });

  it('T. Predecessor already superseded', async () => {
    setupCorrection();
    const requestHash = getCanonicalHash(correctionRequest);
    
    // Test 1: Same hash -> REPLAYED
    vi.mocked(mocks.queryRepository.findBySupersedesBarId).mockResolvedValue({
      id: 'bar-fork',
      canonicalHash: requestHash
    } as any);
    const res1 = await service.execute(correctionRequest);
    expect(res1.outcome).toBe('REPLAYED');
    
    // Test 2: Different hash -> Throw
    vi.mocked(mocks.queryRepository.findBySupersedesBarId).mockResolvedValue({
      id: 'bar-fork-diff',
      canonicalHash: 'c'.repeat(64)
    } as any);
    await expect(service.execute(correctionRequest)).rejects.toThrow(/already been superseded/);
  });

  it('U. Identity A exact replay', async () => {
    setupSuccess();
    const requestHash = getCanonicalHash(validRequest);
    vi.mocked(mocks.queryRepository.findBySourceInstrumentDateVersion).mockResolvedValue({
      id: 'bar-x',
      canonicalHash: requestHash
    } as any);
    const res = await service.execute(validRequest);
    expect(res.outcome).toBe('REPLAYED');
  });

  it('V. Identity A conflicting content', async () => {
    setupSuccess();
    vi.mocked(mocks.queryRepository.findBySourceInstrumentDateVersion).mockResolvedValue({
      id: 'bar-x',
      canonicalHash: 'c'.repeat(64)
    } as any);
    await expect(service.execute(validRequest)).rejects.toThrow(/conflicts with existing canonical content/);
  });

  it('W. Identity B exact replay', async () => {
    setupSuccess();
    const requestHash = getCanonicalHash(validRequest);
    vi.mocked(mocks.queryRepository.findBySourceRecordVersion).mockResolvedValue({
      id: 'bar-y',
      canonicalHash: requestHash
    } as any);
    const res = await service.execute(validRequest);
    expect(res.outcome).toBe('REPLAYED');
  });

  it('X. Identity B conflicting content', async () => {
    setupSuccess();
    vi.mocked(mocks.queryRepository.findBySourceRecordVersion).mockResolvedValue({
      id: 'bar-y',
      canonicalHash: 'd'.repeat(64)
    } as any);
    await expect(service.execute(validRequest)).rejects.toThrow(/conflicts with existing canonical content/);
  });

  it('Y. Exact append command', async () => {
    setupSuccess();
    const mockBar = { id: 'bar-1' } as DailyMarketBar;
    vi.mocked(mocks.appendRepository.insert).mockResolvedValue(mockBar);

    await service.execute(validRequest);
    const command = vi.mocked(mocks.appendRepository.insert).mock.calls[0][0];

    const expectedKeys = [
      'sourceVersionId', 'importBatchId', 'instrumentId', 'sourceRecordKey',
      'marketDate', 'barKind', 'open', 'high', 'low', 'close', 'volume',
      'tradingValue', 'correctionVersion', 'supersedesBarId', 'qualityDecision',
      'qualityFlags', 'sourceRowHash', 'canonicalHash'
    ].sort();
    
    expect(Object.keys(command).sort()).toEqual(expectedKeys);

    expect(command).toStrictEqual({
      sourceVersionId: mockSourceVersion.id,
      importBatchId: validRequest.importBatchId,
      instrumentId: mockInstrument.id,
      sourceRecordKey: validRequest.sourceRecordKey,
      marketDate: validRequest.marketDate,
      barKind: validRequest.barKind,
      open: validRequest.open,
      high: validRequest.high,
      low: validRequest.low,
      close: validRequest.close,
      volume: validRequest.volume,
      tradingValue: validRequest.tradingValue,
      correctionVersion: validRequest.correctionVersion,
      supersedesBarId: null,
      qualityDecision: validRequest.qualityDecision,
      qualityFlags: validRequest.qualityFlags,
      sourceRowHash: validRequest.sourceRowHash,
      canonicalHash: getCanonicalHash(validRequest),
    });
    
    // Explicit exclusions
    expect((command as any).sourceVersionKey).toBeUndefined();
    expect((command as any).instrumentBusinessKey).toBeUndefined();
    expect((command as any).supersedesBarHash).toBeUndefined();
    expect((command as any).recordedAt).toBeUndefined();
    expect((command as any).barContractVersion).toBeUndefined();
  });

  describe('Z - AB. Technical unique collision', () => {
    it('Z. Technical unique collision -> replay', async () => {
      setupSuccess();
      vi.mocked(mocks.appendRepository.insert).mockRejectedValue(new DailyMarketBarUniqueCollisionError());
      
      const requestHash = getCanonicalHash(validRequest);
      
      // On retry, findByCanonicalHash returns exact match
      vi.mocked(mocks.queryRepository.findByCanonicalHash).mockResolvedValueOnce(null); // Pre-flight
      vi.mocked(mocks.queryRepository.findByCanonicalHash).mockResolvedValueOnce({
        id: 'bar-z',
        sourceVersionId: mockSourceVersion.id,
        instrumentId: mockInstrument.id,
        sourceRecordKey: validRequest.sourceRecordKey,
        marketDate: validRequest.marketDate,
        correctionVersion: validRequest.correctionVersion,
        canonicalHash: requestHash,
      } as any); // Retry

      const res = await service.execute(validRequest);
      expect(res.outcome).toBe('REPLAYED');
      expect(res.bar.id).toBe('bar-z');
    });

    it('AA. Technical unique collision -> conflicting identity (Identity A)', async () => {
      setupSuccess();
      vi.mocked(mocks.appendRepository.insert).mockRejectedValue(new DailyMarketBarUniqueCollisionError());
      
      vi.mocked(mocks.queryRepository.findByCanonicalHash).mockResolvedValue(null);
      // On retry, Identity A is found with different hash
      vi.mocked(mocks.queryRepository.findBySourceInstrumentDateVersion).mockResolvedValueOnce(null);
      vi.mocked(mocks.queryRepository.findBySourceInstrumentDateVersion).mockResolvedValueOnce({
        id: 'bar-z',
        canonicalHash: 'diff'
      } as any);

      await expect(service.execute(validRequest)).rejects.toThrow(/conflicts with existing canonical content/);
    });

    it('AA2. Technical unique collision -> identical identity (Identity A)', async () => {
      setupSuccess();
      vi.mocked(mocks.appendRepository.insert).mockRejectedValue(new DailyMarketBarUniqueCollisionError());
      
      const requestHash = getCanonicalHash(validRequest);
      
      vi.mocked(mocks.queryRepository.findByCanonicalHash).mockResolvedValue(null);
      // On retry, Identity A is found with matching canonical hash
      vi.mocked(mocks.queryRepository.findBySourceInstrumentDateVersion).mockImplementation(async (sv, inst, date, ver) => {
        if (sv === mockSourceVersion.id && inst === mockInstrument.id && date === validRequest.marketDate && ver === validRequest.correctionVersion) {
          return {
            id: 'bar-a-replay',
            canonicalHash: requestHash
          } as any;
        }
        return null;
      });

      const res = await service.execute(validRequest);
      expect(res.outcome).toBe('REPLAYED');
      expect(res.bar.id).toBe('bar-a-replay');
    });

    it('AA3. Technical unique collision -> identical identity (Identity B)', async () => {
      setupSuccess();
      vi.mocked(mocks.appendRepository.insert).mockRejectedValue(new DailyMarketBarUniqueCollisionError());
      
      const requestHash = getCanonicalHash(validRequest);
      
      vi.mocked(mocks.queryRepository.findByCanonicalHash).mockResolvedValue(null);
      vi.mocked(mocks.queryRepository.findBySourceInstrumentDateVersion).mockResolvedValue(null);
      // On retry, Identity B is found with matching canonical hash
      vi.mocked(mocks.queryRepository.findBySourceRecordVersion).mockImplementation(async (sv, record, ver) => {
        if (sv === mockSourceVersion.id && record === validRequest.sourceRecordKey && ver === validRequest.correctionVersion) {
          return {
            id: 'bar-b-replay',
            canonicalHash: requestHash
          } as any;
        }
        return null;
      });

      const res = await service.execute(validRequest);
      expect(res.outcome).toBe('REPLAYED');
      expect(res.bar.id).toBe('bar-b-replay');
    });

    it('AB. Technical unique collision -> unresolved', async () => {
      setupSuccess();
      vi.mocked(mocks.appendRepository.insert).mockRejectedValue(new DailyMarketBarUniqueCollisionError());
      
      // Return null for everything on retry
      vi.mocked(mocks.queryRepository.findByCanonicalHash).mockResolvedValue(null);
      vi.mocked(mocks.queryRepository.findBySourceInstrumentDateVersion).mockResolvedValue(null);
      vi.mocked(mocks.queryRepository.findBySourceRecordVersion).mockResolvedValue(null);
      vi.mocked(mocks.queryRepository.findBySupersedesBarId).mockResolvedValue(null);

      await expect(service.execute(validRequest)).rejects.toThrow(/could not be resolved/);
    });
  });

  it('AC. Non-collision repository error', async () => {
    setupSuccess();
    const error = new Error('Database down');
    vi.mocked(mocks.appendRepository.insert).mockRejectedValue(error);
    
    await expect(service.execute(validRequest)).rejects.toBe(error);
  });

  describe('Application Architecture Scan', () => {
    it('should not contain forbidden imports', () => {
      const fs = require('fs');
      const path = require('path');
      
      const portsPath = path.resolve(__dirname, '../../../../src/application/ports/market-data/DailyMarketBarPorts.ts');
      const servicePath = path.resolve(__dirname, '../../../../src/application/services/market-data/RegisterDailyMarketBarService.ts');
      
      const checkFile = (filepath: string) => {
        const content = fs.readFileSync(filepath, 'utf-8');
        expect(content).not.toMatch(/@prisma\/client/);
        expect(content).not.toMatch(/from 'prisma'/);
        expect(content).not.toMatch(/\/infrastructure\//);
        expect(content).not.toMatch(/\$queryRaw/);
        expect(content).not.toMatch(/\$executeRaw/);
      };
      
      checkFile(portsPath);
      checkFile(servicePath);
    });
  });

});
