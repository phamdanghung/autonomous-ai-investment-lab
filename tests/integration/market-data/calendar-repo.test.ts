import { describe, it, expect } from 'vitest';
import { PrismaTradingCalendarRepository } from '../../../src/infrastructure/repositories/market-data/PrismaTradingCalendarRepository';
import { PrismaClient } from '@prisma/client';

describe('PrismaTradingCalendarRepository', () => {
  it('should initialize successfully', () => {
    const repo = new PrismaTradingCalendarRepository({} as PrismaClient);
    expect(repo).toBeDefined();
  });
});
