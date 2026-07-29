import { describe, it, expect, vi } from 'vitest';
import { RegisterTradingCalendarDayService } from '../../../../src/application/services/market-data/calendar/RegisterTradingCalendarDayService';
import { ListTradingCalendarDaysService } from '../../../../src/application/services/market-data/calendar/ListTradingCalendarDaysService';
import { MarketExchange } from '../../../../src/domain/contracts/MarketDataContracts';
import { CalendarCursor } from '../../../../src/application/services/market-data/calendar/CalendarCursor';

describe('RegisterTradingCalendarDayService', () => {
  it('should be defined', () => {
    expect(RegisterTradingCalendarDayService).toBeDefined();
  });
});

describe('ListTradingCalendarDaysService', () => {
  it('should list calendar days', async () => {
    const mockRepo = {
      listCalendarDays: vi.fn().mockResolvedValue([]),
    } as any;

    const service = new ListTradingCalendarDaysService(mockRepo);
    const result = await service.execute({
      exchange: "HOSE",
      limit: 10,
    });

    expect(result.records).toEqual([]);
    expect(mockRepo.listCalendarDays).toHaveBeenCalledWith("HOSE", 11, undefined);
  });
});
