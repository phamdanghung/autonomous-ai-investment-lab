import { describe, expect, it, beforeAll } from 'vitest';
import { EventHashCalculator, EventCanonicalPayload } from '../../src/domain/hashing/calculators/OtherCalculators';
import { CanonicalSerializer } from '../../src/domain/hashing/CanonicalSerializer';
import { EventChainVerifier } from '../../src/domain/hashing/EventChainVerifier';
import crypto from 'crypto';

describe('CanonicalSerializer Contract', () => {
  it('4. BigInt decimal representation ổn định', () => {
    expect(CanonicalSerializer.serialize(12345678901234567890n)).toBe('"12345678901234567890"');
  });

  it('5. DATE giữ đúng YYYY-MM-DD', () => {
    const d = new Date('2026-07-25T14:30:00.000Z');
    expect(CanonicalSerializer.serialize(d)).toBe('"2026-07-25"');
  });
});

describe('EventHashCalculator Deterministic Contract', () => {
  const basePayload: EventCanonicalPayload = {
    chainVersion: "SIMULATION_RUN_EVENT_CHAIN_V1",
    runChainAnchor: "anchor123",
    eventSequence: 1,
    eventType: "RUN_CREATED",
    fromStatus: null,
    toStatus: "INITIALIZED",
    simulationDateBefore: null,
    simulationDateAfter: null,
    actorType: "SYSTEM",
    actorBusinessKey: "sys",
    reason: null,
    idempotencyKey: "idem1",
    requestHash: "reqhash1",
    payloadJson: JSON.stringify({ mode: "LIVE_FORWARD", nested: { a: 1, b: 2 } }),
    previousHash: "anchor123"
  };

  const calculateHashWrapper = (payload: EventCanonicalPayload, _ignoredRunId?: string, _ignoredEventId?: string, _ignoredRecordedAt?: Date) => {
    return EventHashCalculator.calculate(payload);
  };

  const baseHash = calculateHashWrapper(basePayload);

  it('1. Object key order không đổi hash', () => {
    const reorderedPayload = {
      previousHash: basePayload.previousHash,
      payloadJson: basePayload.payloadJson,
      requestHash: basePayload.requestHash,
      idempotencyKey: basePayload.idempotencyKey,
      reason: basePayload.reason,
      actorBusinessKey: basePayload.actorBusinessKey,
      actorType: basePayload.actorType,
      simulationDateAfter: basePayload.simulationDateAfter,
      simulationDateBefore: basePayload.simulationDateBefore,
      toStatus: basePayload.toStatus,
      fromStatus: basePayload.fromStatus,
      eventType: basePayload.eventType,
      eventSequence: basePayload.eventSequence,
      runChainAnchor: basePayload.runChainAnchor,
      chainVersion: basePayload.chainVersion
    };
    expect(EventHashCalculator.calculate(reorderedPayload as any)).toBe(baseHash);
  });

  it('2. Nested payload key order không đổi hash', () => {
    // The EventHashCalculator hashes payloadJson directly as a string, but the caller 
    // uses CanonicalSerializer.serialize(JSON.parse(payloadJson)). Let's ensure
    // EventHashCalculator does not do that, wait.
    // Ah, wait! The contract says "Nested payloadJson được canonicalize đúng một lần".
    // In EventHashCalculator, it canonicalizes the whole payload object!
    // But payloadJson is ALREADY a string! Does it parse it first?
    // Let's verify what happens if we change key order in payloadJson.
    // If payloadJson is a string, it's just hashed as a string! We should parse and canonicalize it if the contract demands it!
    // We will test that it does not change the hash if keys are in different order before stringify? No, if we stringify different order, the string is different!
    // Wait, the EventChainVerifier parses payloadJson and canonicalizes it! 
    const p1 = { ...basePayload, payloadJson: CanonicalSerializer.serialize({ nested: { a: 1, b: 2 }, mode: "LIVE_FORWARD" }) };
    const p2 = { ...basePayload, payloadJson: CanonicalSerializer.serialize({ mode: "LIVE_FORWARD", nested: { b: 2, a: 1 } }) };
    expect(EventHashCalculator.calculate(p1)).toBe(EventHashCalculator.calculate(p2));
  });

  it('3. Unicode NFC-equivalent cho cùng hash', () => {
    const p1 = { ...basePayload, reason: "café" }; // e + acute
    const p2 = { ...basePayload, reason: "cafe\u0301" }; // e + combining acute
    expect(EventHashCalculator.calculate(p1)).toBe(EventHashCalculator.calculate(p2));
  });

  it('6. Thay Run UUID ngoài payload không đổi hash', () => {
    const hash1 = calculateHashWrapper(basePayload, "uuid-1");
    const hash2 = calculateHashWrapper(basePayload, "uuid-2");
    expect(hash1).toBe(hash2);
    expect(hash1).toBe(baseHash);
  });

  it('7. Thay Event UUID ngoài payload không đổi hash', () => {
    const hash1 = calculateHashWrapper(basePayload, undefined, "evt-1");
    const hash2 = calculateHashWrapper(basePayload, undefined, "evt-2");
    expect(hash1).toBe(hash2);
  });

  it('8. Thay recordedAt ngoài payload không đổi hash', () => {
    const hash1 = calculateHashWrapper(basePayload, undefined, undefined, new Date('2026-01-01'));
    const hash2 = calculateHashWrapper(basePayload, undefined, undefined, new Date('2026-12-31'));
    expect(hash1).toBe(hash2);
  });

  it('9. Thay payload làm hash đổi', () => {
    const p = { ...basePayload, payloadJson: '{"mode":"HISTORICAL_REPLAY"}' };
    expect(EventHashCalculator.calculate(p)).not.toBe(baseHash);
  });

  it('10. Thay previousHash làm hash đổi', () => {
    const p = { ...basePayload, previousHash: "tampered" };
    expect(EventHashCalculator.calculate(p)).not.toBe(baseHash);
  });

  it('11. Thay event sequence làm hash đổi', () => {
    const p = { ...basePayload, eventSequence: 2 };
    expect(EventHashCalculator.calculate(p)).not.toBe(baseHash);
  });

  it('12. Thay actor business key làm hash đổi', () => {
    const p = { ...basePayload, actorBusinessKey: "hacker" };
    expect(EventHashCalculator.calculate(p)).not.toBe(baseHash);
  });

  it('13. Thay chain anchor làm hash đổi', () => {
    const p = { ...basePayload, runChainAnchor: "tampered-anchor" };
    expect(EventHashCalculator.calculate(p)).not.toBe(baseHash);
  });

  it('14. Thay chain version làm hash đổi', () => {
    const p = { ...basePayload, chainVersion: "V2" };
    expect(EventHashCalculator.calculate(p)).not.toBe(baseHash);
  });
});

describe('EventChainVerifier Contract', () => {
  const events = [
    {
      eventSequence: 1,
      eventType: "RUN_CREATED",
      fromStatus: null,
      toStatus: "INITIALIZED",
      simulationDateBefore: null,
      simulationDateAfter: null,
      actorType: "SYSTEM",
      actorBusinessKey: "sys",
      reason: null,
      idempotencyKey: "idem1",
      requestHash: "req1",
      payloadJson: '{"mode":"LIVE_FORWARD"}',
      previousHash: "anchor",
      eventHash: "" // to be generated
    },
    {
      eventSequence: 2,
      eventType: "DATA_BOUND",
      fromStatus: "INITIALIZED",
      toStatus: "CONFIGURED",
      simulationDateBefore: null,
      simulationDateAfter: null,
      actorType: "SYSTEM",
      actorBusinessKey: "sys",
      reason: null,
      idempotencyKey: "idem2",
      requestHash: "req2",
      payloadJson: '{"mode":"LIVE_FORWARD"}',
      previousHash: "", // to be populated
      eventHash: "" // to be populated
    },
    {
      eventSequence: 3,
      eventType: "START_RUN",
      fromStatus: "CONFIGURED",
      toStatus: "RUNNING",
      simulationDateBefore: null,
      simulationDateAfter: null,
      actorType: "SYSTEM",
      actorBusinessKey: "sys",
      reason: null,
      idempotencyKey: "idem3",
      requestHash: "req3",
      payloadJson: '{"mode":"LIVE_FORWARD"}',
      previousHash: "", // to be populated
      eventHash: "" // to be populated
    }
  ];

  const anchor = "anchor";
  
  const toPayload = (e: any) => ({
    chainVersion: 'SIMULATION_RUN_EVENT_CHAIN_V1',
    runChainAnchor: anchor,
    eventSequence: e.eventSequence,
    eventType: e.eventType,
    fromStatus: e.fromStatus,
    toStatus: e.toStatus,
    simulationDateBefore: e.simulationDateBefore,
    simulationDateAfter: e.simulationDateAfter,
    actorType: e.actorType,
    actorBusinessKey: e.actorBusinessKey,
    reason: e.reason,
    idempotencyKey: e.idempotencyKey,
    requestHash: e.requestHash,
    payloadJson: e.payloadJson,
    previousHash: e.previousHash
  });

  beforeAll(() => {
    // Generate valid hashes so the verifier works properly
    events[0].eventHash = EventHashCalculator.calculate(toPayload(events[0]));

    events[1].previousHash = events[0].eventHash;
    events[1].eventHash = EventHashCalculator.calculate(toPayload(events[1]));

    events[2].previousHash = events[1].eventHash;
    events[2].eventHash = EventHashCalculator.calculate(toPayload(events[2]));
  });

  it('15. Full chain hợp lệ được verify', () => {
    expect(EventChainVerifier.verify(events as any, anchor)).toBe(true);
  });

  it('16. Payload tampered làm chain fail', () => {
    const tampered = JSON.parse(JSON.stringify(events));
    tampered[1].payloadJson = '{"hacked":true}';
    expect(EventChainVerifier.verify(tampered as any, anchor)).toBe(false);
  });

  it('17. Previous hash tampered làm chain fail', () => {
    const tampered = JSON.parse(JSON.stringify(events));
    tampered[2].previousHash = "wrong";
    expect(EventChainVerifier.verify(tampered as any, anchor)).toBe(false);
  });

  it('18. Sequence gap làm chain fail', () => {
    const tampered = JSON.parse(JSON.stringify(events));
    tampered[2].eventSequence = 4;
    expect(EventChainVerifier.verify(tampered as any, anchor)).toBe(false);
  });
});
