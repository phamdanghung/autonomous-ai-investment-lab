import { MARKET_DATA_CONTRACT_VERSIONS, MarketExchange, MARKET_EXCHANGES, MarketDayType, MARKET_DAY_TYPES } from '../contracts/MarketDataContracts';
import { MarketDataValidation } from './MarketDataValidation';
import { MarketDataCanonicalization } from './MarketDataCanonicalization';
import { TradingCalendarInvalidError } from './MarketDataErrors';

export interface TradingCalendarDay {
  id: string; // UUID
  sourceVersionId: string;
  exchange: MarketExchange;
  marketDate: string; // YYYY-MM-DD
  dayType: MarketDayType;
  reason: string | null;
  canonicalHash: string; // 64-char lowercase hex
}

export type CanonicalTradingCalendarPayload = {
  calendarContractVersion: string;
  sourceVersionKey: string; // The natural key of the source version, NOT the UUID
  exchange: MarketExchange;
  marketDate: string;
  dayType: MarketDayType;
  reason: string | null;
};

export class TradingCalendarDayDomain {
  static validateIdentityInput(sourceVersionId: unknown, exchange: unknown, marketDate: unknown): { sourceVersionId: string, exchange: MarketExchange, marketDate: string } {
    if (typeof sourceVersionId !== 'string' || sourceVersionId.trim() === '') {
      throw new TradingCalendarInvalidError('sourceVersionId is invalid.');
    }
    const validatedSourceVersionId = sourceVersionId.trim();

    if (!MARKET_EXCHANGES.includes(exchange as any)) {
      throw new TradingCalendarInvalidError('exchange is invalid.');
    }
    const validatedExchange = exchange as MarketExchange;

    let validatedMarketDate: string;
    try {
      validatedMarketDate = MarketDataValidation.normalizeDateOnly(marketDate as string);
    } catch (error: any) {
      throw new TradingCalendarInvalidError('marketDate is invalid.');
    }

    return { sourceVersionId: validatedSourceVersionId, exchange: validatedExchange, marketDate: validatedMarketDate };
  }

  static validateCanonicalInput(sourceVersionKey: unknown, exchange: unknown, marketDate: unknown, dayType: unknown, reason: unknown): { sourceVersionKey: string, exchange: MarketExchange, marketDate: string, dayType: MarketDayType, reason: string | null } {
    if (typeof sourceVersionKey !== 'string') {
      throw new TradingCalendarInvalidError('sourceVersionKey is invalid.');
    }
    const trimmedSourceVersionKey = sourceVersionKey.trim();
    if (!/^VN\|MARKET_DATA_SOURCE\|[a-f0-9]{64}$/.test(trimmedSourceVersionKey)) {
      throw new TradingCalendarInvalidError('sourceVersionKey is invalid.');
    }

    if (!MARKET_EXCHANGES.includes(exchange as any)) {
      throw new TradingCalendarInvalidError('exchange is invalid.');
    }
    const validatedExchange = exchange as MarketExchange;

    let validatedMarketDate: string;
    try {
      validatedMarketDate = MarketDataValidation.normalizeDateOnly(marketDate as string);
    } catch (error: any) {
      throw new TradingCalendarInvalidError('marketDate is invalid.');
    }

    if (!MARKET_DAY_TYPES.includes(dayType as any)) {
      throw new TradingCalendarInvalidError('dayType is invalid.');
    }
    const validatedDayType = dayType as MarketDayType;

    let normalizedReason: string | null = null;
    if (typeof reason === 'string') {
      const trimmedReason = reason.trim();
      if (trimmedReason !== '') {
        normalizedReason = trimmedReason;
      }
    } else if (reason !== null && reason !== undefined) {
      throw new TradingCalendarInvalidError('reason is invalid.');
    }

    return { sourceVersionKey: trimmedSourceVersionKey, exchange: validatedExchange, marketDate: validatedMarketDate, dayType: validatedDayType, reason: normalizedReason };
  }

  /**
   * Builds the identity string used for idempotency resolution.
   */
  static buildIdentity(sourceVersionId: unknown, exchange: unknown, marketDate: unknown): string {
    const validated = this.validateIdentityInput(sourceVersionId, exchange, marketDate);
    return `${validated.sourceVersionId}|${validated.exchange}|${validated.marketDate}`;
  }

  /**
   * Builds the canonical payload and hashes it.
   */
  static buildCanonicalHash(sourceVersionKey: unknown, exchange: unknown, marketDate: unknown, dayType: unknown, reason: unknown): { payload: CanonicalTradingCalendarPayload, hash: string } {
    const validated = this.validateCanonicalInput(sourceVersionKey, exchange, marketDate, dayType, reason);

    const payload: CanonicalTradingCalendarPayload = {
      calendarContractVersion: MARKET_DATA_CONTRACT_VERSIONS.TRADING_CALENDAR_DAY,
      sourceVersionKey: validated.sourceVersionKey,
      exchange: validated.exchange,
      marketDate: validated.marketDate,
      dayType: validated.dayType,
      reason: validated.reason,
    };

    const hash = MarketDataCanonicalization.hashPayload(payload).toLowerCase();

    return { payload, hash };
  }
}
