import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RegisterTradingCalendarDayService } from '../../../../src/application/services/market-data/calendar/RegisterTradingCalendarDayService';
import { ListTradingCalendarDaysService } from '../../../../src/application/services/market-data/calendar/ListTradingCalendarDaysService';
import { TradingCalendarDayDomain } from '../../../../src/domain/market-data/TradingCalendarDay';
import { MarketSourceVersionNotFoundError, TradingCalendarConflictError, MarketDataIntegrityError } from '../../../../src/domain/market-data/MarketDataErrors';
import { CalendarUniqueCollisionError, CalendarSourceFkViolationError } from '../../../../src/application/ports/market-data/TradingCalendarPorts';

describe('RegisterTradingCalendarDayService', () => {
  let mockRepo: any;

  beforeEach(() => {
    mockRepo = {
      runTransaction: vi.fn().mockImplementation(async (cb) => cb({ _fakeContext: true })),
      findSourceVersionIdByKey: vi.fn(),
      findCalendarDayByIdentity: vi.fn(),
      findCalendarDayByCanonicalHash: vi.fn(),
      insertCalendarDay: vi.fn(),
    };
  });

  const validRequest = {
    sourceVersionKey: 'VN|MARKET_DATA_SOURCE|1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    exchange: 'HOSE' as any,
    marketDate: '2023-01-01',
    dayType: 'TRADING_DAY',
    reason: null
  };

  it('should be defined', () => {
    expect(RegisterTradingCalendarDayService).toBeDefined();
  });

  describe('P2002 Unique Collision Recovery', () => {
    it('should throw MarketDataIntegrityError when identity missing + canonicalHash row exists', async () => {
      const service = new RegisterTradingCalendarDayService(mockRepo);
      mockRepo.findSourceVersionIdByKey.mockResolvedValue('source-id');
      mockRepo.findCalendarDayByIdentity.mockResolvedValue(null);
      mockRepo.findCalendarDayByCanonicalHash.mockResolvedValue({ id: 'some-id' });
      mockRepo.insertCalendarDay.mockRejectedValueOnce(new CalendarUniqueCollisionError());

      await expect(service.execute(validRequest)).rejects.toThrowError(/Canonical hash exists but identity differs\./);
    });

    it('should throw MarketDataIntegrityError when identity missing + canonicalHash row absent', async () => {
      const service = new RegisterTradingCalendarDayService(mockRepo);
      mockRepo.findSourceVersionIdByKey.mockResolvedValue('source-id');
      mockRepo.findCalendarDayByIdentity.mockResolvedValue(null);
      mockRepo.findCalendarDayByCanonicalHash.mockResolvedValue(null);
      mockRepo.insertCalendarDay.mockRejectedValueOnce(new CalendarUniqueCollisionError());

      await expect(service.execute(validRequest)).rejects.toThrowError(/Unique collision on unknown constraint\./);
    });
  });

  describe('P2003 FK Violation Recovery', () => {
    it('should throw MarketSourceVersionNotFoundError when source is missing', async () => {
      const service = new RegisterTradingCalendarDayService(mockRepo);
      mockRepo.findSourceVersionIdByKey.mockResolvedValueOnce('source-id'); // Before insert
      mockRepo.findSourceVersionIdByKey.mockResolvedValueOnce(null); // During recovery
      mockRepo.findCalendarDayByIdentity.mockResolvedValue(null);
      mockRepo.insertCalendarDay.mockRejectedValueOnce(new CalendarSourceFkViolationError());

      await expect(service.execute(validRequest)).rejects.toThrow(MarketSourceVersionNotFoundError);
    });

    it('should throw MarketDataIntegrityError when source still exists', async () => {
      const service = new RegisterTradingCalendarDayService(mockRepo);
      mockRepo.findSourceVersionIdByKey.mockResolvedValue('source-id'); // Before insert and during recovery
      mockRepo.findCalendarDayByIdentity.mockResolvedValue(null);
      mockRepo.insertCalendarDay.mockRejectedValueOnce(new CalendarSourceFkViolationError());

      await expect(service.execute(validRequest)).rejects.toThrowError(/Source version exists but FK violation occurred\./);
    });
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
