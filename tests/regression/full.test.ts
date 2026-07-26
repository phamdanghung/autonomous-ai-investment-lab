import { describe, it, expect } from 'vitest';
import { CreateSimulationRunService } from '../../src/application/services/CreateSimulationRunService';
import { GetSimulationRunService } from '../../src/application/services/GetSimulationRunService';
import { ListSimulationRunsService } from '../../src/application/services/ListSimulationRunsService';
import { BindDataOriginService } from '../../src/application/services/BindDataOriginService';
import { StartSimulationRunService } from '../../src/application/services/ActionServices';
import { TerminateSimulationRunService } from '../../src/application/services/ActionServices';
import { SealSimulationRunService } from '../../src/application/services/ActionServices';
import { VerifyRunEventChainService } from '../../src/application/services/VerifyRunEventChainService';
import { RunMode } from '../../src/domain/types/RunMode';
import { RunStatus } from '../../src/domain/types/RunStatus';
import { v4 as uuidv4 } from 'uuid';

describe('Regression Tests', () => {
  it('should cover Phase 1A baseline end-to-end', async () => {
    const actor = { type: 'SYSTEM', id: 'regsys' };
    const configData = {
      mode: RunMode.LIVE_FORWARD,
      initialCapital: BigInt(1000),
      codeVersion: '1.0.0',
      rngSeed: BigInt(42),
      fillPolicyVersionKey: 'FILL',
      orchestrationVersionKey: 'ORCH'
    };
    
    // 1. Create -> INITIALIZED
    let run = await CreateSimulationRunService.execute({ configData, mode: RunMode.LIVE_FORWARD, creationIdempotencyKey: uuidv4() }, actor);
    expect(run).toBeDefined();
    expect(run.status).toBe(RunStatus.INITIALIZED);
    
    // 2. Query
    const list = await ListSimulationRunsService.execute({ page: 1, pageSize: 10 }, actor);
    expect(list.runs.length).toBeGreaterThan(0);
    
    // 3. Bind -> CONFIGURED
    run = await BindDataOriginService.execute(run.id, run.version, { dataOriginHash: uuidv4(), canonicalStartDate: '2024-01-01', idempotencyKey: uuidv4() }, actor);
    expect(run.status).toBe(RunStatus.CONFIGURED);
    
    // 4. Start -> RUNNING
    run = await StartSimulationRunService.execute(run.id, run.version, { reason: 'reg', idempotencyKey: uuidv4(), payload: {} }, actor);
    expect(run.status).toBe(RunStatus.RUNNING);
    
    // 5. Terminate -> TERMINATED
    run = await TerminateSimulationRunService.execute(run.id, run.version, RunStatus.RUNNING, { reason: 'reg', idempotencyKey: uuidv4(), payload: {} }, actor);
    expect(run.status).toBe(RunStatus.TERMINATED);
    
    // 6. Seal -> SEALED
    run = await SealSimulationRunService.execute(run.id, run.version, RunStatus.TERMINATED, { reason: 'reg', idempotencyKey: uuidv4(), payload: {} }, actor);
    expect(run.status).toBe(RunStatus.SEALED);
    
    // 7. Verify Chain
    const isValid = await VerifyRunEventChainService.execute(run.id);
    expect(isValid).toBe(true);
  });
});
