import { EventHashCalculator } from './calculators/OtherCalculators';

export class EventChainVerifier {
  static verify(events: { eventSequence: number; eventType: string; fromStatus: any; toStatus: any; simulationDateBefore: Date | null; simulationDateAfter: Date | null; actorType: string; actorBusinessKey: string; reason: string | null; idempotencyKey: string; requestHash: string; eventHash: string; previousHash: string; payloadJson: string }[], expectedAnchor: string): boolean {
    let currentPrev = expectedAnchor;
    
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.eventSequence !== i + 1) return false;
      if (e.previousHash !== currentPrev) return false;
      
      const payload = {
        chainVersion: 'SIMULATION_RUN_EVENT_CHAIN_V1',
        runChainAnchor: expectedAnchor,
        eventSequence: e.eventSequence,
        eventType: e.eventType,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        simulationDateBefore: e.simulationDateBefore ? (e.simulationDateBefore as any).toISOString().split('T')[0] : null,
        simulationDateAfter: e.simulationDateAfter ? (e.simulationDateAfter as any).toISOString().split('T')[0] : null,
        actorType: e.actorType,
        actorBusinessKey: e.actorBusinessKey,
        reason: e.reason,
        idempotencyKey: e.idempotencyKey,
        requestHash: e.requestHash,
        payloadJson: e.payloadJson,
        previousHash: e.previousHash
      };
      
      const recalculatedHash = EventHashCalculator.calculate(payload);
      if (e.eventHash !== recalculatedHash) return false;
      
      currentPrev = e.eventHash;
    }
    
    return true;
  }
}
