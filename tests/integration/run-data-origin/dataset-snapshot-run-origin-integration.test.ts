import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupIsolatedTestSchema, IsolatedTestSchema } from '../../utils/database';
import { PrismaClient } from '@prisma/client';
import { IdempotencyKeyReusedError } from '../../../src/domain/errors/DomainErrors';
import { DatasetSnapshotRunOriginInvalidError } from '../../../src/domain/run-data-origin/DatasetSnapshotRunOrigin';

let isolatedSchema: IsolatedTestSchema | null = null;
let originalDbUrl: string | undefined;
let prisma: PrismaClient;

// Dynamic imports
let BindDatasetSnapshotRunOriginService: any;
let LegacySimulationRunDataOriginBinder: any;
let CreateSimulationRunService: any;
let PrismaDatasetSnapshotRepository: any;

const SNAPSHOT_BUSINESS_KEY = 'a'.repeat(64);
const CONTENT_HASH = 'b'.repeat(64);
const DATA_CUTOFF_KEY = 'c'.repeat(64);
const UNIVERSE_HASH = 'd'.repeat(64);
const MANIFEST_HASH = 'e'.repeat(64);
const IDEMPOTENCY_KEY_DRAFT = 'f'.repeat(64);

const DATE_START = new Date('2025-01-01T00:00:00.000Z');
const DATE_END = new Date('2025-01-31T23:00:00.000Z');
const DATE_CUTOFF = new Date('2025-01-31T23:00:00.000Z');

// We need a helper to seed snapshot since D1-D4 use a SEALED one
async function seedSealedSnapshot(businessKey: string, contentHash: string) {
  const snapshotRepo = new PrismaDatasetSnapshotRepository(prisma);
  await snapshotRepo.createSealed({
    draft: {
      businessKey,
      sourceVersionId: '10000000-0000-0000-0000-000000000001',
      rangeStart: '2025-01-01',
      rangeEnd: '2025-01-31',
      universeDefinitionJson: '[]',
      universeHash: UNIVERSE_HASH,
      dataCutoffKey: DATA_CUTOFF_KEY,
      dataCutoffAt: DATE_CUTOFF,
      canonicalizationVersion: '1',
      rowCount: 0,
      manifestHash: MANIFEST_HASH,
      contentHash,
      status: 'DRAFT',
      creationIdempotencyKey: 'idem-' + businessKey,
      creationRequestHash: 'req-' + businessKey
    },
    entries: [],
    sealedAt: DATE_CUTOFF,
  });
}

describe('DatasetSnapshot -> SimulationRun Origin Integration', () => {
  beforeAll(async () => {
    isolatedSchema = await setupIsolatedTestSchema('dataset_snapshot_run_origin_int');
    originalDbUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = isolatedSchema.databaseUrl;

    prisma = new PrismaClient({
      datasourceUrl: isolatedSchema.databaseUrl
    });
    await prisma.$connect();

    const CreateSimModule = await import('../../../src/application/services/CreateSimulationRunService');
    CreateSimulationRunService = CreateSimModule.CreateSimulationRunService;

    const BindServiceModule = await import('../../../src/application/services/run-data-origin/BindDatasetSnapshotRunOriginService');
    BindDatasetSnapshotRunOriginService = BindServiceModule.BindDatasetSnapshotRunOriginService;

    const LegacyBinderModule = await import('../../../src/infrastructure/adapters/run-data-origin/LegacySimulationRunDataOriginBinder');
    LegacySimulationRunDataOriginBinder = LegacyBinderModule.LegacySimulationRunDataOriginBinder;

    const PrismaSnapshotRepoModule = await import('../../../src/infrastructure/repositories/market-data/PrismaDatasetSnapshotRepository');
    PrismaDatasetSnapshotRepository = PrismaSnapshotRepoModule.PrismaDatasetSnapshotRepository;

    await prisma.marketDataSourceVersion.create({
      data: {
        id: '10000000-0000-0000-0000-000000000001',
        providerCode: 'PROVIDER',
        datasetKind: 'EOD_MARKET_DATA',
        adapterKind: 'REPOSITORY_CSV_FIXTURE',
        adapterVersion: '1',
        schemaVersion: '1',
        canonicalizationVersion: '1',
        priceUnit: 'VND_PER_SHARE',
        encoding: 'UTF8',
        contractHash: '0000000000000000000000000000000000000000000000000000000000000000',
        sourceKey: 'test-key',
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        sealedAt: new Date('2025-01-01T00:00:00.000Z')
      }
    });
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
    if (isolatedSchema) await isolatedSchema.teardown();
    if (originalDbUrl !== undefined) process.env.DATABASE_URL = originalDbUrl;
    else delete process.env.DATABASE_URL;
  });

  let d1RunId = '';
  const bindIdempotencyKeyD1 = '1'.repeat(64);
  let d1ResultGlobal: any = null;

  it('D1 — first bind', async () => {
    await seedSealedSnapshot(SNAPSHOT_BUSINESS_KEY, CONTENT_HASH);

    const createResult = await CreateSimulationRunService.execute(
      {
        configData: {
          mode: 'HISTORICAL_REPLAY',
          initialCapital: '100000',
          codeVersion: 'v1.0.0',
          rngSeed: '12341',
          fillPolicyVersionKey: 'f'.repeat(64),
          orchestrationVersionKey: 'o'.repeat(64)
        },
        mode: 'HISTORICAL_REPLAY',
        creationIdempotencyKey: 'c'.repeat(64)
      },
      { type: 'SYSTEM', id: 'sys-1' }
    );
    d1RunId = createResult.id;

    const runBefore = await prisma.simulationRun.findUnique({ where: { id: d1RunId } });
    expect(runBefore?.status).toBe('INITIALIZED');
    expect(runBefore?.version).toBe(1);
    expect(runBefore?.dataOriginHash).toBeNull();
    expect(runBefore?.canonicalStartDate).toBeNull();

    const eventsBefore = await prisma.simulationRunEvent.findMany({ where: { runId: d1RunId }, orderBy: { eventSequence: 'asc' } });
    expect(eventsBefore).toHaveLength(1);
    expect(eventsBefore[0].eventSequence).toBe(1);
    expect(eventsBefore[0].eventType).toBe('RUN_CREATED');

    const snapshotRepo = new PrismaDatasetSnapshotRepository(prisma);
    const legacyBinder = new LegacySimulationRunDataOriginBinder();
    const bridgeService = new BindDatasetSnapshotRunOriginService(snapshotRepo, legacyBinder);

    const d1Result = await bridgeService.execute({
      runId: d1RunId,
      expectedVersion: 1,
      snapshotBusinessKey: SNAPSHOT_BUSINESS_KEY,
      canonicalStartDate: '2025-01-15',
      idempotencyKey: bindIdempotencyKeyD1,
      actor: { type: 'SYSTEM', id: 'sys-1' }
    });
    d1ResultGlobal = d1Result;

    expect(d1Result.origin.dataOriginHash).toBe(CONTENT_HASH);
    expect(d1Result.binding.runId).toBe(d1RunId);
    expect(d1Result.binding.version).toBe(2);
    expect(d1Result.binding.status).toBe('CONFIGURED');
    expect(d1Result.binding.dataOriginHash).toBe(CONTENT_HASH);
    expect(d1Result.binding.canonicalStartDate).toBe('2025-01-15');
    expect(d1Result.binding.runBusinessKey).toMatch(/^[a-f0-9]{64}$/);

    const runAfter = await prisma.simulationRun.findUnique({ where: { id: d1RunId } });
    expect(runAfter?.status).toBe('CONFIGURED');
    expect(runAfter?.version).toBe(2);
    expect(runAfter?.dataOriginHash).toBe(CONTENT_HASH);
    expect(runAfter?.canonicalStartDate?.toISOString().substring(0, 10)).toBe('2025-01-15');
    expect(runAfter?.simulationDate?.toISOString().substring(0, 10)).toBe('2025-01-15');
    expect(runAfter?.runBusinessKey).toBe(d1Result.binding.runBusinessKey);

    const eventsAfter = await prisma.simulationRunEvent.findMany({ where: { runId: d1RunId }, orderBy: { eventSequence: 'asc' } });
    expect(eventsAfter).toHaveLength(2);
    expect(eventsAfter[0].eventSequence).toBe(1);
    expect(eventsAfter[1].eventSequence).toBe(2);
    expect(eventsAfter[0].eventType).toBe('RUN_CREATED');
    expect(eventsAfter[1].eventType).toBe('DATA_BOUND');
    expect(eventsAfter[1].idempotencyKey).toBe(bindIdempotencyKeyD1);
    expect(eventsAfter[1].toStatus).toBe('CONFIGURED');
    expect(eventsAfter[1].simulationDateAfter?.toISOString().substring(0, 10)).toBe('2025-01-15');
  });

  it('D2 — exact idempotent replay', async () => {
    // Requires independent setup
    const businessKeyD2 = '2'.repeat(64);
    await seedSealedSnapshot(businessKeyD2, CONTENT_HASH);

    const createResult = await CreateSimulationRunService.execute(
      {
        configData: {
          mode: 'HISTORICAL_REPLAY',
          initialCapital: '100000',
          codeVersion: 'v1.0.0',
          rngSeed: '12342',
          fillPolicyVersionKey: 'f'.repeat(64),
          orchestrationVersionKey: 'o'.repeat(64)
        },
        mode: 'HISTORICAL_REPLAY',
        creationIdempotencyKey: '2'.repeat(64)
      },
      { type: 'SYSTEM', id: 'sys-1' }
    );
    const runId = createResult.id;

    const snapshotRepo = new PrismaDatasetSnapshotRepository(prisma);
    const legacyBinder = new LegacySimulationRunDataOriginBinder();
    const bridgeService = new BindDatasetSnapshotRunOriginService(snapshotRepo, legacyBinder);

    const bindIdempotencyKey = 'b'.repeat(64);

    // First bind
    const firstResult = await bridgeService.execute({
      runId,
      expectedVersion: 1,
      snapshotBusinessKey: businessKeyD2,
      canonicalStartDate: '2025-01-15',
      idempotencyKey: bindIdempotencyKey,
      actor: { type: 'SYSTEM', id: 'sys-1' }
    });

    const runInDbFirst = await prisma.simulationRun.findUnique({ where: { id: runId } });
    const eventsFirst = await prisma.simulationRunEvent.findMany({ where: { runId } });

    // Idempotent Replay
    const secondResult = await bridgeService.execute({
      runId,
      expectedVersion: 1,
      snapshotBusinessKey: businessKeyD2,
      canonicalStartDate: '2025-01-15',
      idempotencyKey: bindIdempotencyKey,
      actor: { type: 'SYSTEM', id: 'sys-1' }
    });

    expect(secondResult.binding.runId).toBe(firstResult.binding.runId);
    expect(secondResult.binding.version).toBe(2);
    expect(secondResult.binding.status).toBe('CONFIGURED');
    expect(secondResult.binding.dataOriginHash).toBe(firstResult.binding.dataOriginHash);
    expect(secondResult.binding.canonicalStartDate).toBe(firstResult.binding.canonicalStartDate);
    expect(secondResult.binding.runBusinessKey).toBe(firstResult.binding.runBusinessKey);

    const runInDbSecond = await prisma.simulationRun.findUnique({ where: { id: runId } });
    expect(runInDbSecond?.status).toBe('CONFIGURED');
    expect(runInDbSecond?.version).toBe(2);
    expect(runInDbSecond?.dataOriginHash).toBe(runInDbFirst?.dataOriginHash);
    expect(runInDbSecond?.canonicalStartDate?.getTime()).toBe(runInDbFirst?.canonicalStartDate?.getTime());
    expect(runInDbSecond?.simulationDate?.getTime()).toBe(runInDbFirst?.simulationDate?.getTime());
    expect(runInDbSecond?.runBusinessKey).toBe(runInDbFirst?.runBusinessKey);

    const eventsSecond = await prisma.simulationRunEvent.findMany({ where: { runId } });
    expect(eventsSecond).toHaveLength(2); // total events still 2
    expect(eventsSecond.filter(e => e.eventType === 'DATA_BOUND')).toHaveLength(1); // exactly 1 DATA_BOUND

    const eventIdsFirst = eventsFirst.map(e => e.id).sort();
    const eventIdsSecond = eventsSecond.map(e => e.id).sort();
    expect(eventIdsSecond).toEqual(eventIdsFirst); // no new event IDs
  });

  it('D3 — cross-run idempotency reuse', async () => {
    const businessKeyD3 = '3'.repeat(64);
    await seedSealedSnapshot(businessKeyD3, CONTENT_HASH);

    const createA = await CreateSimulationRunService.execute(
      {
        configData: {
          mode: 'HISTORICAL_REPLAY',
          initialCapital: '100000',
          codeVersion: 'v1.0.0',
          rngSeed: '12343',
          fillPolicyVersionKey: 'f'.repeat(64),
          orchestrationVersionKey: 'o'.repeat(64)
        },
        mode: 'HISTORICAL_REPLAY',
        creationIdempotencyKey: '3'.repeat(63) + 'a'
      },
      { type: 'SYSTEM', id: 'sys-1' }
    );
    const runAId = createA.id;

    const createB = await CreateSimulationRunService.execute(
      {
        configData: {
          mode: 'HISTORICAL_REPLAY',
          initialCapital: '100000',
          codeVersion: 'v1.0.0',
          rngSeed: '12344',
          fillPolicyVersionKey: 'f'.repeat(64),
          orchestrationVersionKey: 'o'.repeat(64)
        },
        mode: 'HISTORICAL_REPLAY',
        creationIdempotencyKey: '3'.repeat(63) + 'b'
      },
      { type: 'SYSTEM', id: 'sys-1' }
    );
    const runBId = createB.id;

    const snapshotRepo = new PrismaDatasetSnapshotRepository(prisma);
    const legacyBinder = new LegacySimulationRunDataOriginBinder();
    const bridgeService = new BindDatasetSnapshotRunOriginService(snapshotRepo, legacyBinder);

    const bindK = '3'.repeat(64);

    await bridgeService.execute({
      runId: runAId,
      expectedVersion: 1,
      snapshotBusinessKey: businessKeyD3,
      canonicalStartDate: '2025-01-15',
      idempotencyKey: bindK,
      actor: { type: 'SYSTEM', id: 'sys-1' }
    });

    try {
      await bridgeService.execute({
        runId: runBId,
        expectedVersion: 1,
        snapshotBusinessKey: businessKeyD3,
        canonicalStartDate: '2025-01-15',
        idempotencyKey: bindK,
        actor: { type: 'SYSTEM', id: 'sys-1' }
      });
      throw new Error('Should have rejected');
    } catch (e: any) {
      expect(e).toBeInstanceOf(IdempotencyKeyReusedError);
    }

    const runBInDb = await prisma.simulationRun.findUnique({ where: { id: runBId } });
    expect(runBInDb?.status).toBe('INITIALIZED');
    expect(runBInDb?.version).toBe(1);
    expect(runBInDb?.dataOriginHash).toBeNull();
    expect(runBInDb?.canonicalStartDate).toBeNull();
    expect(runBInDb?.runBusinessKey).toBeNull();

    const eventsB = await prisma.simulationRunEvent.findMany({ where: { runId: runBId } });
    expect(eventsB).toHaveLength(1);
    expect(eventsB[0].eventType).toBe('RUN_CREATED');

    const runAInDb = await prisma.simulationRun.findUnique({ where: { id: runAId } });
    expect(runAInDb?.status).toBe('CONFIGURED');
    expect(runAInDb?.version).toBe(2);

    const eventsA = await prisma.simulationRunEvent.findMany({ where: { runId: runAId, eventType: 'DATA_BOUND' } });
    expect(eventsA).toHaveLength(1);
  });

  it('D4 — caller hash override ignored', async () => {
    const businessKeyD4 = '4'.repeat(64);
    await seedSealedSnapshot(businessKeyD4, CONTENT_HASH);

    const createResult = await CreateSimulationRunService.execute(
      {
        configData: {
          mode: 'HISTORICAL_REPLAY',
          initialCapital: '100000',
          codeVersion: 'v1.0.0',
          rngSeed: '12345',
          fillPolicyVersionKey: 'f'.repeat(64),
          orchestrationVersionKey: 'o'.repeat(64)
        },
        mode: 'HISTORICAL_REPLAY',
        creationIdempotencyKey: '4'.repeat(64)
      },
      { type: 'SYSTEM', id: 'sys-1' }
    );
    const runId = createResult.id;

    const snapshotRepo = new PrismaDatasetSnapshotRepository(prisma);
    const legacyBinder = new LegacySimulationRunDataOriginBinder();
    const bridgeService = new BindDatasetSnapshotRunOriginService(snapshotRepo, legacyBinder);

    const result = await bridgeService.execute({
      runId,
      expectedVersion: 1,
      snapshotBusinessKey: businessKeyD4,
      canonicalStartDate: '2025-01-15',
      idempotencyKey: 'bind-idem-4',
      actor: { type: 'SYSTEM', id: 'sys-1' },
      dataOriginHash: 'evil-caller-hash'
    } as any);

    expect(result.origin.dataOriginHash).toBe(CONTENT_HASH);
    expect(result.binding.dataOriginHash).toBe(CONTENT_HASH);
    expect(result.binding.dataOriginHash).not.toBe('evil-caller-hash');

    const runInDb = await prisma.simulationRun.findUnique({ where: { id: runId } });
    expect(runInDb?.dataOriginHash).toBe(CONTENT_HASH);
    expect(runInDb?.dataOriginHash).not.toBe('evil-caller-hash');
  });

  it('D5 — DRAFT snapshot rejected', async () => {
    const snapshotBusinessKeyD5 = '5'.repeat(64);

    await prisma.datasetSnapshot.create({
      data: {
        businessKey: snapshotBusinessKeyD5,
        sourceVersionId: '10000000-0000-0000-0000-000000000001',
        contentHash: CONTENT_HASH,
        dataCutoffKey: DATA_CUTOFF_KEY,
        dataCutoffAt: DATE_CUTOFF,
        rangeStart: DATE_START,
        rangeEnd: DATE_END,
        universeDefinitionJson: '[]',
        universeHash: UNIVERSE_HASH,
        canonicalizationVersion: '1',
        rowCount: 0,
        manifestHash: MANIFEST_HASH,
        status: 'DRAFT',
        creationIdempotencyKey: IDEMPOTENCY_KEY_DRAFT,
        creationRequestHash: 'req-draft',
        createdAt: new Date('2025-01-01T00:00:00.000Z')
      }
    });

    const createResult = await CreateSimulationRunService.execute(
      {
        configData: {
          mode: 'HISTORICAL_REPLAY',
          initialCapital: '100000',
          codeVersion: 'v1.0.0',
          rngSeed: '12346',
          fillPolicyVersionKey: 'f'.repeat(64),
          orchestrationVersionKey: 'o'.repeat(64)
        },
        mode: 'HISTORICAL_REPLAY',
        creationIdempotencyKey: '5'.repeat(64)
      },
      { type: 'SYSTEM', id: 'sys-1' }
    );
    const runId = createResult.id;

    const snapshotRepo = new PrismaDatasetSnapshotRepository(prisma);
    const legacyBinder = new LegacySimulationRunDataOriginBinder();
    const bridgeService = new BindDatasetSnapshotRunOriginService(snapshotRepo, legacyBinder);

    try {
      await bridgeService.execute({
        runId,
        expectedVersion: 1,
        snapshotBusinessKey: snapshotBusinessKeyD5,
        canonicalStartDate: '2025-01-15',
        idempotencyKey: '5'.repeat(64),
        actor: { type: 'SYSTEM', id: 'sys-1' }
      });
      throw new Error('Should have rejected');
    } catch (e: any) {
      expect(e).toBeInstanceOf(DatasetSnapshotRunOriginInvalidError);
    }

    const runInDb = await prisma.simulationRun.findUnique({ where: { id: runId } });
    expect(runInDb?.status).toBe('INITIALIZED');
    expect(runInDb?.version).toBe(1);
    expect(runInDb?.dataOriginHash).toBeNull();

    const events = await prisma.simulationRunEvent.findMany({ where: { runId, eventType: 'DATA_BOUND' } });
    expect(events).toHaveLength(0);
  });
});
