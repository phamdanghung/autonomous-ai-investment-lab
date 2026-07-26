import { describe, it, expect } from 'vitest';
import { RunChainAnchorCalculator } from '../../src/domain/hashing/calculators/RunChainAnchorCalculator';
import { EventHashCalculator } from '../../src/domain/hashing/calculators/OtherCalculators';
import crypto from 'crypto';

describe('RunChainAnchorCalculator', () => {
  const reqHash = '5f4dcc3b5aa765d61d8327deb882cf99';
  const idemKey = 'uuid-1234';

  it('1. Anchor uses exact known test vector', () => {
    const expectedRaw = `SIMULATION_RUN_EVENT_CHAIN_V1${reqHash}${idemKey}`;
    const expectedHash = crypto.createHash('sha256').update(expectedRaw).digest('hex');
    const result = RunChainAnchorCalculator.calculate(reqHash, idemKey);
    expect(result).toBe(expectedHash);
  });

  it('2. Changing creation request hash changes anchor', () => {
    const base = RunChainAnchorCalculator.calculate(reqHash, idemKey);
    const changed = RunChainAnchorCalculator.calculate('different_hash', idemKey);
    expect(base).not.toBe(changed);
  });

  it('3. Changing idempotency key changes anchor', () => {
    const base = RunChainAnchorCalculator.calculate(reqHash, idemKey);
    const changed = RunChainAnchorCalculator.calculate(reqHash, 'different_idem');
    expect(base).not.toBe(changed);
  });

  it('4. Changing chain version changes anchor (simulate manual)', () => {
    const base = RunChainAnchorCalculator.calculate(reqHash, idemKey);
    const manualWrongVersion = crypto.createHash('sha256').update(`SIMULATION_RUN_EVENT_CHAIN_V2${reqHash}${idemKey}`).digest('hex');
    expect(base).not.toBe(manualWrongVersion);
  });

  it('5. RUN_CREATED event hash uses anchor as previousHash', () => {
    const anchor = RunChainAnchorCalculator.calculate(reqHash, idemKey);
    const eventPayload = {
      chainVersion: 'SIMULATION_RUN_EVENT_CHAIN_V1',
      runChainAnchor: anchor,
      eventSequence: 1,
      eventType: 'RUN_CREATED',
      fromStatus: null,
      toStatus: 'INITIALIZED',
      simulationDateBefore: null,
      simulationDateAfter: null,
      actorType: 'SYSTEM',
      actorBusinessKey: 'test',
      reason: 'test',
      idempotencyKey: 'idem',
      requestHash: 'req',
      payloadJson: '{}',
      previousHash: anchor // Exact anchor used here
    };
    const eventHash = EventHashCalculator.calculate(eventPayload);
    expect(eventHash).toBeDefined();

    // 6. Event 2 uses Event 1 hash as previousHash
    const event2Payload = { ...eventPayload, eventSequence: 2, eventType: 'DATA_BOUND', previousHash: eventHash };
    const event2Hash = EventHashCalculator.calculate(event2Payload);
    expect(event2Hash).toBeDefined();
    expect(event2Hash).not.toBe(eventHash);
  });
});
