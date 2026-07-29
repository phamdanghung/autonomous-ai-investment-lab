import { TradingCalendarDay } from '../../../domain/market-data/TradingCalendarDay';
import { MarketExchange } from '../../../domain/contracts/MarketDataContracts';

export interface RegisterTradingCalendarDayRequest {
  sourceVersionKey: string;
  exchange: MarketExchange;
  marketDate: string;
  dayType: string;
  reason: string | null;
}

export type RegisterTradingCalendarDayResponse = {
  outcome: 'CREATED' | 'REPLAYED';
  record: TradingCalendarDay;
};

export class CalendarUniqueCollisionError extends Error {
  constructor() {
    super('Calendar unique collision');
    this.name = 'CalendarUniqueCollisionError';
  }
}

export class CalendarSourceFkViolationError extends Error {
  constructor() {
    super('Calendar source FK violation');
    this.name = 'CalendarSourceFkViolationError';
  }
}

export const TRADING_CALENDAR_TRANSACTION_TOKEN = Symbol('TRADING_CALENDAR_TRANSACTION_TOKEN');
export interface TradingCalendarTransactionContext {
  readonly [TRADING_CALENDAR_TRANSACTION_TOKEN]: true;
}

export interface TradingCalendarRepository {
  runTransaction<T>(
    work: (ctx: TradingCalendarTransactionContext) => Promise<T>
  ): Promise<T>;

  findSourceVersionIdByKey(
    ctx: TradingCalendarTransactionContext,
    sourceVersionKey: string
  ): Promise<string | null>;

  findCalendarDayByIdentity(
    ctx: TradingCalendarTransactionContext,
    sourceVersionId: string,
    exchange: MarketExchange,
    marketDate: string
  ): Promise<TradingCalendarDay | null>;

  findCalendarDayByCanonicalHash(
    ctx: TradingCalendarTransactionContext,
    canonicalHash: string
  ): Promise<TradingCalendarDay | null>;

  insertCalendarDay(
    ctx: TradingCalendarTransactionContext,
    record: Omit<TradingCalendarDay, 'id'>
  ): Promise<TradingCalendarDay>;

  listCalendarDays(
    exchange: MarketExchange,
    limit: number,
    cursor?: { marketDate: string; id: string }
  ): Promise<TradingCalendarDay[]>;
}
