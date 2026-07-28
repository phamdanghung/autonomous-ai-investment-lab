import { describe, it, expect } from 'vitest';
import { MarketDataPrismaMappers } from '../../../src/infrastructure/repositories/market-data/MarketDataPrismaMappers';
import { MarketDataIntegrityError } from '../../../src/domain/market-data/MarketDataErrors';
import { MarketExchange, SecurityType } from '../../../src/domain/contracts/MarketDataContracts';

describe('MarketDataPrismaMappers', () => {
  it('Mapper fixed-vector: Date UTC -> YYYY-MM-DD', () => {
    const record = {
      id: 'd9e03f56-62b1-4f18-bb9f-8557b7705cc6',
      businessKey: 'HOSE#VND#EQUITY#2023-01-01',
      exchange: 'HOSE' as any,
      canonicalSymbol: 'VND',
      securityType: 'EQUITY' as any,
      currency: 'VND' as any,
      effectiveFrom: new Date(Date.UTC(2023, 0, 1)),
      effectiveTo: new Date(Date.UTC(2023, 11, 31)),
      createdAt: new Date(),
      sealedAt: new Date()
    };
    const mapped = MarketDataPrismaMappers.mapToApplicationRecord(record);
    expect(mapped.effectiveFrom).toBe('2023-01-01');
    expect(mapped.effectiveTo).toBe('2023-12-31');
  });

  it('Mapper fixed-vector: effectiveTo null', () => {
    const record = {
      id: 'd9e03f56-62b1-4f18-bb9f-8557b7705cc6',
      businessKey: 'HOSE#VND#EQUITY#2023-01-01',
      exchange: 'HOSE' as any,
      canonicalSymbol: 'VND',
      securityType: 'EQUITY' as any,
      currency: 'VND' as any,
      effectiveFrom: new Date(Date.UTC(2023, 0, 1)),
      effectiveTo: null,
      createdAt: new Date(),
      sealedAt: new Date()
    };
    const mapped = MarketDataPrismaMappers.mapToApplicationRecord(record);
    expect(mapped.effectiveTo).toBeNull();
  });

  it('Mapper fixed-vector: SecurityType EQUITY', () => {
    const record = {
      id: 'd9e03f56-62b1-4f18-bb9f-8557b7705cc6',
      businessKey: 'HOSE#VND#EQUITY#2023-01-01',
      exchange: 'HOSE' as any,
      canonicalSymbol: 'VND',
      securityType: 'EQUITY' as any,
      currency: 'VND' as any,
      effectiveFrom: new Date(Date.UTC(2023, 0, 1)),
      effectiveTo: null,
      createdAt: new Date(),
      sealedAt: new Date()
    };
    const mapped = MarketDataPrismaMappers.mapToApplicationRecord(record);
    expect(mapped.securityType).toBe('EQUITY');
  });

  it('Mapper fixed-vector: unknown enum/value -> MARKET_DATA_INTEGRITY_ERROR', () => {
    const record = {
      id: 'd9e03f56-62b1-4f18-bb9f-8557b7705cc6',
      businessKey: 'HOSE#VND#UNKNOWN#2023-01-01',
      exchange: 'HOSE' as any,
      canonicalSymbol: 'VND',
      securityType: 'UNKNOWN_TYPE' as any,
      currency: 'VND' as any,
      effectiveFrom: new Date(Date.UTC(2023, 0, 1)),
      effectiveTo: null,
      createdAt: new Date(),
      sealedAt: new Date()
    };
    expect(() => MarketDataPrismaMappers.mapToApplicationRecord(record)).toThrowError(MarketDataIntegrityError);
  });

  it('mapYYYYMMDDToDate correctly converts string to UTC midnight Date', () => {
    // 2023-01-01 -> 2023-01-01T00:00:00.000Z
    const d1 = MarketDataPrismaMappers.mapYYYYMMDDToDate('2023-01-01');
    expect(d1.toISOString()).toBe('2023-01-01T00:00:00.000Z');

    // 2024-02-29 (leap year) -> 2024-02-29T00:00:00.000Z
    const d2 = MarketDataPrismaMappers.mapYYYYMMDDToDate('2024-02-29');
    expect(d2.toISOString()).toBe('2024-02-29T00:00:00.000Z');
  });

  it('Date mapping round-trip', () => {
    const originalString = '2023-01-01';
    const date = MarketDataPrismaMappers.mapYYYYMMDDToDate(originalString);
    const roundTripped = MarketDataPrismaMappers.mapDateToYYYYMMDD(date);
    expect(roundTripped).toBe(originalString);
  });
});
