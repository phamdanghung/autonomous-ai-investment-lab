import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { RunMode } from '../../src/domain/types/RunMode';

const prisma = new PrismaClient();

describe('Database Immutability Integration Tests', () => {
  let testConfigId = '';
  
  beforeAll(async () => {
    const config = await prisma.runCoreConfigVersion.create({
      data: {
        contentHash: 'test-hash-immutability-' + Date.now(),
        mode: RunMode.LIVE_FORWARD as any,
        initialCapital: BigInt(100000),
        codeVersion: '1.0.0',
        rngSeed: BigInt(123),
        fillPolicyVersionKey: 'FILL_v1',
        orchestrationVersionKey: 'ORCH_v1',
      }
    });
    testConfigId = config.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('should block UPDATE on RunCoreConfigVersion', async () => {
    await expect(
      prisma.$executeRaw`UPDATE "RunCoreConfigVersion" SET "codeVersion" = '2.0.0' WHERE "id" = ${testConfigId}`
    ).rejects.toThrow();
  });

  it('should block DELETE on RunCoreConfigVersion', async () => {
    await expect(
      prisma.$executeRaw`DELETE FROM "RunCoreConfigVersion" WHERE "id" = ${testConfigId}`
    ).rejects.toThrow();
  });
  
  it('should block UPDATE on SimulationRunEvent', async () => {
    const idempotency = randomUUID();
    const run = await prisma.simulationRun.create({
      data: {
        creationIdempotencyKey: idempotency,
        creationRequestHash: 'hash',
        configVersionId: testConfigId,
        mode: 'LIVE_FORWARD',
        status: 'INITIALIZED',
        version: 1,
      }
    });
    
    const event = await prisma.simulationRunEvent.create({
      data: {
        runId: run.id,
        idempotencyKey: randomUUID(),
        requestHash: 'evt-hash',
        actorType: 'SYSTEM',
        actorBusinessKey: 'sys',
        eventType: 'TEST',
        payloadJson: '{}',
        eventHash: 'ehash',
        previousHash: '0',
        toStatus: 'INITIALIZED',
        eventSequence: 1
      }
    });

    await expect(
      prisma.$executeRaw`UPDATE "SimulationRunEvent" SET "payloadJson" = '{"hacked":true}' WHERE "id" = ${event.id}`
    ).rejects.toThrow();
    
    await expect(
      prisma.$executeRaw`DELETE FROM "SimulationRunEvent" WHERE "id" = ${event.id}`
    ).rejects.toThrow();
  });
});
