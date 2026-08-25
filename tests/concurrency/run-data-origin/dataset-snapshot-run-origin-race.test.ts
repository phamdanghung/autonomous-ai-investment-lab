import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupIsolatedTestSchema, IsolatedTestSchema } from '../../utils/database';
import { PrismaClient } from '@prisma/client';
import { IdempotencyKeyReusedError, RunVersionConflictError } from '../../../src/domain/errors/DomainErrors';
import { DatasetSnapshotRunOriginInvalidError } from '../../../src/domain/run-data-origin/DatasetSnapshotRunOrigin';

let isolatedSchema: IsolatedTestSchema | null = null;
let originalDbUrl: string | undefined;
let prisma: PrismaClient;

// Dynamic imports
let BindDatasetSnapshotRunOriginService: any;
let LegacySimulationRunDataOriginBinder: any;
let CreateSimulationRunService: any;
let PrismaDatasetSnapshotRepository: any;
let simulationRunCommandRepository: any;
let originalFindEvent: any;

const DATA_CUTOFF_KEY = 'c'.repeat(64);
const UNIVERSE_HASH = 'd'.repeat(64);
const MANIFEST_HASH = 'e'.repeat(64);

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

function createBarrier(expectedParticipants: number) {
  let arrived = 0;
  let release: () => void;
  const barrierPromise = new Promise<void>(resolve => { release = resolve; });
  let onAllArrived: (() => void) | null = null;
  const allArrivedPromise = new Promise<void>(resolve => { onAllArrived = resolve; });

  return {
    arrive: async () => {
      arrived++;
      if (arrived === expectedParticipants && onAllArrived) {
        onAllArrived();
      }
      await barrierPromise;
    },
    waitAll: async () => {
      await allArrivedPromise;
    },
    releaseAll: () => {
      release();
    }
  };
}

function wrapFindEvent(barrierObj: ReturnType<typeof createBarrier>) {
  let callCount = 0;
  simulationRunCommandRepository.findEventByIdempotencyKey = async (key: string) => {
    callCount++;
    const result = await originalFindEvent(key);
    if (callCount <= 2) {
      await barrierObj.arrive();
    }
    return result;
  };
}


describe('DatasetSnapshot -> SimulationRun Origin Race', () => {
  beforeAll(async () => {
    isolatedSchema = await setupIsolatedTestSchema('dataset_snapshot_run_origin_race');
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

    const SimRunCommandRepoModule = await import('../../../src/infrastructure/repositories/SimulationRunCommandRepository');
    simulationRunCommandRepository = SimRunCommandRepoModule.simulationRunCommandRepository;

    originalFindEvent = simulationRunCommandRepository.findEventByIdempotencyKey.bind(simulationRunCommandRepository);

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

  afterEach(() => {
    if (originalFindEvent && simulationRunCommandRepository) {
      simulationRunCommandRepository.findEventByIdempotencyKey = originalFindEvent;
    }
  });

  it('RACE E1 — SAME RUN / SAME REQUEST / SAME IDEMPOTENCY', async () => {
    const barrier = createBarrier(2);
    wrapFindEvent(barrier);

    const snapshotBusinessKey = '1'.repeat(64);
    const contentHash = 'c'.repeat(64);
    await seedSealedSnapshot(snapshotBusinessKey, contentHash);

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
        creationIdempotencyKey: 'idem-run-e1'
      },
      { type: 'SYSTEM', id: 'sys-1' }
    );
    const runId = createResult.id;

    const snapshotRepo = new PrismaDatasetSnapshotRepository(prisma);
    const legacyBinder = new LegacySimulationRunDataOriginBinder();
    const bridgeService = new BindDatasetSnapshotRunOriginService(snapshotRepo, legacyBinder);

    const bindIdempotencyKey = 'bind-e1-1111111111111111111111111111111111111111111111111111111111111111';
    const req = {
      runId,
      expectedVersion: 1,
      snapshotBusinessKey,
      canonicalStartDate: '2025-01-15',
      idempotencyKey: bindIdempotencyKey,
      actor: { type: 'SYSTEM', id: 'sys-1' }
    };

    const p1 = bridgeService.execute(req);
    const p2 = bridgeService.execute(req);

    await barrier.waitAll();
    barrier.releaseAll();

    const [res1, res2] = await Promise.all([p1, p2]);

    expect(res1.binding.runId).toBe(runId);
    expect(res2.binding.runId).toBe(runId);
    expect(res1.binding.version).toBe(2);
    expect(res2.binding.version).toBe(2);

    const runInDb = await prisma.simulationRun.findUnique({ where: { id: runId } });
    expect(runInDb?.version).toBe(2);
    expect(runInDb?.status).toBe('CONFIGURED');

    const events = await prisma.simulationRunEvent.findMany({ where: { runId } });
    expect(events).toHaveLength(2);
    expect(events.filter(e => e.eventType === 'DATA_BOUND')).toHaveLength(1);
  });

  it('RACE E2 — SAME RUN / SAME SNAPSHOT / DIFFERENT IDEMPOTENCY', async () => {
    const barrier = createBarrier(2);
    wrapFindEvent(barrier);

    const snapshotBusinessKey = '2'.repeat(64);
    const contentHash = 'c'.repeat(64);
    await seedSealedSnapshot(snapshotBusinessKey, contentHash);

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
        creationIdempotencyKey: 'idem-run-e2'
      },
      { type: 'SYSTEM', id: 'sys-1' }
    );
    const runId = createResult.id;

    const snapshotRepo = new PrismaDatasetSnapshotRepository(prisma);
    const legacyBinder = new LegacySimulationRunDataOriginBinder();
    const bridgeService = new BindDatasetSnapshotRunOriginService(snapshotRepo, legacyBinder);

    const p1 = bridgeService.execute({
      runId,
      expectedVersion: 1,
      snapshotBusinessKey,
      canonicalStartDate: '2025-01-15',
      idempotencyKey: 'bind-e2-1',
      actor: { type: 'SYSTEM', id: 'sys-1' }
    });

    const p2 = bridgeService.execute({
      runId,
      expectedVersion: 1,
      snapshotBusinessKey,
      canonicalStartDate: '2025-01-15',
      idempotencyKey: 'bind-e2-2',
      actor: { type: 'SYSTEM', id: 'sys-1' }
    });

    await barrier.waitAll();
    barrier.releaseAll();

    const results = await Promise.allSettled([p1, p2]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    expect((rejected[0] as any).reason).toBeInstanceOf(RunVersionConflictError);

    const runInDb = await prisma.simulationRun.findUnique({ where: { id: runId } });
    expect(runInDb?.version).toBe(2);
    expect(runInDb?.status).toBe('CONFIGURED');

    const events = await prisma.simulationRunEvent.findMany({ where: { runId } });
    expect(events).toHaveLength(2);
    expect(events.filter(e => e.eventType === 'DATA_BOUND')).toHaveLength(1);
    const dataBoundEvent = events.find(e => e.eventType === 'DATA_BOUND');
    expect(['bind-e2-1', 'bind-e2-2']).toContain(dataBoundEvent?.idempotencyKey);
  });

  it('RACE E3 — SAME RUN / SAME IDEMPOTENCY / DIFFERENT REQUEST', async () => {
    const barrier = createBarrier(2);
    wrapFindEvent(barrier);

    const snapshotBusinessKey = '3'.repeat(64);
    const contentHash = 'c'.repeat(64);
    await seedSealedSnapshot(snapshotBusinessKey, contentHash);

    const createResult = await CreateSimulationRunService.execute(
      {
        configData: {
          mode: 'HISTORICAL_REPLAY',
          initialCapital: '100000',
          codeVersion: 'v1.0.0',
          rngSeed: '12347',
          fillPolicyVersionKey: 'f'.repeat(64),
          orchestrationVersionKey: 'o'.repeat(64)
        },
        mode: 'HISTORICAL_REPLAY',
        creationIdempotencyKey: 'idem-run-e3'
      },
      { type: 'SYSTEM', id: 'sys-1' }
    );
    const runId = createResult.id;

    const snapshotRepo = new PrismaDatasetSnapshotRepository(prisma);
    const legacyBinder = new LegacySimulationRunDataOriginBinder();
    const bridgeService = new BindDatasetSnapshotRunOriginService(snapshotRepo, legacyBinder);

    const bindIdempotencyKey = 'bind-e3-3333333333333333333333333333333333333333333333333333333333333333';
    const p1 = bridgeService.execute({
      runId,
      expectedVersion: 1,
      snapshotBusinessKey,
      canonicalStartDate: '2025-01-10', // Request A
      idempotencyKey: bindIdempotencyKey,
      actor: { type: 'SYSTEM', id: 'sys-1' }
    });

    const p2 = bridgeService.execute({
      runId,
      expectedVersion: 1,
      snapshotBusinessKey,
      canonicalStartDate: '2025-01-15', // Request B
      idempotencyKey: bindIdempotencyKey,
      actor: { type: 'SYSTEM', id: 'sys-1' }
    });

    await barrier.waitAll();
    barrier.releaseAll();

    const results = await Promise.allSettled([p1, p2]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    expect((rejected[0] as any).reason).toBeInstanceOf(IdempotencyKeyReusedError);

    const runInDb = await prisma.simulationRun.findUnique({ where: { id: runId } });
    expect(runInDb?.version).toBe(2);

    const events = await prisma.simulationRunEvent.findMany({ where: { runId } });
    expect(events.filter(e => e.eventType === 'DATA_BOUND')).toHaveLength(1);
    
    // Check that canonicalStartDate matches winner
    const winnerResult = (fulfilled[0] as any).value;
    expect(runInDb?.canonicalStartDate?.toISOString().substring(0, 10)).toBe(winnerResult.binding.canonicalStartDate);
  });

  it('RACE E4 — DIFFERENT RUNS / SAME IDEMPOTENCY', async () => {
    const barrier = createBarrier(2);
    wrapFindEvent(barrier);

    const snapshotBusinessKey = '4'.repeat(64);
    const contentHash = 'c'.repeat(64);
    await seedSealedSnapshot(snapshotBusinessKey, contentHash);

    const createA = await CreateSimulationRunService.execute(
      {
        configData: {
          mode: 'HISTORICAL_REPLAY',
          initialCapital: '100000',
          codeVersion: 'v1.0.0',
          rngSeed: '12348',
          fillPolicyVersionKey: 'f'.repeat(64),
          orchestrationVersionKey: 'o'.repeat(64)
        },
        mode: 'HISTORICAL_REPLAY',
        creationIdempotencyKey: 'idem-run-e4-a'
      },
      { type: 'SYSTEM', id: 'sys-1' }
    );
    const createB = await CreateSimulationRunService.execute(
      {
        configData: {
          mode: 'HISTORICAL_REPLAY',
          initialCapital: '100000',
          codeVersion: 'v1.0.0',
          rngSeed: '12349',
          fillPolicyVersionKey: 'f'.repeat(64),
          orchestrationVersionKey: 'o'.repeat(64)
        },
        mode: 'HISTORICAL_REPLAY',
        creationIdempotencyKey: 'idem-run-e4-b'
      },
      { type: 'SYSTEM', id: 'sys-1' }
    );

    const snapshotRepo = new PrismaDatasetSnapshotRepository(prisma);
    const legacyBinder = new LegacySimulationRunDataOriginBinder();
    const bridgeService = new BindDatasetSnapshotRunOriginService(snapshotRepo, legacyBinder);

    const bindIdempotencyKey = 'bind-e4-4444444444444444444444444444444444444444444444444444444444444444';
    
    const p1 = bridgeService.execute({
      runId: createA.id,
      expectedVersion: 1,
      snapshotBusinessKey,
      canonicalStartDate: '2025-01-15',
      idempotencyKey: bindIdempotencyKey,
      actor: { type: 'SYSTEM', id: 'sys-1' }
    });

    const p2 = bridgeService.execute({
      runId: createB.id,
      expectedVersion: 1,
      snapshotBusinessKey,
      canonicalStartDate: '2025-01-15',
      idempotencyKey: bindIdempotencyKey,
      actor: { type: 'SYSTEM', id: 'sys-1' }
    });

    await barrier.waitAll();
    barrier.releaseAll();

    const results = await Promise.allSettled([p1, p2]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    expect((rejected[0] as any).reason).toBeInstanceOf(IdempotencyKeyReusedError);

    const runs = await prisma.simulationRun.findMany({ where: { id: { in: [createA.id, createB.id] } } });
    const configuredRuns = runs.filter(r => r.status === 'CONFIGURED');
    const initializedRuns = runs.filter(r => r.status === 'INITIALIZED');
    
    expect(configuredRuns).toHaveLength(1);
    expect(initializedRuns).toHaveLength(1);

    expect(configuredRuns[0].version).toBe(2);
    expect(initializedRuns[0].version).toBe(1);
    expect(initializedRuns[0].dataOriginHash).toBeNull();
    expect(initializedRuns[0].canonicalStartDate).toBeNull();
    expect(initializedRuns[0].runBusinessKey).toBeNull();
    
    const eventsA = await prisma.simulationRunEvent.findMany({ where: { runId: createA.id } });
    const eventsB = await prisma.simulationRunEvent.findMany({ where: { runId: createB.id } });
    
    expect(eventsA.length + eventsB.length).toBe(3); // 2 RUN_CREATED + 1 DATA_BOUND
    expect(eventsA.filter(e => e.eventType === 'DATA_BOUND').length + eventsB.filter(e => e.eventType === 'DATA_BOUND').length).toBe(1);
  });
});
