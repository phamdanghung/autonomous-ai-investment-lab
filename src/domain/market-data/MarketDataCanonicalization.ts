import { CanonicalSerializer } from '../hashing/CanonicalSerializer';
import { Sha256Service } from '../services/Sha256Service';

export class MarketDataCanonicalization {
  /**
   * Serializes a payload deterministically using CanonicalSerializer.
   */
  static serialize(payload: any): string {
    return CanonicalSerializer.serialize(payload);
  }

  /**
   * Hashes a canonical payload.
   */
  static hashPayload(payload: any): string {
    const serialized = this.serialize(payload);
    return Sha256Service.hashString(serialized);
  }

  /**
   * Derives a deterministic 64-bit signed integer for PostgreSQL advisory locks.
   * It takes exchange, canonicalSymbol, and securityType, serializes them, hashes them,
   * takes the first 16 hex chars (64 bits), and converts to signed BigInt.
   */
  static deriveAdvisoryLockKey(exchange: string, canonicalSymbol: string, securityType: string): bigint {
    const payload = {
      canonicalSymbol,
      exchange,
      securityType
    };

    // Use canonical serialization for stable object sorting
    const serialized = this.serialize(payload);
    const hashHex = Sha256Service.hashString(serialized);

    // Take first 16 hex characters for 64 bits
    const hex64 = hashHex.substring(0, 16);

    // Parse as unsigned BigInt
    const unsignedBigInt = BigInt('0x' + hex64);

    // Convert to signed 64-bit integer
    // 2^63 = 9223372036854775808
    // 2^64 = 18446744073709551616
    const limit = 9223372036854775808n; // 2^63
    if (unsignedBigInt >= limit) {
      return unsignedBigInt - 18446744073709551616n; // 2^64
    }

    return unsignedBigInt;
  }
}
