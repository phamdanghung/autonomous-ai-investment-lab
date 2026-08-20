import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { DailyMarketBarPrismaMappers } from '../../../../src/infrastructure/mappers/DailyMarketBarPrismaMappers';
import { MarketDataIntegrityError } from '../../../../src/domain/market-data/MarketDataErrors';
import { AppendDailyMarketBarCommand } from '../../../../src/application/ports/market-data/DailyMarketBarPorts';
import { MarketDataPrismaMappers } from '../../../../src/infrastructure/repositories/market-data/MarketDataPrismaMappers';

describe('DailyMarketBarPrismaMappers', () => {
  const basePrismaRow: Prisma.DailyMarketBarGetPayload<{}> = {
    id: 'db-id-123',
    sourceVersionId: 'sv-1',
    importBatchId: 'ib-1',
    sourceRecordKey: 'rec-1',
    instrumentId: 'inst-1',
    marketDate: new Date(Date.UTC(2025, 0, 15)), // 2025-01-15
    barKind: 'TRADED',
    open: 100n,
    high: 110n,
    low: 90n,
    close: 105n,
    volume: 1000n,
    tradingValue: 105000n,
    correctionVersion: 0,
    supersedesBarId: null,
    qualityDecision: 'ACCEPTED',
    qualityFlags: '',
    sourceRowHash: 'a'.repeat(64),
    canonicalHash: 'b'.repeat(64),
    recordedAt: new Date()
  };

  const baseCommand: AppendDailyMarketBarCommand = {
    sourceVersionId: 'sv-1',
    importBatchId: 'ib-1',
    sourceRecordKey: 'rec-1',
    instrumentId: 'inst-1',
    marketDate: '2025-01-15',
    barKind: 'TRADED',
    open: '100',
    high: '110',
    low: '90',
    close: '105',
    volume: '1000',
    tradingValue: '105000',
    correctionVersion: 0,
    supersedesBarId: null,
    qualityDecision: 'ACCEPTED',
    qualityFlags: '',
    sourceRowHash: 'a'.repeat(64),
    canonicalHash: 'b'.repeat(64),
  };

  describe('toDomain', () => {
    it('1. Complete DB row -> complete Domain row', () => {
      const domain = DailyMarketBarPrismaMappers.toDomain(basePrismaRow);
      expect(domain.id).toBe('db-id-123');
      expect(domain.sourceVersionId).toBe('sv-1');
      expect(domain.importBatchId).toBe('ib-1');
      expect(domain.sourceRecordKey).toBe('rec-1');
      expect(domain.instrumentId).toBe('inst-1');
      expect(domain.marketDate).toBe('2025-01-15');
      expect(domain.barKind).toBe('TRADED');
      expect(domain.open).toBe('100');
      expect(domain.high).toBe('110');
      expect(domain.low).toBe('90');
      expect(domain.close).toBe('105');
      expect(domain.volume).toBe('1000');
      expect(domain.tradingValue).toBe('105000');
      expect(domain.correctionVersion).toBe(0);
      expect(domain.supersedesBarId).toBe(null);
      expect(domain.qualityDecision).toBe('ACCEPTED');
      expect(domain.qualityFlags).toBe('');
      expect(domain.sourceRowHash).toBe('a'.repeat(64));
      expect(domain.canonicalHash).toBe('b'.repeat(64));
    });

    it('2. marketDate -> exact YYYY-MM-DD', () => {
      const row = { ...basePrismaRow, marketDate: new Date(Date.UTC(2023, 11, 5)) };
      const domain = DailyMarketBarPrismaMappers.toDomain(row);
      expect(domain.marketDate).toBe('2023-12-05');
    });

    it('3. positive BigInt conversion', () => {
      const row = { ...basePrismaRow, open: 500n };
      const domain = DailyMarketBarPrismaMappers.toDomain(row);
      expect(domain.open).toBe('500');
    });

    it('4. zero BigInt conversion', () => {
      const row = { ...basePrismaRow, volume: 0n };
      const domain = DailyMarketBarPrismaMappers.toDomain(row);
      expect(domain.volume).toBe('0');
    });

    it('5. negative BigInt conversion', () => {
      // Must use QUARANTINED for negative OHLC according to DailyMarketBar.ts Domain validations
      const row = { ...basePrismaRow, open: -500n, qualityDecision: 'QUARANTINED' as any };
      const domain = DailyMarketBarPrismaMappers.toDomain(row);
      expect(domain.open).toBe('-500');
    });

    it('6. nullable OHLC/tradingValue preserved', () => {
      const row = { 
        ...basePrismaRow, 
        open: null, 
        high: null, 
        low: null, 
        close: null, 
        tradingValue: null,
        barKind: 'NO_TRADE' as any,
        volume: 0n 
      };
      const domain = DailyMarketBarPrismaMappers.toDomain(row);
      expect(domain.open).toBe(null);
      expect(domain.high).toBe(null);
      expect(domain.low).toBe(null);
      expect(domain.close).toBe(null);
      expect(domain.tradingValue).toBe(null);
    });

    it('7. TRADED mapping', () => {
      const row = { ...basePrismaRow, barKind: 'TRADED' as any };
      expect(DailyMarketBarPrismaMappers.toDomain(row).barKind).toBe('TRADED');
    });

    it('8. NO_TRADE mapping', () => {
      const row = { 
        ...basePrismaRow, 
        barKind: 'NO_TRADE' as any, 
        open: null, high: null, low: null, close: null, tradingValue: null, volume: 0n 
      };
      expect(DailyMarketBarPrismaMappers.toDomain(row).barKind).toBe('NO_TRADE');
    });

    it('9. SUSPENDED mapping', () => {
      const row = { 
        ...basePrismaRow, 
        barKind: 'SUSPENDED' as any, 
        open: null, high: null, low: null, close: null, tradingValue: null, volume: 0n 
      };
      expect(DailyMarketBarPrismaMappers.toDomain(row).barKind).toBe('SUSPENDED');
    });

    it('10. ACCEPTED mapping', () => {
      const row = { ...basePrismaRow, qualityDecision: 'ACCEPTED' as any };
      expect(DailyMarketBarPrismaMappers.toDomain(row).qualityDecision).toBe('ACCEPTED');
    });

    it('11. ACCEPTED_WITH_FLAGS mapping', () => {
      const row = { ...basePrismaRow, qualityDecision: 'ACCEPTED_WITH_FLAGS' as any };
      expect(DailyMarketBarPrismaMappers.toDomain(row).qualityDecision).toBe('ACCEPTED_WITH_FLAGS');
    });

    it('12. QUARANTINED mapping', () => {
      const row = { ...basePrismaRow, qualityDecision: 'QUARANTINED' as any };
      expect(DailyMarketBarPrismaMappers.toDomain(row).qualityDecision).toBe('QUARANTINED');
    });

    it('13. unknown persisted barKind -> integrity error', () => {
      const row = { ...basePrismaRow, barKind: 'UNKNOWN_KIND' as any };
      expect(() => DailyMarketBarPrismaMappers.toDomain(row)).toThrowError(MarketDataIntegrityError);
      expect(() => DailyMarketBarPrismaMappers.toDomain(row)).toThrowError('Unknown persisted barKind.');
    });

    it('14. unknown persisted qualityDecision -> integrity error', () => {
      const row = { ...basePrismaRow, qualityDecision: 'UNKNOWN_DECISION' as any };
      expect(() => DailyMarketBarPrismaMappers.toDomain(row)).toThrowError(MarketDataIntegrityError);
      expect(() => DailyMarketBarPrismaMappers.toDomain(row)).toThrowError('Unknown persisted qualityDecision.');
    });
  });

  describe('toPrismaCreate', () => {
    it('15. create mapping positive integers', () => {
      const input = DailyMarketBarPrismaMappers.toPrismaCreate(baseCommand);
      expect(input.open).toBe(100n);
      expect(input.high).toBe(110n);
      expect(input.low).toBe(90n);
      expect(input.close).toBe(105n);
      expect(input.volume).toBe(1000n);
      expect(input.tradingValue).toBe(105000n);
    });

    it('16. create mapping negative quarantined integers', () => {
      const cmd = { ...baseCommand, qualityDecision: 'QUARANTINED' as any, open: '-50' };
      const input = DailyMarketBarPrismaMappers.toPrismaCreate(cmd);
      expect(input.open).toBe(-50n);
    });

    it('17. null optional fields', () => {
      const cmd = { ...baseCommand, open: null, high: null, low: null, close: null, tradingValue: null };
      const input = DailyMarketBarPrismaMappers.toPrismaCreate(cmd);
      expect(input.open).toBe(null);
      expect(input.high).toBe(null);
      expect(input.low).toBe(null);
      expect(input.close).toBe(null);
      expect(input.tradingValue).toBe(null);
    });

    it('18. predecessor null -> no supersedes connect', () => {
      const input = DailyMarketBarPrismaMappers.toPrismaCreate(baseCommand);
      expect(input.supersedesBar).toBeUndefined();
    });

    it('19. predecessor non-null -> correct connect', () => {
      const cmd = { ...baseCommand, supersedesBarId: 'prev-id' };
      const input = DailyMarketBarPrismaMappers.toPrismaCreate(cmd);
      expect(input.supersedesBar).toEqual({ connect: { id: 'prev-id' } });
    });

    it('20. sourceVersion/importBatch/instrument connect exact IDs', () => {
      const input = DailyMarketBarPrismaMappers.toPrismaCreate(baseCommand);
      expect(input.sourceVersion).toEqual({ connect: { id: 'sv-1' } });
      expect(input.importBatch).toEqual({ connect: { id: 'ib-1' } });
      expect(input.instrument).toEqual({ connect: { id: 'inst-1' } });
    });

    it('21. create data does not include id', () => {
      const input = DailyMarketBarPrismaMappers.toPrismaCreate(baseCommand) as any;
      expect(input.id).toBeUndefined();
    });

    it('22. create data does not include recordedAt', () => {
      const input = DailyMarketBarPrismaMappers.toPrismaCreate(baseCommand) as any;
      expect(input.recordedAt).toBeUndefined();
    });

    it('23. malformed integer -> MarketDataIntegrityError', () => {
      const cmd = { ...baseCommand, open: 'not-an-integer' };
      expect(() => DailyMarketBarPrismaMappers.toPrismaCreate(cmd)).toThrowError(MarketDataIntegrityError);
      expect(() => DailyMarketBarPrismaMappers.toPrismaCreate(cmd)).toThrowError('Daily market bar contains malformed persisted integer data.');
    });

    it('24. native BigInt SyntaxError does not leak', () => {
      const cmd = { ...baseCommand, volume: '12.34' };
      try {
        DailyMarketBarPrismaMappers.toPrismaCreate(cmd);
        expect.fail('Should throw error');
      } catch (e: any) {
        expect(e).toBeInstanceOf(MarketDataIntegrityError);
        expect(e.message).not.toContain('Cannot convert');
        expect(e.message).toBe('Daily market bar contains malformed persisted integer data.');
      }
    });
  });
});
