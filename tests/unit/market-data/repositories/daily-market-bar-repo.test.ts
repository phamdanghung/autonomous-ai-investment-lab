import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaDailyMarketBarRepository } from '../../../../src/infrastructure/repositories/market-data/PrismaDailyMarketBarRepository';
import { DailyMarketBarPrismaMappers } from '../../../../src/infrastructure/mappers/DailyMarketBarPrismaMappers';
import { AppendDailyMarketBarCommand, DailyMarketBarUniqueCollisionError } from '../../../../src/application/ports/market-data/DailyMarketBarPorts';
import { MarketDataIntegrityError } from '../../../../src/domain/market-data/MarketDataErrors';
import * as fs from 'fs';
import * as path from 'path';

describe('PrismaDailyMarketBarRepository', () => {
  let prismaMock: any;
  let repository: PrismaDailyMarketBarRepository;

  const basePrismaRow = {
    id: 'db-id-123',
    sourceVersionId: 'sv-1',
    importBatchId: 'ib-1',
    sourceRecordKey: 'rec-1',
    instrumentId: 'inst-1',
    marketDate: new Date(Date.UTC(2025, 0, 15)),
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

  beforeEach(() => {
    prismaMock = {
      dailyMarketBar: {
        findUnique: vi.fn(),
        create: vi.fn()
      },
      marketDataImportBatch: {
        findUnique: vi.fn()
      }
    };
    repository = new PrismaDailyMarketBarRepository(prismaMock as any);
  });

  describe('A. findByCanonicalHash', () => {
    it('correct findUnique where, mapper result returned, null preserved', async () => {
      prismaMock.dailyMarketBar.findUnique.mockResolvedValueOnce(basePrismaRow);
      const result = await repository.findByCanonicalHash(basePrismaRow.canonicalHash);
      expect(prismaMock.dailyMarketBar.findUnique).toHaveBeenCalledWith({
        where: { canonicalHash: basePrismaRow.canonicalHash }
      });
      expect(result).toBeDefined();
      expect(result?.canonicalHash).toBe(basePrismaRow.canonicalHash);

      prismaMock.dailyMarketBar.findUnique.mockResolvedValueOnce(null);
      const nullResult = await repository.findByCanonicalHash('does-not-exist');
      expect(nullResult).toBeNull();
    });
  });

  describe('B. Identity A', () => {
    it('exact composite unique filter including converted Date', async () => {
      prismaMock.dailyMarketBar.findUnique.mockResolvedValueOnce(basePrismaRow);
      await repository.findBySourceInstrumentDateVersion('sv-1', 'inst-1', '2025-01-15', 0);
      expect(prismaMock.dailyMarketBar.findUnique).toHaveBeenCalledWith({
        where: {
          sourceVersionId_instrumentId_marketDate_correctionVersion: {
            sourceVersionId: 'sv-1',
            instrumentId: 'inst-1',
            marketDate: new Date(Date.UTC(2025, 0, 15)),
            correctionVersion: 0
          }
        }
      });
    });
  });

  describe('C. Identity B', () => {
    it('exact composite unique filter', async () => {
      prismaMock.dailyMarketBar.findUnique.mockResolvedValueOnce(basePrismaRow);
      await repository.findBySourceRecordVersion('sv-1', 'rec-1', 0);
      expect(prismaMock.dailyMarketBar.findUnique).toHaveBeenCalledWith({
        where: {
          sourceVersionId_sourceRecordKey_correctionVersion: {
            sourceVersionId: 'sv-1',
            sourceRecordKey: 'rec-1',
            correctionVersion: 0
          }
        }
      });
    });
  });

  describe('D. findBySupersedesBarId', () => {
    it('exact unique filter', async () => {
      prismaMock.dailyMarketBar.findUnique.mockResolvedValueOnce(basePrismaRow);
      await repository.findBySupersedesBarId('prev-id');
      expect(prismaMock.dailyMarketBar.findUnique).toHaveBeenCalledWith({
        where: { supersedesBarId: 'prev-id' }
      });
    });
  });

  describe('E. ImportBatch lookup', () => {
    it('select exactly id, sourceVersionId, status; Test all statuses', async () => {
      const statuses = ['PENDING', 'COMPLETED', 'COMPLETED_WITH_QUARANTINE', 'FAILED'];
      for (const status of statuses) {
        prismaMock.marketDataImportBatch.findUnique.mockResolvedValueOnce({
          id: 'ib-1',
          sourceVersionId: 'sv-1',
          status: status
        });
        const result = await repository.findById('ib-1');
        expect(prismaMock.marketDataImportBatch.findUnique).toHaveBeenCalledWith({
          where: { id: 'ib-1' },
          select: { id: true, sourceVersionId: true, status: true }
        });
        expect(result).toEqual({
          id: 'ib-1',
          sourceVersionId: 'sv-1',
          status: status
        });
      }

      // test null
      prismaMock.marketDataImportBatch.findUnique.mockResolvedValueOnce(null);
      expect(await repository.findById('ib-2')).toBeNull();

      // test invalid status
      prismaMock.marketDataImportBatch.findUnique.mockResolvedValueOnce({
        id: 'ib-1',
        sourceVersionId: 'sv-1',
        status: 'UNKNOWN'
      });
      await expect(repository.findById('ib-3')).rejects.toThrowError(MarketDataIntegrityError);
    });
  });

  describe('F. insert success', () => {
    it('dailyMarketBar.create called once, exact mapped create data, exact mapped Domain object returned', async () => {
      prismaMock.dailyMarketBar.create.mockResolvedValueOnce(basePrismaRow);
      const result = await repository.insert(baseCommand);
      
      expect(prismaMock.dailyMarketBar.create).toHaveBeenCalledTimes(1);
      const callArg = prismaMock.dailyMarketBar.create.mock.calls[0][0];
      expect(callArg.data).toBeDefined();
      expect(callArg.data.marketDate).toEqual(new Date(Date.UTC(2025, 0, 15)));
      expect(callArg.data.open).toBe(100n);
      expect(callArg.data.volume).toBe(1000n);
      
      expect(result).toBeDefined();
      expect(result.canonicalHash).toBe(baseCommand.canonicalHash);
    });
  });

  describe('Error Mappings', () => {
    it('G. P2002 -> DailyMarketBarUniqueCollisionError', async () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError('collision', { code: 'P2002', clientVersion: '4' });
      prismaMock.dailyMarketBar.create.mockRejectedValue(p2002);
      
      await expect(repository.insert(baseCommand)).rejects.toThrowError(DailyMarketBarUniqueCollisionError);
      try {
        await repository.insert(baseCommand);
      } catch (e: any) {
        expect(e.name).toBe('DailyMarketBarUniqueCollisionError');
        expect(e.message).toBe('Daily market bar unique collision.');
      }
    });

    it('H. P2003 -> MarketDataIntegrityError', async () => {
      const p2003 = new Prisma.PrismaClientKnownRequestError('fk fail', { code: 'P2003', clientVersion: '4' });
      prismaMock.dailyMarketBar.create.mockRejectedValue(p2003);
      
      let error: any;
      try {
        await repository.insert(baseCommand);
      } catch (e: any) {
        error = e;
      }
      expect(error).toBeInstanceOf(MarketDataIntegrityError);
      expect(error.message).toBe('Daily market bar references missing persistence identity.');
      expect(error.message).not.toContain('fk fail');
      expect(error.message).not.toContain('P2003');
    });

    it('I. P2025 INSERT -> MarketDataIntegrityError', async () => {
      const p2025 = new Prisma.PrismaClientKnownRequestError('relation not found', { code: 'P2025', clientVersion: '4' });
      prismaMock.dailyMarketBar.create.mockRejectedValue(p2025);
      
      let error: any;
      try {
        await repository.insert(baseCommand);
      } catch (e: any) {
        error = e;
      }
      expect(error).toBeInstanceOf(MarketDataIntegrityError);
      expect(error.message).toBe('Daily market bar references missing persistence identity.');
      expect(error.message).not.toContain('relation not found');
      expect(error.message).not.toContain('P2025');
    });

    it('J. Other P2xxx -> MarketDataIntegrityError', async () => {
      const p2004 = new Prisma.PrismaClientKnownRequestError('other', { code: 'P2004', clientVersion: '4' });
      prismaMock.dailyMarketBar.create.mockRejectedValue(p2004);
      
      let error: any;
      try {
        await repository.insert(baseCommand);
      } catch (e: any) {
        error = e;
      }
      expect(error).toBeInstanceOf(MarketDataIntegrityError);
      expect(error.message).toBe('Database integrity error.');
      expect(error.message).not.toContain('other');
      expect(error.message).not.toContain('P2004');
    });

    it('K. PrismaClientUnknownRequestError -> MarketDataIntegrityError', async () => {
      const unknownPrismaError = new Prisma.PrismaClientUnknownRequestError('raw engine error check constraint', { clientVersion: '4' });
      prismaMock.dailyMarketBar.create.mockRejectedValue(unknownPrismaError);
      
      let error: any;
      try {
        await repository.insert(baseCommand);
      } catch (e: any) {
        error = e;
      }
      expect(error).toBeInstanceOf(MarketDataIntegrityError);
      expect(error.message).toBe('Database integrity error.');
      expect(error.message).not.toContain('raw engine error');
    });

    it('L. non-Prisma error -> Exact object identity preserved', async () => {
      const genericError = new Error('Connection failed');
      prismaMock.dailyMarketBar.create.mockRejectedValue(genericError);
      
      try {
        await repository.insert(baseCommand);
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).toBe(genericError);
      }
    });

    it('M. mapper/domain error -> Exact error object identity preserved', async () => {
      const cmd = { ...baseCommand, open: 'invalid-integer' }; // Will throw in mapper
      try {
        await repository.insert(cmd);
        expect.fail('should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(MarketDataIntegrityError);
        expect(e.message).toBe('Daily market bar contains malformed persisted integer data.');
      }
    });
  });

  describe('L. append-only static scan', () => {
    it('should statically verify no update/delete methods are in the repository', () => {
      const fileContent = fs.readFileSync(path.resolve(__dirname, '../../../../src/infrastructure/repositories/market-data/PrismaDailyMarketBarRepository.ts'), 'utf-8');
      
      expect(fileContent).not.toContain('.update(');
      expect(fileContent).not.toContain('.updateMany(');
      expect(fileContent).not.toContain('.upsert(');
      expect(fileContent).not.toContain('.delete(');
      expect(fileContent).not.toContain('.deleteMany(');
      expect(fileContent).not.toContain('$queryRaw');
      expect(fileContent).not.toContain('$executeRaw');
      expect(fileContent).toContain('.create(');
    });
  });
});
