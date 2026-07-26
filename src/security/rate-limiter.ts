export class InMemoryProductionRateLimiter {
  private static store: Map<string, { count: number; expiresAt: number }> = new Map();
  private static windowMs = 60000;
  private static maxRequests = 100;

  static consume(actorId: string, action: string): boolean {
    const key = `${actorId}:${action}`;
    const now = Date.now();
    const record = this.store.get(key);
    
    if (!record || now > record.expiresAt) {
      this.store.set(key, { count: 1, expiresAt: now + this.windowMs });
      return true;
    }

    if (record.count >= this.maxRequests) {
      return false; // Rate limited
    }

    record.count++;
    return true;
  }
}
