import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupIsolatedTestSchema, IsolatedTestSchema } from '../../utils/database';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';

let isolatedSchema: IsolatedTestSchema | null = null;
let originalDbUrl: string | undefined;

let prisma: PrismaClient;

// Dynamic imports
let BindDatasetSnapshotRunOriginService: any;
let LegacySimulationRunDataOriginBinder: any;
let CreateSimulationRunService: any;
let PrismaDatasetSnapshotRepository: any;

describe('DatasetSnapshot -> SimulationRun Origin Integration', () => {
  beforeAll(async () => {
    isolatedSchema = await setupIsolatedTestSchema('dataset_snapshot_run_origin_int');
    originalDbUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = isolatedSchema.databaseUrl;

    prisma = new PrismaClient({
      datasourceUrl: isolatedSchema.databaseUrl
    });
    await prisma.$connect();

    // Dynamically import AFTER setting DATABASE_URL so singletons connect to isolated DB
    const CreateSimModule = await import('../../../src/application/services/CreateSimulationRunService');
    CreateSimulationRunService = CreateSimModule.CreateSimulationRunService;

    const BindServiceModule = await import('../../../src/application/services/run-data-origin/BindDatasetSnapshotRunOriginService');
    BindDatasetSnapshotRunOriginService = BindServiceModule.BindDatasetSnapshotRunOriginService;

    const LegacyBinderModule = await import('../../../src/infrastructure/adapters/run-data-origin/LegacySimulationRunDataOriginBinder');
    LegacySimulationRunDataOriginBinder = LegacyBinderModule.LegacySimulationRunDataOriginBinder;

    const PrismaSnapshotRepoModule = await import('../../../src/infrastructure/repositories/market-data/PrismaDatasetSnapshotRepository');
    PrismaDatasetSnapshotRepository = PrismaSnapshotRepoModule.PrismaDatasetSnapshotRepository;

    // Seed market_data_source_version FK dependency
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
        createdAt: new Date(),
        sealedAt: new Date()
      }
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
    if (isolatedSchema) {
      await isolatedSchema.teardown();
    }
    if (originalDbUrl !== undefined) {
      process.env.DATABASE_URL = originalDbUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
  });

  const generateLower64 = () => randomBytes(32).toString('hex');

  it('End-to-End Bind Flow (D1 to D4)', async () => {
    const snapshotBusinessKey = generateLower64();
    const contentHash = generateLower64();
    const dataCutoffKey = generateLower64();
    const bindIdempotencyKey = 'bind-idem-' + Date.now();
    const canonicalStartDate = '2025-01-15';

    const snapshotRepo = new PrismaDatasetSnapshotRepository(prisma);

    await snapshotRepo.createSealed({
      draft: {
        businessKey: snapshotBusinessKey,
        sourceVersionId: '10000000-0000-0000-0000-000000000001',
        rangeStart: '2025-01-01',
        rangeEnd: '2025-01-31',
        universeDefinitionJson: '[]',
        universeHash: generateLower64(),
        dataCutoffKey,
        dataCutoffAt: new Date(),
        canonicalizationVersion: '1',
        rowCount: 0,
        manifestHash: generateLower64(),
        contentHash,
        status: 'DRAFT',
        creationIdempotencyKey: 'idem-' + generateLower64(),
        creationRequestHash: generateLower64()
      },
      entries: [],
      sealedAt: new Date(),
    });

    // D1: First Bind
    const createResult = await CreateSimulationRunService.execute(
      {
        configData: {
          mode: 'HISTORICAL_REPLAY',
          initialCapital: '100000',
          codeVersion: 'v1.0.0',
          rngSeed: '12345',
          fillPolicyVersionKey: generateLower64(),
          orchestrationVersionKey: generateLower64()
        },
        mode: 'HISTORICAL_REPLAY',
        creationIdempotencyKey: 'creation-idem-1'
      },
      { type: 'SYSTEM', id: 'sys-1' }
    );
    const runId = createResult.id;

    const legacyBinder = new LegacySimulationRunDataOriginBinder();
    const bridgeService = new BindDatasetSnapshotRunOriginService(snapshotRepo, legacyBinder);

    const d1Result = await bridgeService.execute({
      runId,
      expectedVersion: 1,
      snapshotBusinessKey,
      canonicalStartDate,
      idempotencyKey: bindIdempotencyKey,
      actor: { type: 'SYSTEM', id: 'sys-1' }
    });

    expect(d1Result.origin.dataOriginHash).toBe(contentHash);
    expect(d1Result.binding.status).toBe('CONFIGURED');
    expect(d1Result.binding.canonicalStartDate).toBe('2025-01-15');
    expect(d1Result.binding.runId).toBe(runId);
    expect(d1Result.binding.version).toBe(2);
    expect(d1Result.binding.dataOriginHash).toBe(contentHash);
    expect(d1Result.binding.runBusinessKey).toMatch(/^[a-f0-9]{64}$/);

    // Verify DB State for D1
    const runInDb1 = await prisma.simulationRun.findUnique({ where: { id: runId } });
    expect(runInDb1?.status).toBe('CONFIGURED');
    expect(runInDb1?.version).toBe(2);
    expect(runInDb1?.dataOriginHash).toBe(contentHash);
    expect(runInDb1?.canonicalStartDate?.toISOString().substring(0, 10)).toBe('2025-01-15');

    const events1 = await prisma.simulationRunEvent.findMany({ where: { runId }, orderBy: { eventSequence: 'asc' } });
    expect(events1).toHaveLength(2);
    expect(events1[0].eventType).toBe('RUN_CREATED');
    expect(events1[1].eventType).toBe('DATA_BOUND');
    expect(events1[1].idempotencyKey).toBe(bindIdempotencyKey);

    // D2: Exact Idempotent Replay
    const d2Result = await bridgeService.execute({
      runId,
      expectedVersion: 1, // Same as D1 (it expects the state prior to transition, since replay is transparent to caller)
      snapshotBusinessKey,
      canonicalStartDate,
      idempotencyKey: bindIdempotencyKey,
      actor: { type: 'SYSTEM', id: 'sys-1' }
    });

    expect(d2Result).toEqual(d1Result); // exact same object shape

    const runInDb2 = await prisma.simulationRun.findUnique({ where: { id: runId } });
    expect(runInDb2?.version).toBe(2);
    const events2 = await prisma.simulationRunEvent.findMany({ where: { runId } });
    expect(events2).toHaveLength(2); // No new event appended

    // D3: Cross-Run Idempotency Reuse
    const createResult2 = await CreateSimulationRunService.execute(
      {
        configData: {
          mode: 'HISTORICAL_REPLAY',
          initialCapital: '100000',
          codeVersion: 'v1.0.0',
          rngSeed: '12345',
          fillPolicyVersionKey: generateLower64(),
          orchestrationVersionKey: generateLower64()
        },
        mode: 'HISTORICAL_REPLAY',
        creationIdempotencyKey: 'creation-idem-2'
      },
      { type: 'SYSTEM', id: 'sys-1' }
    );
    const runId2 = createResult2.id;

    await expect(
      bridgeService.execute({
        runId: runId2,
        expectedVersion: 1,
        snapshotBusinessKey,
        canonicalStartDate,
        idempotencyKey: bindIdempotencyKey, // Reusing key from run1
        actor: { type: 'SYSTEM', id: 'sys-1' }
      })
    ).rejects.toThrow(/idempotency/i); // Should throw IdempotencyKeyReusedError

    const runInDb3 = await prisma.simulationRun.findUnique({ where: { id: runId2 } });
    expect(runInDb3?.version).toBe(1);
    expect(runInDb3?.status).toBe('INITIALIZED');
    const events3 = await prisma.simulationRunEvent.findMany({ where: { runId: runId2 } });
    expect(events3).toHaveLength(1);

    // D4: Caller Hash Override
    // The bridge service is strongly typed and ignores extra properties, but if we cast, it should ignore or override the passed hash.
    const runId3 = (await CreateSimulationRunService.execute(
      {
        configData: {
          mode: 'HISTORICAL_REPLAY',
          initialCapital: '100000',
          codeVersion: 'v1.0.0',
          rngSeed: '12345',
          fillPolicyVersionKey: generateLower64(),
          orchestrationVersionKey: generateLower64()
        },
        mode: 'HISTORICAL_REPLAY',
        creationIdempotencyKey: 'creation-idem-3'
      },
      { type: 'SYSTEM', id: 'sys-1' }
    )).id;

    const d4Result = await bridgeService.execute({
      runId: runId3,
      expectedVersion: 1,
      snapshotBusinessKey,
      canonicalStartDate,
      idempotencyKey: 'bind-idem-4',
      actor: { type: 'SYSTEM', id: 'sys-1' },
      dataOriginHash: 'evil-caller-hash' // extra field
    } as any);

    expect(d4Result.binding.dataOriginHash).toBe(contentHash);
    const runInDb4 = await prisma.simulationRun.findUnique({ where: { id: runId3 } });
    expect(runInDb4?.dataOriginHash).toBe(contentHash);
  });

  it('D5: Invalid Snapshot State (DRAFT) Rejected', async () => {
    const snapshotBusinessKey = generateLower64();
    const snapshotRepo = new PrismaDatasetSnapshotRepository(prisma);

    await prisma.datasetSnapshot.create({
      data: {
        businessKey: snapshotBusinessKey,
        sourceVersionId: '10000000-0000-0000-0000-000000000001',
        contentHash: generateLower64(),
        dataCutoffKey: generateLower64(),
        dataCutoffAt: new Date(),
        rangeStart: new Date(),
        rangeEnd: new Date(),
        universeDefinitionJson: '[]',
        universeHash: generateLower64(),
        canonicalizationVersion: '1',
        rowCount: 0,
        manifestHash: generateLower64(),
        status: 'DRAFT',
        creationIdempotencyKey: 'idem-' + generateLower64(),
        creationRequestHash: generateLower64(),
        createdAt: new Date()
      }
    });

    const runId = (await CreateSimulationRunService.execute(
      {
        configData: {
          mode: 'HISTORICAL_REPLAY',
          initialCapital: '100000',
          codeVersion: 'v1.0.0',
          rngSeed: '12345',
          fillPolicyVersionKey: generateLower64(),
          orchestrationVersionKey: generateLower64()
        },
        mode: 'HISTORICAL_REPLAY',
        creationIdempotencyKey: 'creation-idem-d5'
      },
      { type: 'SYSTEM', id: 'sys-1' }
    )).id;

    const legacyBinder = new LegacySimulationRunDataOriginBinder();
    const bridgeService = new BindDatasetSnapshotRunOriginService(snapshotRepo, legacyBinder);

    await expect(
      bridgeService.execute({
        runId,
        expectedVersion: 1,
        snapshotBusinessKey,
        canonicalStartDate: '2025-01-15',
        idempotencyKey: 'bind-idem-d5',
        actor: { type: 'SYSTEM', id: 'sys-1' }
      })
    ).rejects.toThrow();

    const events = await prisma.simulationRunEvent.findMany({ where: { runId, eventType: 'DATA_BOUND' } });
    expect(events).toHaveLength(0);
  });
});
