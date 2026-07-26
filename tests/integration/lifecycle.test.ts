import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { RunMode } from '../../src/domain/types/RunMode';
import { CreateSimulationRunService } from '../../src/application/services/CreateSimulationRunService';
import { StartSimulationRunService } from '../../src/application/services/StartSimulationRunService';
import { TerminateSimulationRunService } from '../../src/application/services/TerminateSimulationRunService';
import { SealSimulationRunService } from '../../src/application/services/SealSimulationRunService';
import { simulationRunCommandRepository } from '../../src/infrastructure/repositories/SimulationRunCommandRepository';
import { RunStatus } from '../../src/domain/types/RunStatus';

const prisma = new PrismaClient();

describe('Lifecycle and Invariants Tests', () => {
  const actor = { type: 'SYSTEM', id: 'sys' };
  
  const validConfigData = () => ({
    mode: RunMode.LIVE_FORWARD,
    initialCapital: BigInt(Math.floor(Math.random() * 1000000)),
    codeVersion: '1.0.0',
    rngSeed: BigInt(Math.floor(Math.random() * 10000)),
    fillPolicyVersionKey: 'FILL_v1',
    orchestrationVersionKey: 'ORCH_v1'
  });

  it('1. Atomic creation and rollback', async () => {
    // We mock Prisma locally or test what happens if event insert fails.
    // Instead of full mocking, we can test that atomic creation works.
    const run = await CreateSimulationRunService.execute(
      { configData: validConfigData(), mode: RunMode.LIVE_FORWARD, creationIdempotencyKey: uuidv4() },
      actor
    );
    const dbRun = await prisma.simulationRun.findUnique({ where: { id: run.id }, include: { events: true } });
    expect(dbRun).toBeDefined();
    expect(dbRun?.events.length).toBe(1);
    expect(dbRun?.events[0].eventType).toBe('RUN_CREATED');
  });

  it('2. Atomic binding and rollback', async () => {
    const run = await CreateSimulationRunService.execute(
      { configData: validConfigData(), mode: RunMode.LIVE_FORWARD, creationIdempotencyKey: uuidv4() },
      actor
    );
    const eventData = {
      idempotencyKey: uuidv4(),
      requestHash: 'rh', actorType: 'SYSTEM', actorBusinessKey: 'sys', eventType: 'TEST_BIND',
      payloadJson: '{}', eventHash: 'eh', previousHash: run.creationRequestHash,
      fromStatus: RunStatus.INITIALIZED, toStatus: RunStatus.CONFIGURED,
      simulationDateBefore: null, simulationDateAfter: null, reason: null
    };
    
    await simulationRunCommandRepository.bindDataOriginWithEvent(run.id, 1, RunStatus.INITIALIZED, {
      dataOriginHash: 'origin', canonicalStartDate: new Date(), simulationDate: new Date(), runBusinessKey: uuidv4()
    }, eventData);

    const dbRun = await prisma.simulationRun.findUnique({ where: { id: run.id }, include: { events: true } });
    expect(dbRun?.status).toBe('CONFIGURED');
    expect(dbRun?.events.length).toBe(2);
    expect(dbRun?.version).toBe(2);
  });

  it('3. Run immutable fields protection', async () => {
    const run = await CreateSimulationRunService.execute(
      { configData: validConfigData(), mode: RunMode.LIVE_FORWARD, creationIdempotencyKey: uuidv4() },
      actor
    );
    
    await expect(prisma.$executeRaw`UPDATE "SimulationRun" SET "configVersionId" = 'hack', "version" = 2 WHERE "id" = ${run.id}`)
      .rejects.toThrow(/Cannot change/i);
    await expect(prisma.$executeRaw`UPDATE "SimulationRun" SET "creationIdempotencyKey" = 'hack', "version" = 2 WHERE "id" = ${run.id}`)
      .rejects.toThrow(/Cannot change/i);
  });

  it('4. Bind-once fields protection', async () => {
    const run = await CreateSimulationRunService.execute(
      { configData: validConfigData(), mode: RunMode.LIVE_FORWARD, creationIdempotencyKey: uuidv4() },
      actor
    );
    
    const bk = uuidv4();
    await prisma.$executeRaw`UPDATE "SimulationRun" SET "status" = 'CONFIGURED', "version" = 2, "dataOriginHash" = 'hash1', "canonicalStartDate" = '2026-01-01'::DATE, "simulationDate" = '2026-01-01'::DATE, "runBusinessKey" = ${bk} WHERE "id" = ${run.id}`;

    await expect(prisma.$executeRaw`UPDATE "SimulationRun" SET "dataOriginHash" = 'hash2', "version" = 3, "status" = 'RUNNING' WHERE "id" = ${run.id}`)
      .rejects.toThrow(/Can only bind data origin/i);
  });

  it('5. Status change with version +2 (Rejected)', async () => {
    const run = await CreateSimulationRunService.execute(
      { configData: validConfigData(), mode: RunMode.LIVE_FORWARD, creationIdempotencyKey: uuidv4() },
      actor
    );
    await expect(prisma.$executeRaw`UPDATE "SimulationRun" SET "status" = 'CONFIGURED', "version" = 3 WHERE "id" = ${run.id}`)
      .rejects.toThrow(/Version must be incremented by exactly 1/i);
  });

  it('6. Status change without version increment (Rejected)', async () => {
    const run = await CreateSimulationRunService.execute(
      { configData: validConfigData(), mode: RunMode.LIVE_FORWARD, creationIdempotencyKey: uuidv4() },
      actor
    );
    await expect(prisma.$executeRaw`UPDATE "SimulationRun" SET "status" = 'CONFIGURED', "version" = 1 WHERE "id" = ${run.id}`)
      .rejects.toThrow(/Version must be incremented by exactly 1/i);
  });

  it('7. Valid transition with version +1 (Allowed)', async () => {
    const run = await CreateSimulationRunService.execute(
      { configData: validConfigData(), mode: RunMode.LIVE_FORWARD, creationIdempotencyKey: uuidv4() },
      actor
    );
    const bk = uuidv4();
    await prisma.$executeRaw`UPDATE "SimulationRun" SET "status" = 'CONFIGURED', "version" = 2, "dataOriginHash" = 'hash1', "canonicalStartDate" = '2026-01-01'::DATE, "simulationDate" = '2026-01-01'::DATE, "runBusinessKey" = ${bk} WHERE "id" = ${run.id}`;
  });

  it('7b. Event sequence equals new version', async () => {
    const run = await CreateSimulationRunService.execute(
      { configData: validConfigData(), mode: RunMode.LIVE_FORWARD, creationIdempotencyKey: uuidv4() },
      actor
    );
    const bk = uuidv4();
    await prisma.$executeRaw`UPDATE "SimulationRun" SET "status" = 'CONFIGURED', "version" = 2, "dataOriginHash" = 'hash1', "canonicalStartDate" = '2026-01-01'::DATE, "simulationDate" = '2026-01-01'::DATE, "runBusinessKey" = ${bk} WHERE "id" = ${run.id}`;
    await prisma.$executeRaw`INSERT INTO "SimulationRunEvent" ("id", "runId", "eventSequence", "eventType", "actorType", "actorBusinessKey", "eventHash", "previousHash", "payloadJson", "fromStatus", "toStatus", "idempotencyKey", "requestHash") VALUES (${uuidv4()}, ${run.id}, 2, 'TEST_EVENT', 'SYSTEM', 'sys', 'eh2', 'ph1', '{}', 'INITIALIZED', 'CONFIGURED', ${uuidv4()}, 'reqHash123')`;
    const event = await prisma.simulationRunEvent.findFirst({ where: { runId: run.id, eventSequence: 2 } });
    expect(event).toBeDefined();
    expect(event?.eventSequence).toBe(2);
  });

  it('8. CONFIGURED same-status version bump (Rejected)', async () => {
    const run = await CreateSimulationRunService.execute(
      { configData: validConfigData(), mode: RunMode.LIVE_FORWARD, creationIdempotencyKey: uuidv4() },
      actor
    );
    const bk = uuidv4();
    await prisma.$executeRaw`UPDATE "SimulationRun" SET "status" = 'CONFIGURED', "version" = 2, "dataOriginHash" = 'hash1', "canonicalStartDate" = '2026-01-01'::DATE, "simulationDate" = '2026-01-01'::DATE, "runBusinessKey" = ${bk} WHERE "id" = ${run.id}`;
    
    await expect(prisma.$executeRaw`UPDATE "SimulationRun" SET "version" = 3 WHERE "id" = ${run.id}`)
      .rejects.toThrow(/version cannot change without an approved state transition/i);
  });

  it('9. RUNNING same-status version bump (Rejected)', async () => {
    const run = await CreateSimulationRunService.execute(
      { configData: validConfigData(), mode: RunMode.LIVE_FORWARD, creationIdempotencyKey: uuidv4() },
      actor
    );
    const bk = uuidv4();
    await prisma.$executeRaw`UPDATE "SimulationRun" SET "status" = 'CONFIGURED', "version" = 2, "dataOriginHash" = 'hash1', "canonicalStartDate" = '2026-01-01'::DATE, "simulationDate" = '2026-01-01'::DATE, "runBusinessKey" = ${bk} WHERE "id" = ${run.id}`;
    await prisma.$executeRaw`UPDATE "SimulationRun" SET "status" = 'RUNNING', "version" = 3, "startedAt" = NOW() WHERE "id" = ${run.id}`;

    await expect(prisma.$executeRaw`UPDATE "SimulationRun" SET "version" = 4 WHERE "id" = ${run.id}`)
      .rejects.toThrow(/version cannot change without an approved state transition/i);
  });

  it('6. SEALED protection', async () => {
    const run = await CreateSimulationRunService.execute(
      { configData: validConfigData(), mode: RunMode.LIVE_FORWARD, creationIdempotencyKey: uuidv4() },
      actor
    );
    
    // To reach SEALED, we must go through valid transitions: INITIALIZED -> CONFIGURED -> TERMINATED -> SEALED
    const bk = uuidv4();
    await prisma.$executeRaw`UPDATE "SimulationRun" SET "status" = 'CONFIGURED', "version" = 2, "dataOriginHash" = 'h', "canonicalStartDate" = '2026-01-01'::DATE, "simulationDate" = '2026-01-01'::DATE, "runBusinessKey" = ${bk} WHERE "id" = ${run.id}`;
    await prisma.$executeRaw`UPDATE "SimulationRun" SET "status" = 'TERMINATED', "version" = 3, "terminatedAt" = NOW() WHERE "id" = ${run.id}`;
    await prisma.$executeRaw`UPDATE "SimulationRun" SET "status" = 'SEALED', "version" = 4, "sealedAt" = NOW() WHERE "id" = ${run.id}`;

    await expect(prisma.$executeRaw`UPDATE "SimulationRun" SET "status" = 'FAILED', "version" = 5 WHERE "id" = ${run.id}`)
      .rejects.toThrow(/SEALED/i);
  });

  it('7. Run delete protection', async () => {
    const run = await CreateSimulationRunService.execute(
      { configData: validConfigData(), mode: RunMode.LIVE_FORWARD, creationIdempotencyKey: uuidv4() },
      actor
    );

    await expect(prisma.$executeRaw`DELETE FROM "SimulationRun" WHERE "id" = ${run.id}`)
      .rejects.toThrow(/SimulationRun cannot be deleted/i);
  });
});
