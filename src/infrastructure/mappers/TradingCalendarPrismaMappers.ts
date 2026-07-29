import { TradingCalendarDay } from '../../domain/market-data/TradingCalendarDay';
import { MarketExchange, MarketDayType } from '../../domain/contracts/MarketDataContracts';

export class TradingCalendarPrismaMappers {
  static mapDateToPrisma(marketDate: string): Date {
    const [year, month, day] = marketDate.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }

  static mapDateFromPrisma(date: Date): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  static mapToDomain(record: any): TradingCalendarDay {
    return {
      id: record.id,
      sourceVersionId: record.sourceVersionId,
      exchange: record.exchange as MarketExchange,
      marketDate: this.mapDateFromPrisma(record.marketDate),
      dayType: record.dayType as MarketDayType,
      reason: record.reason,
      canonicalHash: record.canonicalHash,
    };
  }
}
