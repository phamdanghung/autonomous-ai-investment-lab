import { describe, it, expect } from 'vitest';
import { TradingCalendarPrismaMappers } from '../../../../src/infrastructure/mappers/TradingCalendarPrismaMappers';
import { MarketExchange, MarketDayType } from '../../../../src/domain/contracts/MarketDataContracts';

describe('TradingCalendarPrismaMappers', () => {
  it('should map date to prisma correctly', () => {
    const dateStr = '2023-01-15';
    const prismaDate = TradingCalendarPrismaMappers.mapDateToPrisma(dateStr);
    expect(prismaDate.getUTCFullYear()).toBe(2023);
    expect(prismaDate.getUTCMonth()).toBe(0);
    expect(prismaDate.getUTCDate()).toBe(15);
  });

  it('should map date from prisma correctly', () => {
    const date = new Date(Date.UTC(2023, 0, 15));
    const dateStr = TradingCalendarPrismaMappers.mapDateFromPrisma(date);
    expect(dateStr).toBe('2023-01-15');
  });

  it('should map record to domain', () => {
    const record = {
      id: '123',
      sourceVersionId: 'src1',
      exchange: "HOSE",
      marketDate: new Date(Date.UTC(2023, 0, 15)),
      dayType: "TRADING",
      reason: null,
      canonicalHash: 'hash',
    };

    const domain = TradingCalendarPrismaMappers.mapToDomain(record);
    expect(domain.marketDate).toBe('2023-01-15');
    expect(domain.exchange).toBe("HOSE");
  });
});
