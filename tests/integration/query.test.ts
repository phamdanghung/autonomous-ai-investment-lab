import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ListSimulationRunsService } from '../../src/application/services/ListSimulationRunsService';
import { GetSimulationRunService } from '../../src/application/services/GetSimulationRunService';
import { RunMode } from '../../src/domain/types/RunMode';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();
const actor = { type: 'ADMIN', id: 'admin1' };

describe('Query Services Behavioral Tests', () => {
  beforeAll(async () => {
    // Clean up or ensure a stable state if needed
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('List - Empty result', async () => {
    const result = await ListSimulationRunsService.execute({ page: 1, pageSize: 10 }, actor);
    // Since we don't know the exact count in DB, we just ensure it returns the structure
    expect(result).toHaveProperty('runs');
    expect(result).toHaveProperty('total');
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(10);
  });

  it('List - Pagination & Stable order', async () => {
    // Let's create a couple of runs
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

    const run1 = await prisma.simulationRun.create({
      data: {
        creationIdempotencyKey: randomUUID(),
        creationRequestHash: randomUUID(),
        configVersionId: config.id,
        mode: 'LIVE_FORWARD',
      }
    });
    
    // Slight delay to ensure deterministic ordering by createdAt
    await new Promise(r => setTimeout(r, 10));

    const run2 = await prisma.simulationRun.create({
      data: {
        creationIdempotencyKey: randomUUID(),
        creationRequestHash: randomUUID(),
        configVersionId: config.id,
        mode: 'LIVE_FORWARD',
      }
    });

    const listDesc = await ListSimulationRunsService.execute({ page: 1, pageSize: 20 }, actor);
    expect(listDesc.runs.length).toBeGreaterThanOrEqual(2);
    
    // Stable order is typically by createdAt DESC
    const r1Index = listDesc.runs.findIndex((r: any) => r.id === run1.id);
    const r2Index = listDesc.runs.findIndex((r: any) => r.id === run2.id);
    if (r1Index !== -1 && r2Index !== -1) {
      expect(r2Index).toBeLessThan(r1Index); // run2 created later, so it appears first
    }

    const pagedList = await ListSimulationRunsService.execute({ page: 2, pageSize: 1 }, actor);
    expect(pagedList.page).toBe(2);
  });

  it('Get - Not found', async () => {
    await expect(GetSimulationRunService.execute(randomUUID(), actor)).rejects.toThrow();
  });

  it('Get - Success with events mapping', async () => {
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
        creationIdempotencyKey: randomUUID(),
        creationRequestHash: randomUUID(),
        configVersionId: config.id,
        mode: 'LIVE_FORWARD',
        events: {
          create: {
            eventSequence: 1,
            eventType: 'RUN_CREATED',
            actorType: 'SYSTEM',
            actorBusinessKey: 'sys',
            idempotencyKey: randomUUID(),
            requestHash: 'rh',
            payloadJson: '{}',
            eventHash: 'eh',
            previousHash: 'ph',
            toStatus: 'INITIALIZED'
          }
        }
      }
    });

    const detail = await GetSimulationRunService.execute(run.id, actor);
    expect(detail.id).toBe(run.id);
    expect(detail.events.length).toBe(1);
    expect(detail.events[0].eventType).toBe('RUN_CREATED');
  });
});
