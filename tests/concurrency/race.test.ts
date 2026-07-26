import { describe, it, expect } from 'vitest';
import { CreateSimulationRunService } from '../../src/application/services/CreateSimulationRunService';
import { StartSimulationRunService } from '../../src/application/services/StartSimulationRunService';
import { TerminateSimulationRunService } from '../../src/application/services/TerminateSimulationRunService';
import { RunMode } from '../../src/domain/types/RunMode';
import { RunStatus } from '../../src/domain/types/RunStatus';
import { v4 as uuidv4 } from 'uuid';
import { PrismaClient } from '@prisma/client';
import { RunCoreConfigRepository } from '../../src/infrastructure/repositories/RunCoreConfigRepository';
import { simulationRunCommandRepository } from '../../src/infrastructure/repositories/SimulationRunCommandRepository';
import { CanonicalDate } from '../../src/domain/models/CanonicalDate';

const prisma = new PrismaClient();

describe('Concurrency Tests', () => {
  const actor = { type: 'SYSTEM', id: 'sys' };

  const validConfigData = () => ({
    mode: RunMode.LIVE_FORWARD,
    initialCapital: BigInt(Math.floor(Math.random() * 1000000)),
    codeVersion: '1.0.0',
    rngSeed: BigInt(Math.floor(Math.random() * 10000)),
    fillPolicyVersionKey: 'FILL_v1',
    orchestrationVersionKey: 'ORCH_v1'
  });

  it('1. Concurrent config creation', async () => {
    const data = validConfigData();
    // Simulate calling CreateSimulationRunService concurrently with same config but different idempotency keys.
    // This forces the repository to handle concurrent createSealed for the same config hash.
    const p1 = CreateSimulationRunService.execute({ configData: data, mode: RunMode.LIVE_FORWARD, creationIdempotencyKey: uuidv4() }, actor);
    const p2 = CreateSimulationRunService.execute({ configData: data, mode: RunMode.LIVE_FORWARD, creationIdempotencyKey: uuidv4() }, actor);
    
    const results = await Promise.allSettled([p1, p2]);
    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('fulfilled');
  });

  it('2. Concurrent create same idempotency key', async () => {
    const idempotencyKey = uuidv4();
    const configData = validConfigData();

    const p1 = CreateSimulationRunService.execute(
      { configData, mode: RunMode.LIVE_FORWARD, creationIdempotencyKey: idempotencyKey },
      actor
    );
    const p2 = CreateSimulationRunService.execute(
      { configData, mode: RunMode.LIVE_FORWARD, creationIdempotencyKey: idempotencyKey },
      actor
    );
    
    const results = await Promise.allSettled([p1, p2]);
    const successes = results.filter(r => r.status === 'fulfilled');
    const failures = results.filter(r => r.status === 'rejected');
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
  });

  it('3. Concurrent transition same idempotency key', async () => {
    const configData = validConfigData();
    const run = await CreateSimulationRunService.execute(
      { configData, mode: RunMode.LIVE_FORWARD, creationIdempotencyKey: uuidv4() },
      actor
    );
    
    const idempotencyKey = uuidv4();
    await prisma.simulationRun.update({ where: { id: run.id }, data: { status: 'CONFIGURED', version: 2 } });
    
    const p1 = StartSimulationRunService.execute(run.id, 2, { idempotencyKey, payload: {} }, actor);
    const p2 = StartSimulationRunService.execute(run.id, 2, { idempotencyKey, payload: {} }, actor);

    const results = await Promise.allSettled([p1, p2]);
    const successes = results.filter(r => r.status === 'fulfilled');
    const failures = results.filter(r => r.status === 'rejected');
    
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
  });

  it('4. Same expected-version race', async () => {
    const run = await CreateSimulationRunService.execute(
      { configData: validConfigData(), mode: RunMode.LIVE_FORWARD, creationIdempotencyKey: uuidv4() },
      actor
    );
    
    await prisma.simulationRun.update({ where: { id: run.id }, data: { status: 'CONFIGURED', version: 2 } });

    const p1 = StartSimulationRunService.execute(run.id, 2, { idempotencyKey: uuidv4(), payload: {} }, actor);
    const p2 = TerminateSimulationRunService.execute(run.id, 2, RunStatus.CONFIGURED, { idempotencyKey: uuidv4(), payload: {} }, actor);

    const results = await Promise.allSettled([p1, p2]);
    const successes = results.filter(r => r.status === 'fulfilled');
    const failures = results.filter(r => r.status === 'rejected');
    
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    expect((failures[0] as PromiseRejectedResult).reason.message).toMatch(/conflict/i);
  });

  it('5. CAS conflict explicitly', async () => {
    const repo = simulationRunCommandRepository;
    const run = await CreateSimulationRunService.execute(
      { configData: validConfigData(), mode: RunMode.LIVE_FORWARD, creationIdempotencyKey: uuidv4() },
      actor
    );

    // Disable triggers temporarily to mess up version, or just call transition with bad version
    // We can't disable triggers easily. The simplest CAS failure is to pass a bad expected version to the repository.
    const event = {
      idempotencyKey: uuidv4(),
      requestHash: 'hash',
      actorType: 'SYSTEM',
      actorBusinessKey: 'sys',
      eventType: 'TEST',
      payloadJson: '{}',
      eventHash: 'hash',
      previousHash: '0',
      fromStatus: RunStatus.INITIALIZED,
      toStatus: RunStatus.RUNNING,
      eventSequence: 3
    } as any;

    await expect(repo.transitionWithEvent(run.id, 999, RunStatus.INITIALIZED, RunStatus.RUNNING, {}, event))
      .rejects.toThrow(/conflict|failed/i);
  });

  it('6. Event-sequence uniqueness', async () => {
    const run = await CreateSimulationRunService.execute(
      { configData: validConfigData(), mode: RunMode.LIVE_FORWARD, creationIdempotencyKey: uuidv4() },
      actor
    );

    await prisma.simulationRunEvent.create({
      data: {
        runId: run.id,
        idempotencyKey: uuidv4(),
        requestHash: 'hash',
        actorType: 'SYSTEM',
        actorBusinessKey: 'sys',
        eventType: 'TEST',
        payloadJson: '{}',
        eventHash: 'h1',
        previousHash: '0',
        toStatus: 'INITIALIZED',
        eventSequence: 10
      }
    });

    await expect(
      prisma.simulationRunEvent.create({
        data: {
          runId: run.id,
          idempotencyKey: uuidv4(),
          requestHash: 'hash2',
          actorType: 'SYSTEM',
          actorBusinessKey: 'sys',
          eventType: 'TEST',
          payloadJson: '{}',
          eventHash: 'h2',
          previousHash: 'h1',
          toStatus: 'INITIALIZED',
          eventSequence: 10 // duplicate sequence
        }
      })
    ).rejects.toThrow(); // Unique constraint violation
  });
});
