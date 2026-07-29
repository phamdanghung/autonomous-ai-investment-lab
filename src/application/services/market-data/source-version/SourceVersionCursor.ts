import { MarketSourceVersionInvalidError } from '../../../../domain/market-data/MarketDataErrors';

export interface SourceVersionCursorPayload {
  version: 1;
  createdAt: string;
  id: string;
}

export class SourceVersionCursor {
  static encode(createdAt: string, id: string): string {
    const payload: SourceVersionCursorPayload = { version: 1, createdAt, id };
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  }

  static decode(cursor: string): { createdAt: Date; id: string } {
    if (!cursor || typeof cursor !== 'string') {
      throw new MarketSourceVersionInvalidError('Invalid cursor format.');
    }

    // strict base64url decode check (length, characters)
    if (!/^[a-zA-Z0-9_-]+={0,2}$/.test(cursor)) {
      throw new MarketSourceVersionInvalidError('Invalid base64 cursor.');
    }

    let jsonString: string;
    try {
      jsonString = Buffer.from(cursor, 'base64url').toString('utf8');
    } catch {
      throw new MarketSourceVersionInvalidError('Invalid base64 cursor encoding.');
    }

    let payload: any;
    try {
      payload = JSON.parse(jsonString);
    } catch {
      throw new MarketSourceVersionInvalidError('Cursor is not valid JSON.');
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new MarketSourceVersionInvalidError('Cursor payload must be an object.');
    }

    if (payload.version !== 1) {
      throw new MarketSourceVersionInvalidError('Unsupported cursor version.');
    }

    const keys = Object.keys(payload);
    if (keys.length !== 3 || !keys.includes('version') || !keys.includes('createdAt') || !keys.includes('id')) {
      throw new MarketSourceVersionInvalidError('Cursor contains unexpected fields.');
    }

    if (typeof payload.createdAt !== 'string' || typeof payload.id !== 'string') {
      throw new MarketSourceVersionInvalidError('Cursor fields have invalid types.');
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(payload.id)) {
      throw new MarketSourceVersionInvalidError('Cursor id is not a valid UUID.');
    }

    const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
    if (!isoRegex.test(payload.createdAt)) {
      throw new MarketSourceVersionInvalidError('Cursor createdAt is not a valid strict ISO string.');
    }

    const date = new Date(payload.createdAt);
    if (isNaN(date.getTime())) {
      throw new MarketSourceVersionInvalidError('Cursor createdAt is an invalid date.');
    }

    return { createdAt: date, id: payload.id };
  }
}
