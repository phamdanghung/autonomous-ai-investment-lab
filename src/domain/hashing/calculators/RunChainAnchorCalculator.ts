import crypto from 'crypto';

export class RunChainAnchorCalculator {
  static calculate(creationRequestHash: string, creationIdempotencyKey: string): string {
    const raw = `SIMULATION_RUN_EVENT_CHAIN_V1${creationRequestHash}${creationIdempotencyKey}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
  }
}
