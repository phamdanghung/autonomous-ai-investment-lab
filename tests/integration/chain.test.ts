import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { VerifyRunEventChainService } from '../../src/application/services/VerifyRunEventChainService';
import { randomUUID } from 'crypto';
import { RunChainAnchorCalculator } from '../../src/domain/hashing/calculators/RunChainAnchorCalculator';
import { EventHashCalculator } from '../../src/domain/hashing/calculators/OtherCalculators';

const prisma = new PrismaClient();

describe('VerifyRunEventChainService Behavioral Tests', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const setupChain = async () => {
    const creationReqHash = randomUUID();
    const idemKey = randomUUID();
    const anchor = RunChainAnchorCalculator.calculate(creationReqHash, idemKey);

    const config = await prisma.runCoreConfigVersion.create({
      data: {
        contentHash: randomUUID(),
        mode: 'LIVE_FORWARD',
        initialCapital: BigInt(1000),
        codeVersion: '1',
        rngSeed: BigInt(1),
        fillPolicyVersionKey: 'k',
        orchestrationVersionKey: 'k',
      }
    });

    const run = await prisma.simulationRun.create({
      data: {
        creationIdempotencyKey: idemKey,
        creationRequestHash: creationReqHash,
        configVersionId: config.id,
        mode: 'LIVE_FORWARD',
        version: 3,
      }
    });

    const toPayload = (e: any) => ({
      chainVersion: 'SIMULATION_RUN_EVENT_CHAIN_V1',
      runChainAnchor: anchor,
      eventSequence: e.eventSequence,
      eventType: e.eventType,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      simulationDateBefore: null,
      simulationDateAfter: null,
      actorType: e.actorType,
      actorBusinessKey: e.actorBusinessKey,
      reason: null,
      idempotencyKey: e.idempotencyKey,
      requestHash: e.requestHash,
      payloadJson: e.payloadJson,
      previousHash: e.previousHash
    });

    const e1Data = {
      runId: run.id,
      eventSequence: 1,
      eventType: 'RUN_CREATED',
      actorType: 'SYSTEM' as any,
      actorBusinessKey: 'sys',
      idempotencyKey: randomUUID(),
      requestHash: 'rh',
      payloadJson: '{"mode":"LIVE_FORWARD"}',
      previousHash: anchor,
      fromStatus: null,
      toStatus: 'INITIALIZED' as any,
      eventHash: ''
    };
    e1Data.eventHash = EventHashCalculator.calculate(toPayload(e1Data));
    const e1 = await prisma.simulationRunEvent.create({ data: e1Data });

    const e2Data = {
      runId: run.id,
      eventSequence: 2,
      eventType: 'START_RUN',
      actorType: 'SYSTEM' as any,
      actorBusinessKey: 'sys',
      idempotencyKey: randomUUID(),
      requestHash: 'rh2',
      payloadJson: '{"action":"START"}',
      previousHash: e1Data.eventHash,
      fromStatus: 'INITIALIZED' as any,
      toStatus: 'RUNNING' as any,
      eventHash: ''
    };
    e2Data.eventHash = EventHashCalculator.calculate(toPayload(e2Data));
    const e2 = await prisma.simulationRunEvent.create({ data: e2Data });

    return { run, e1, e2 };
  };

  const tamperEvent = async (id: string, field: string, value: any) => {
    // Disable triggers temporarily for tampering by using replica role
    await prisma.$executeRawUnsafe(`SET session_replication_role = 'replica';`);
    if (field === 'eventSequence') {
      await prisma.$executeRaw`UPDATE "SimulationRunEvent" SET "eventSequence" = ${value} WHERE "id" = ${id}`;
    } else if (field === 'payloadJson') {
      await prisma.$executeRaw`UPDATE "SimulationRunEvent" SET "payloadJson" = ${value} WHERE "id" = ${id}`;
    } else if (field === 'previousHash') {
      await prisma.$executeRaw`UPDATE "SimulationRunEvent" SET "previousHash" = ${value} WHERE "id" = ${id}`;
    }
    await prisma.$executeRawUnsafe(`SET session_replication_role = 'origin';`);
  };

  const tamperRun = async (id: string, field: string, value: any) => {
    await prisma.$executeRawUnsafe(`SET session_replication_role = 'replica';`);
    if (field === 'creationRequestHash') {
      await prisma.$executeRaw`UPDATE "SimulationRun" SET "creationRequestHash" = ${value} WHERE "id" = ${id}`;
    }
    await prisma.$executeRawUnsafe(`SET session_replication_role = 'origin';`);
  };

  it('Valid chain', async () => {
    const { run } = await setupChain();
    const result = await VerifyRunEventChainService.execute(run.id);
    expect(result).toBe(true);
  });

  it('Tampered payload', async () => {
    const { run, e2 } = await setupChain();
    await tamperEvent(e2.id, 'payloadJson', '{"hacked":true}');
    const result = await VerifyRunEventChainService.execute(run.id);
    expect(result).toBe(false);
  });

  it('Wrong previous hash', async () => {
    const { run, e2 } = await setupChain();
    await tamperEvent(e2.id, 'previousHash', 'wrong');
    const result = await VerifyRunEventChainService.execute(run.id);
    expect(result).toBe(false);
  });

  it('Sequence gap', async () => {
    const { run, e2 } = await setupChain();
    await tamperEvent(e2.id, 'eventSequence', 3);
    const result = await VerifyRunEventChainService.execute(run.id);
    expect(result).toBe(false);
  });

  it('Wrong chain anchor', async () => {
    const { run, e1 } = await setupChain();
    await tamperRun(run.id, 'creationRequestHash', 'fake-hash');
    const result = await VerifyRunEventChainService.execute(run.id);
    expect(result).toBe(false);
  });
});
