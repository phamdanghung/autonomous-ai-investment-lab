import { describe, it, expect } from 'vitest';
import { ImportBatchPrismaMappers } from '../../../../src/infrastructure/mappers/ImportBatchPrismaMappers';
import { RegisterImportBatchCommand } from '../../../../src/application/ports/market-data/ImportBatchPorts';
import { MarketDataIntegrityError } from '../../../../src/domain/market-data/MarketDataErrors';

describe('ImportBatchPrismaMappers', () => {
  describe('toDomain', () => {
    const baseRow: any = {
      id: 'uuid',
      sourceVersionId: 'sv-id',
      creationIdempotencyKey: 'idemp-key',
      creationRequestHash: 'hash',
      batchBusinessKey: 'biz-key',
      importMode: 'INITIAL',
      status: 'PENDING',
      parsedRowCount: 10,
      acceptedRowCount: 5,
      flaggedRowCount: 3,
      quarantinedRowCount: 2,
    };

    it('should map INITIAL correctly', () => {
      const row = { ...baseRow, importMode: 'INITIAL' };
      const domain = ImportBatchPrismaMappers.toDomain(row);
      expect(domain.importMode).toBe('INITIAL');
    });

    it('should map CORRECTION correctly', () => {
      const row = { ...baseRow, importMode: 'CORRECTION' };
      const domain = ImportBatchPrismaMappers.toDomain(row);
      expect(domain.importMode).toBe('CORRECTION');
    });

    it('should throw integrity error for unknown persisted importMode', () => {
      const row = { ...baseRow, importMode: 'UNKNOWN' };
      expect(() => ImportBatchPrismaMappers.toDomain(row)).toThrowError(MarketDataIntegrityError);
      expect(() => ImportBatchPrismaMappers.toDomain(row)).toThrowError(/Unknown persisted MarketImportMode: UNKNOWN/);
    });

    it('should map PENDING correctly', () => {
      const row = { ...baseRow, status: 'PENDING' };
      const domain = ImportBatchPrismaMappers.toDomain(row);
      expect(domain.status).toBe('PENDING');
    });

    it('should map COMPLETED correctly', () => {
      const row = { ...baseRow, status: 'COMPLETED' };
      const domain = ImportBatchPrismaMappers.toDomain(row);
      expect(domain.status).toBe('COMPLETED');
    });

    it('should map COMPLETED_WITH_QUARANTINE correctly', () => {
      const row = { ...baseRow, status: 'COMPLETED_WITH_QUARANTINE' };
      const domain = ImportBatchPrismaMappers.toDomain(row);
      expect(domain.status).toBe('COMPLETED_WITH_QUARANTINE');
    });

    it('should map FAILED correctly', () => {
      const row = { ...baseRow, status: 'FAILED' };
      const domain = ImportBatchPrismaMappers.toDomain(row);
      expect(domain.status).toBe('FAILED');
    });

    it('should throw integrity error for unknown persisted status', () => {
      const row = { ...baseRow, status: 'UNKNOWN' };
      expect(() => ImportBatchPrismaMappers.toDomain(row)).toThrowError(MarketDataIntegrityError);
      expect(() => ImportBatchPrismaMappers.toDomain(row)).toThrowError(/Unknown persisted MarketImportStatus: UNKNOWN/);
    });

    it('should map counters correctly', () => {
      const domain = ImportBatchPrismaMappers.toDomain(baseRow);
      expect(domain.parsedRowCount).toBe(10);
      expect(domain.acceptedRowCount).toBe(5);
      expect(domain.flaggedRowCount).toBe(3);
      expect(domain.quarantinedRowCount).toBe(2);
    });

    it('should project nullable idempotency key', () => {
      const row = { ...baseRow, creationIdempotencyKey: null };
      const domain = ImportBatchPrismaMappers.toDomain(row);
      expect(domain.creationIdempotencyKey).toBeNull();
    });
  });

  describe('toPrismaCreate', () => {
    const startedAt = new Date();
    const baseCommand: RegisterImportBatchCommand = {
      creationIdempotencyKey: 'idemp-key',
      creationRequestHash: 'hash',
      batchBusinessKey: 'biz-key',
      sourceVersionId: 'sv-id',
      sourceObjectKey: 'obj-key',
      sourceContentHash: '0000000000000000000000000000000000000000000000000000000000000000',
      sourceByteSize: '100',
      declaredRowCount: 50,
      importMode: 'INITIAL',
      startedAt,
    };

    it('should convert decimal string to BigInt', () => {
      const prismaCreate = ImportBatchPrismaMappers.toPrismaCreate(baseCommand);
      expect(prismaCreate.sourceByteSize).toBe(100n);
    });

    it('should preserve declaredRowCount value', () => {
      const prismaCreate = ImportBatchPrismaMappers.toPrismaCreate(baseCommand);
      expect(prismaCreate.declaredRowCount).toBe(50);
    });

    it('should preserve declaredRowCount null', () => {
      const prismaCreate = ImportBatchPrismaMappers.toPrismaCreate({ ...baseCommand, declaredRowCount: null });
      expect(prismaCreate.declaredRowCount).toBeNull();
    });

    it('should preserve startedAt in create data', () => {
      const prismaCreate = ImportBatchPrismaMappers.toPrismaCreate(baseCommand);
      expect(prismaCreate.startedAt).toBe(startedAt);
    });

    it('should map INITIAL to INITIAL', () => {
      const prismaCreate = ImportBatchPrismaMappers.toPrismaCreate({ ...baseCommand, importMode: 'INITIAL' });
      expect(prismaCreate.importMode).toBe('INITIAL');
    });

    it('should map CORRECTION to CORRECTION', () => {
      const prismaCreate = ImportBatchPrismaMappers.toPrismaCreate({ ...baseCommand, importMode: 'CORRECTION' });
      expect(prismaCreate.importMode).toBe('CORRECTION');
    });

    it('should throw Integrity Error when sourceByteSize is malformed (no SyntaxError leak)', () => {
      expect(() => ImportBatchPrismaMappers.toPrismaCreate({ ...baseCommand, sourceByteSize: 'abc' }))
        .toThrowError(MarketDataIntegrityError);
      
      try {
        ImportBatchPrismaMappers.toPrismaCreate({ ...baseCommand, sourceByteSize: 'abc' });
      } catch (e: any) {
        expect(e.code).toBe('MARKET_DATA_INTEGRITY_ERROR');
        expect(e.message).not.toContain('Cannot convert abc to a BigInt');
      }
    });

    it('should throw Integrity Error for unknown domain importMode', () => {
      const unknownMode = 'UNKNOWN' as any;
      expect(() => ImportBatchPrismaMappers.toPrismaCreate({ ...baseCommand, importMode: unknownMode }))
        .toThrowError(MarketDataIntegrityError);
    });
  });
});
