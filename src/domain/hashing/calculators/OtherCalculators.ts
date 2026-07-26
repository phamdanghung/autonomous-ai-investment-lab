import crypto from 'crypto';
import { CanonicalSerializer } from '../CanonicalSerializer';

export class CreationRequestHashCalculator {
  static calculate(dto: any): string {
    const canonical = CanonicalSerializer.serialize(dto);
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }
}

export class TransitionRequestHashCalculator {
  static calculate(dto: any): string {
    const canonical = CanonicalSerializer.serialize(dto);
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }
}

export class ConfigContentHashCalculator {
  static calculate(configData: any): string {
    const canonical = CanonicalSerializer.serialize(configData);
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }
}

export interface EventCanonicalPayload {
  chainVersion: string;
  runChainAnchor: string;
  eventSequence: number;
  eventType: string;
  fromStatus: string | null;
  toStatus: string;
  simulationDateBefore: string | null; // YYYY-MM-DD
  simulationDateAfter: string | null;  // YYYY-MM-DD
  actorType: string;
  actorBusinessKey: string;
  reason: string | null;
  idempotencyKey: string;
  requestHash: string;
  payloadJson: string;
  previousHash: string;
}

export class EventHashCalculator {
  static calculate(payload: EventCanonicalPayload): string {
    // Enum uppercase enforcement (safety)
    const safePayload = {
      ...payload,
      eventType: payload.eventType.toUpperCase(),
      fromStatus: payload.fromStatus ? payload.fromStatus.toUpperCase() : null,
      toStatus: payload.toStatus.toUpperCase(),
      actorType: payload.actorType.toUpperCase(),
    };
    
    const canonical = CanonicalSerializer.serialize(safePayload);
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }
}
