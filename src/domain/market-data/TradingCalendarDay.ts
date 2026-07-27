import { MARKET_DATA_CONTRACT_VERSIONS, MarketExchange } from '../contracts/MarketDataContracts';
import { MarketDataValidation } from './MarketDataValidation';
import { MarketDataCanonicalization } from './MarketDataCanonicalization';

export interface TradingCalendarDay {
  id: string; // UUID
  sourceVersionId: string;
  exchange: MarketExchange;
  marketDate: string; // YYYY-MM-DD
  dayType: 'TRADING_DAY' | 'WEEKEND' | 'HOLIDAY' | 'SYSTEM_MAINTENANCE' | 'OTHER';
  reason: string | null;
  canonicalHash: string; // 64-char lowercase hex
}

export type CanonicalTradingCalendarPayload = {
  calendarContractVersion: string;
  sourceVersionKey: string; // The natural key of the source version, NOT the UUID
  exchange: MarketExchange;
  marketDate: string;
  dayType: string;
  reason: string | null;
};

export class TradingCalendarDayDomain {
  /**
   * Builds the identity string used for idempotency resolution.
   */
  static buildIdentity(sourceVersionId: string, exchange: MarketExchange, marketDate: string): string {
    const validDate = MarketDataValidation.normalizeDateOnly(marketDate);
    return `${sourceVersionId}|${exchange}|${validDate}`;
  }

  /**
   * Builds the canonical payload and hashes it.
   */
  static buildCanonicalHash(sourceVersionKey: string, exchange: MarketExchange, marketDate: string, dayType: string, reason: string | null | undefined): { payload: CanonicalTradingCalendarPayload, hash: string } {
    const validDate = MarketDataValidation.normalizeDateOnly(marketDate);
    const validReason = MarketDataValidation.normalizeCalendarReason(reason);

    const payload: CanonicalTradingCalendarPayload = {
      calendarContractVersion: MARKET_DATA_CONTRACT_VERSIONS.TRADING_CALENDAR_DAY,
      sourceVersionKey,
      exchange,
      marketDate: validDate,
      dayType,
      reason: validReason,
    };

    const hash = MarketDataCanonicalization.hashPayload(payload).toLowerCase();

    return { payload, hash };
  }
}
