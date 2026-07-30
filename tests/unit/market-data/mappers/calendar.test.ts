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

  describe('mapToDomain', () => {
    const baseRecord = {
      id: '123',
      sourceVersionId: 'src1',
      exchange: 'HOSE',
      marketDate: new Date(Date.UTC(2023, 0, 15)),
      reason: null,
      canonicalHash: 'hash',
    };

    const types = ['TRADING_DAY', 'WEEKEND', 'HOLIDAY', 'SYSTEM_MAINTENANCE', 'OTHER'] as const;

    for (const dayType of types) {
      it(`should map ${dayType} correctly`, () => {
        const record = { ...baseRecord, dayType };
        const domain = TradingCalendarPrismaMappers.mapToDomain(record);
        expect(domain.marketDate).toBe('2023-01-15');
        expect(domain.exchange).toBe('HOSE');
        expect(domain.dayType).toBe(dayType);
      });
    }

    it('should throw MarketDataIntegrityError for forged invalid dayType', () => {
      const record = { ...baseRecord, dayType: 'INVALID_FORGED_VALUE' };
      let err: any;
      try {
        TradingCalendarPrismaMappers.mapToDomain(record);
      } catch (e: any) {
        err = e;
      }
      expect(err).toBeDefined();
      expect(err.code).toBe('MARKET_DATA_INTEGRITY_ERROR');
      expect(err.message).not.toContain('INVALID_FORGED_VALUE');
      expect(err.message).toContain('Unexpected MarketDayType persistence value.');
    });
  });
});
