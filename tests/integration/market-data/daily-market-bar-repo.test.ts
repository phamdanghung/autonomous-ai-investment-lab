import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { setupIsolatedTestSchema, IsolatedTestSchema } from '../../utils/database';

import { PrismaDailyMarketBarRepository } from '../../../src/infrastructure/repositories/market-data/PrismaDailyMarketBarRepository';
import { RegisterDailyMarketBarService, RegisterDailyMarketBarRequest } from '../../../src/application/services/market-data/RegisterDailyMarketBarService';
import { PrismaMarketInstrumentQueryRepository } from '../../../src/infrastructure/repositories/market-data/PrismaMarketInstrumentRepository';
import { PrismaMarketDataSourceRepository } from '../../../src/infrastructure/repositories/market-data/PrismaMarketDataSourceRepository';
import { GetMarketDataSourceVersionService } from '../../../src/application/services/market-data/source-version/GetMarketDataSourceVersionService';

import { MarketDataIntegrityError, MarketImportInvalidTransitionError } from '../../../src/domain/market-data/MarketDataErrors';
import { DailyMarketBarUniqueCollisionError } from '../../../src/application/ports/market-data/DailyMarketBarPorts';
import { MarketInstrumentDomain } from '../../../src/domain/market-data/MarketInstrument';

describe('PrismaDailyMarketBarRepository Integration', () => {
  let isolatedSchema: IsolatedTestSchema;
  let prisma: PrismaClient;

  let dailyRepo: PrismaDailyMarketBarRepository;
  let instrumentRepo: PrismaMarketInstrumentQueryRepository;
  let sourceRepo: PrismaMarketDataSourceRepository;
  let getSourceVersionService: GetMarketDataSourceVersionService;
  let dailyService: RegisterDailyMarketBarService;

  const sourceFamily = 'daily-bar-integration';
  const sourceVersionKey = `VN|MARKET_DATA_SOURCE|${'a'.repeat(64)}`;
  let sourceVersionId: string;
  let instrumentId: string;
  const instrumentBusinessKey = MarketInstrumentDomain.buildBusinessKey('HOSE', 'DMBAR', 'EQUITY', '2025-01-01');

  let pendingBatchAId: string;
  let pendingBatchBId: string;
  let terminalBatchId: string;

  beforeAll(async () => {
    isolatedSchema = await setupIsolatedTestSchema('daily_bar_repo');
    prisma = new PrismaClient({ datasourceUrl: isolatedSchema.databaseUrl });
    await prisma.$connect();

    dailyRepo = new PrismaDailyMarketBarRepository(prisma);
    instrumentRepo = new PrismaMarketInstrumentQueryRepository(prisma);
    sourceRepo = new PrismaMarketDataSourceRepository(prisma, sourceFamily);
    getSourceVersionService = new GetMarketDataSourceVersionService(sourceRepo, sourceFamily);

    dailyService = new RegisterDailyMarketBarService(
      dailyRepo,
      dailyRepo,
      dailyRepo,
      getSourceVersionService,
      instrumentRepo
    );

    // 1. Seed SourceVersion
    const sv = await prisma.marketDataSourceVersion.create({
      data: {
        sourceKey: sourceVersionKey,
        contractHash: 'a'.repeat(64),
        providerCode: 'TEST',
        datasetKind: 'EOD_MARKET_DATA',
        adapterKind: 'REPOSITORY_CSV_FIXTURE',
        adapterVersion: '1.0',
        schemaVersion: '1.0',
        canonicalizationVersion: '1.0',
        priceUnit: 'VND_PER_SHARE',
        encoding: 'UTF8',
        sealedAt: new Date()
      }
    });
    sourceVersionId = sv.id;

    // 2. Seed Instrument
    const inst = await prisma.marketInstrument.create({
      data: {
        businessKey: instrumentBusinessKey,
        exchange: 'HOSE',
        canonicalSymbol: 'DMBAR',
        securityType: 'EQUITY',
        effectiveFrom: new Date(Date.UTC(2025, 0, 1)),
        effectiveTo: null,
        currency: 'VND',
        sealedAt: new Date()
      }
    });
    instrumentId = inst.id;

    // 3. Seed Import Batches
    const batchA = await prisma.marketDataImportBatch.create({
      data: {
        batchBusinessKey: 'batch-a-key',
        creationIdempotencyKey: 'idem-a',
        creationRequestHash: 'req-a',
        sourceVersionId,
        sourceObjectKey: 'obj-a',
        sourceContentHash: 'hash',
        sourceByteSize: 100n,
        importMode: 'INITIAL',
        status: 'PENDING',
        startedAt: new Date(),
      }
    });
    pendingBatchAId = batchA.id;

    const batchB = await prisma.marketDataImportBatch.create({
      data: {
        batchBusinessKey: 'batch-b-key',
        creationIdempotencyKey: 'idem-b',
        creationRequestHash: 'req-b',
        sourceVersionId,
        sourceObjectKey: 'obj-b',
        sourceContentHash: 'hash',
        sourceByteSize: 100n,
        importMode: 'INITIAL',
        status: 'PENDING',
        startedAt: new Date(),
      }
    });
    pendingBatchBId = batchB.id;

    const terminalBatch = await prisma.marketDataImportBatch.create({
      data: {
        batchBusinessKey: 'batch-t-key',
        creationIdempotencyKey: 'idem-t',
        creationRequestHash: 'req-t',
        sourceVersionId,
        sourceObjectKey: 'obj-t',
        sourceContentHash: 'hash',
        sourceByteSize: 100n,
        importMode: 'INITIAL',
        status: 'COMPLETED',
        startedAt: new Date(),
        completedAt: new Date(),
      }
    });
    terminalBatchId = terminalBatch.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await isolatedSchema.teardown();
  });

  const getBaseRequest = (overrides: Partial<RegisterDailyMarketBarRequest> = {}): RegisterDailyMarketBarRequest => ({
    importBatchId: pendingBatchAId,
    sourceVersionKey,
    sourceRecordKey: `rec-${Math.random().toString(36).substring(7)}`,
    instrumentBusinessKey,
    marketDate: '2025-01-15',
    barKind: 'TRADED',
    open: '100',
    high: '110',
    low: '90',
    close: '105',
    volume: '1000',
    tradingValue: '105000',
    correctionVersion: 0,
    qualityDecision: 'ACCEPTED',
    qualityFlags: '',
    sourceRowHash: 'a'.repeat(64),
    supersedesBarHash: null,
    ...overrides
  });

  it('TEST 1 - REAL SERVICE CREATE', async () => {
    const req = getBaseRequest({ sourceRecordKey: 'test-1-key', marketDate: '2025-01-10' });
    const result = await dailyService.execute(req);
    expect(result.outcome).toBe('CREATED');
    
    const bar = result.bar;
    expect(bar.id).toBeDefined();
    expect(bar.sourceVersionId).toBe(sourceVersionId);
    expect(bar.importBatchId).toBe(pendingBatchAId);
    expect(bar.instrumentId).toBe(instrumentId);
    expect(bar.sourceRecordKey).toBe('test-1-key');
    expect(bar.marketDate).toBe('2025-01-10');
    expect(bar.barKind).toBe('TRADED');
    expect(bar.open).toBe('100');
    expect(bar.high).toBe('110');
    expect(bar.low).toBe('90');
    expect(bar.close).toBe('105');
    expect(bar.volume).toBe('1000');
    expect(bar.tradingValue).toBe('105000');
    expect(bar.correctionVersion).toBe(0);
    expect(bar.supersedesBarId).toBe(null);
    expect(bar.qualityDecision).toBe('ACCEPTED');
    expect(bar.qualityFlags).toBe('');
    expect(bar.sourceRowHash).toBe('a'.repeat(64));
    expect(bar.canonicalHash.length).toBe(64);

    const dbRow = await prisma.dailyMarketBar.findUnique({ where: { id: bar.id } });
    expect(dbRow).toBeDefined();
    expect(dbRow!.recordedAt).toBeInstanceOf(Date);
    expect((bar as any).recordedAt).toBeUndefined();
  });

  it('TEST 2 - BIGINT PRECISION ROUNDTRIP', async () => {
    // 9007199254740993 is 2^53 + 1 (unsafe JS int)
    const req = getBaseRequest({
      marketDate: '2025-01-11',
      open: '9007199254740993',
      high: '9007199254740993',
      volume: '9007199254740993'
    });
    const result = await dailyService.execute(req);
    expect(result.bar.open).toBe('9007199254740993');
    expect(result.bar.volume).toBe('9007199254740993');

    // negative quarantined
    const reqNeg = getBaseRequest({
      marketDate: '2025-01-12',
      open: '-500',
      high: '-500',
      qualityDecision: 'QUARANTINED'
    });
    const resultNeg = await dailyService.execute(reqNeg);
    expect(resultNeg.bar.open).toBe('-500');
  });

  it('TEST 3 - QUERY METHODS AGAINST REAL DB', async () => {
    const req = getBaseRequest({ marketDate: '2025-01-13' });
    const result = await dailyService.execute(req);
    const bar = result.bar;

    const byHash = await dailyRepo.findByCanonicalHash(bar.canonicalHash);
    expect(byHash?.id).toBe(bar.id);

    const byIdentityA = await dailyRepo.findBySourceInstrumentDateVersion(
      sourceVersionId,
      instrumentId,
      bar.marketDate,
      bar.correctionVersion
    );
    expect(byIdentityA?.id).toBe(bar.id);

    const byIdentityB = await dailyRepo.findBySourceRecordVersion(
      sourceVersionId,
      bar.sourceRecordKey,
      bar.correctionVersion
    );
    expect(byIdentityB?.id).toBe(bar.id);

    expect(await dailyRepo.findByCanonicalHash('missing')).toBeNull();
  });

  it('TEST 4 - EXACT CANONICAL REPLAY', async () => {
    const req = getBaseRequest({ marketDate: '2025-01-14' });
    const first = await dailyService.execute(req);
    expect(first.outcome).toBe('CREATED');

    const second = await dailyService.execute(req);
    expect(second.outcome).toBe('REPLAYED');
    expect(second.bar.id).toBe(first.bar.id);

    const dbCount = await prisma.dailyMarketBar.count({ where: { canonicalHash: first.bar.canonicalHash } });
    expect(dbCount).toBe(1);
  });

  it('TEST 5 - DIFFERENT importBatchId REPLAY', async () => {
    const req = getBaseRequest({ importBatchId: pendingBatchAId, marketDate: '2025-01-15' });
    const first = await dailyService.execute(req);
    expect(first.outcome).toBe('CREATED');

    const reqB = { ...req, importBatchId: pendingBatchBId };
    const second = await dailyService.execute(reqB);
    expect(second.outcome).toBe('REPLAYED');
    expect(second.bar.id).toBe(first.bar.id);

    const dbCount = await prisma.dailyMarketBar.count({ where: { canonicalHash: first.bar.canonicalHash } });
    expect(dbCount).toBe(1);

    const dbRow = await prisma.dailyMarketBar.findUnique({ where: { id: first.bar.id } });
    expect(dbRow!.importBatchId).toBe(pendingBatchAId);
  });

  it('TEST 6 - REAL CORRECTION CHAIN', async () => {
    const reqV0 = getBaseRequest({ marketDate: '2025-01-16' });
    const v0 = await dailyService.execute(reqV0);

    const reqV1 = { 
      ...reqV0, 
      correctionVersion: 1, 
      supersedesBarHash: v0.bar.canonicalHash,
      open: '101', // change content
      high: '110'
    };
    const v1 = await dailyService.execute(reqV1);
    expect(v1.outcome).toBe('CREATED');
    expect(v1.bar.supersedesBarId).toBe(v0.bar.id);

    const lookup = await dailyRepo.findBySupersedesBarId(v0.bar.id);
    expect(lookup?.id).toBe(v1.bar.id);

    const chainCount = await prisma.dailyMarketBar.count({ 
      where: { sourceRecordKey: reqV0.sourceRecordKey } 
    });
    expect(chainCount).toBe(2);
  });

  it('TEST 7 - NO FORKED SUPERSESSION', async () => {
    const reqV0 = getBaseRequest({ marketDate: '2025-01-17' });
    const v0 = await dailyService.execute(reqV0);

    const reqV1 = { 
      ...reqV0, 
      correctionVersion: 1, 
      supersedesBarHash: v0.bar.canonicalHash,
      open: '101',
      high: '110'
    };
    await dailyService.execute(reqV1);

    const reqV1Prime = {
      ...reqV0,
      correctionVersion: 1,
      supersedesBarHash: v0.bar.canonicalHash,
      open: '102',
      high: '110'
    };
    
    await expect(dailyService.execute(reqV1Prime)).rejects.toThrowError(MarketDataIntegrityError);
    await expect(dailyService.execute(reqV1Prime)).rejects.toThrowError('Daily market bar predecessor has already been superseded.');
  });

  it('TEST 8 - IDENTITY A CONFLICT', async () => {
    const reqV0 = getBaseRequest({ marketDate: '2025-01-18' });
    await dailyService.execute(reqV0);

    const conflict = {
      ...reqV0,
      sourceRecordKey: 'different-key',
      open: '999', // Different canonical hash
      high: '999'
    };
    await expect(dailyService.execute(conflict)).rejects.toThrowError(MarketDataIntegrityError);
  });

  it('TEST 9 - IDENTITY B CONFLICT', async () => {
    const reqV0 = getBaseRequest({ marketDate: '2025-01-19' });
    await dailyService.execute(reqV0);

    const conflict = {
      ...reqV0,
      marketDate: '2025-01-20', // Different date, hence different canonical hash
      open: '999',
      high: '999'
    };
    await expect(dailyService.execute(conflict)).rejects.toThrowError(MarketDataIntegrityError);
  });

  it('TEST 10 - REAL P2002 -> TECHNICAL COLLISION', async () => {
    const cmd = {
      sourceVersionId,
      importBatchId: pendingBatchAId,
      sourceRecordKey: 'p2002-key',
      instrumentId,
      marketDate: '2025-01-21',
      barKind: 'TRADED' as any,
      open: '10',
      high: '10',
      low: '10',
      close: '10',
      volume: '10',
      tradingValue: '10',
      correctionVersion: 0,
      supersedesBarId: null,
      qualityDecision: 'ACCEPTED' as any,
      qualityFlags: '',
      sourceRowHash: 'hash',
      canonicalHash: 'canon-hash-p2002'
    };
    await dailyRepo.insert(cmd);

    // duplicate canonicalHash
    const dup = {
      ...cmd,
      sourceRecordKey: 'p2002-key-dup'
    };
    
    let caught: any;
    try {
      await dailyRepo.insert(dup);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect(caught.name).toBe('DailyMarketBarUniqueCollisionError');
    expect(caught.message).toBe('Daily market bar unique collision.');
  });

  it('TEST 11 - REAL FK VIOLATION', async () => {
    const cmd = {
      sourceVersionId: '542617f6-b18a-4467-8b06-4bf449f809d4', // missing uuid
      importBatchId: pendingBatchAId,
      sourceRecordKey: 'fk-key',
      instrumentId,
      marketDate: '2025-01-22',
      barKind: 'TRADED' as any,
      open: '10', high: '10', low: '10', close: '10', volume: '10', tradingValue: '10',
      correctionVersion: 0,
      supersedesBarId: null,
      qualityDecision: 'ACCEPTED' as any,
      qualityFlags: '',
      sourceRowHash: 'hash2',
      canonicalHash: 'canon-hash-fk'
    };
    
    // Asserting the actual observed defect (P2025 caught as generic Database integrity error)
    await expect(dailyRepo.insert(cmd)).rejects.toThrowError(MarketDataIntegrityError);
    await expect(dailyRepo.insert(cmd)).rejects.toThrowError('Database integrity error.');
  });

  it('TEST 12 - REAL QUALITY CHECK CONSTRAINT', async () => {
    const cmd = {
      sourceVersionId,
      importBatchId: pendingBatchAId,
      sourceRecordKey: 'chk-key',
      instrumentId,
      marketDate: '2025-01-23',
      barKind: 'TRADED' as any,
      open: '-1', // ACCEPTED bars cannot have negative values
      high: '10', low: '10', close: '10', volume: '10', tradingValue: '10',
      correctionVersion: 0,
      supersedesBarId: null,
      qualityDecision: 'ACCEPTED' as any,
      qualityFlags: '',
      sourceRowHash: 'hash3',
      canonicalHash: 'canon-hash-chk'
    };
    
    // Asserting the actual observed defect (PrismaClientUnknownRequestError)
    await expect(dailyRepo.insert(cmd)).rejects.toThrowError();
    await expect(dailyRepo.insert(cmd)).rejects.not.toThrowError(MarketDataIntegrityError);
  });

  it('TEST 13 - CORRECTION CHECK CONSTRAINT', async () => {
    const cmd = {
      sourceVersionId,
      importBatchId: pendingBatchAId,
      sourceRecordKey: 'chk-corr',
      instrumentId,
      marketDate: '2025-01-24',
      barKind: 'TRADED' as any,
      open: '10', high: '10', low: '10', close: '10', volume: '10', tradingValue: '10',
      correctionVersion: 1, // > 0 but supersedesBarId is null
      supersedesBarId: null,
      qualityDecision: 'ACCEPTED' as any,
      qualityFlags: '',
      sourceRowHash: 'hash4',
      canonicalHash: 'canon-hash-chk2'
    };
    
    // Asserting the actual observed defect (PrismaClientUnknownRequestError)
    await expect(dailyRepo.insert(cmd)).rejects.toThrowError();
    await expect(dailyRepo.insert(cmd)).rejects.not.toThrowError(MarketDataIntegrityError);
  });

  it('TEST 14 - REAL APPEND-ONLY UPDATE TRIGGER', async () => {
    const req = getBaseRequest({ marketDate: '2025-01-25' });
    const created = await dailyService.execute(req);
    const barId = created.bar.id;

    await expect(prisma.dailyMarketBar.update({
      where: { id: barId },
      data: { open: 999n }
    })).rejects.toThrowError(); 

    const dbRow = await prisma.dailyMarketBar.findUnique({ where: { id: barId } });
    expect(dbRow!.open).toBe(100n);
  });

  it('TEST 15 - REAL APPEND-ONLY DELETE TRIGGER', async () => {
    const req = getBaseRequest({ marketDate: '2025-01-26' });
    const created = await dailyService.execute(req);
    const barId = created.bar.id;

    await expect(prisma.dailyMarketBar.delete({
      where: { id: barId }
    })).rejects.toThrowError();

    const dbRow = await prisma.dailyMarketBar.findUnique({ where: { id: barId } });
    expect(dbRow).not.toBeNull();
  });

  it('TEST 16 - IMPORT BATCH NARROW LOOKUP', async () => {
    const batch = await dailyRepo.findById(pendingBatchAId);
    expect(batch).toEqual({
      id: pendingBatchAId,
      sourceVersionId,
      status: 'PENDING'
    });

    const terminal = await dailyRepo.findById(terminalBatchId);
    expect(terminal?.status).toBe('COMPLETED');

    const missing = await dailyRepo.findById('missing');
    expect(missing).toBeNull();
  });

  it('TEST 17 - TERMINAL BATCH SERVICE REJECTION', async () => {
    const req = getBaseRequest({ importBatchId: terminalBatchId, marketDate: '2025-01-27' });
    await expect(dailyService.execute(req)).rejects.toThrowError(MarketImportInvalidTransitionError);
  });

  it('TEST 18 - DATABASE-GENERATED recordedAt', async () => {
    const req = getBaseRequest({ marketDate: '2025-01-28' });
    const created = await dailyService.execute(req);
    const barId = created.bar.id;

    const dbRow = await prisma.dailyMarketBar.findUnique({ where: { id: barId } });
    expect(dbRow!.recordedAt).toBeInstanceOf(Date);
    expect((created.bar as any).recordedAt).toBeUndefined();
  });
});
