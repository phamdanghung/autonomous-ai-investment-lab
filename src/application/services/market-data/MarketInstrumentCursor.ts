import { MarketExchange, SecurityType } from '../../../domain/contracts/MarketDataContracts';
import { MarketDataValidation } from '../../../domain/market-data/MarketDataValidation';
import { MarketInstrumentInvalidError } from '../../../domain/market-data/MarketDataErrors';

export interface MarketInstrumentCursorPayload {
  readonly version: 1;
  readonly exchange: MarketExchange;
  readonly canonicalSymbol: string;
  readonly securityType: SecurityType;
  readonly effectiveFrom: string;
  readonly id: string;
}

export class MarketInstrumentCursor {
  /**
   * Encodes a cursor payload into a url-safe base64 string.
   */
  static encode(payload: MarketInstrumentCursorPayload): string {
    const json = JSON.stringify(payload);
    return Buffer.from(json, 'utf8').toString('base64url');
  }

  /**
   * Decodes and validates a url-safe base64 string back into a cursor payload.
   */
  static decode(encoded: string): MarketInstrumentCursorPayload {
    if (encoded.length > 1024) {
      throw new MarketInstrumentInvalidError('Cursor string is too long');
    }

    let json: string;
    try {
      json = Buffer.from(encoded, 'base64url').toString('utf8');
    } catch {
      throw new MarketInstrumentInvalidError('Invalid cursor encoding');
    }

    let parsed: any;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new MarketInstrumentInvalidError('Invalid cursor JSON');
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new MarketInstrumentInvalidError('Cursor must be a JSON object');
    }

    if (parsed.version !== 1) {
      throw new MarketInstrumentInvalidError(`Unsupported cursor version: ${parsed.version}`);
    }

    if (!['HOSE', 'HNX', 'UPCOM'].includes(parsed.exchange)) {
      throw new MarketInstrumentInvalidError(`Invalid cursor exchange: ${parsed.exchange}`);
    }

    if (parsed.securityType !== 'EQUITY') {
      throw new MarketInstrumentInvalidError(`Invalid cursor securityType: ${parsed.securityType}`);
    }

    try {
      MarketDataValidation.normalizeSymbol(parsed.canonicalSymbol);
      MarketDataValidation.normalizeDateOnly(parsed.effectiveFrom);
    } catch (err: any) {
      throw new MarketInstrumentInvalidError(`Invalid cursor symbol or date: ${err.message}`);
    }

    if (typeof parsed.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.id)) {
      throw new MarketInstrumentInvalidError('Invalid cursor id (must be UUID)');
    }

    const payloadKeys = Object.keys(parsed);
    if (payloadKeys.length !== 6) {
      throw new MarketInstrumentInvalidError('Cursor has unexpected fields');
    }

    return {
      version: 1,
      exchange: parsed.exchange,
      canonicalSymbol: parsed.canonicalSymbol,
      securityType: parsed.securityType,
      effectiveFrom: parsed.effectiveFrom,
      id: parsed.id,
    };
  }
}
