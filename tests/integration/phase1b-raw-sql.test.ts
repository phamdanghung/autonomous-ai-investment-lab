import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

describe('Phase 1B Raw SQL Invariant Tests', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const getUuid = () => uuidv4();
  const getHash = () => crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const ts = new Date().toISOString();

  describe('Instrument', () => {
    it('1. effectiveTo < effectiveFrom bị từ chối', async () => {
      const id = getUuid();
      await expect(prisma.$executeRawUnsafe(`
        INSERT INTO "MarketInstrument" ("id", "businessKey", "exchange", "canonicalSymbol", "securityType", "currency", "effectiveFrom", "effectiveTo", "createdAt", "sealedAt")
        VALUES ('${id}', '${id}', 'HOSE', 'AAA', 'EQUITY', 'VND', '2024-01-01', '2023-01-01', '${ts}', '${ts}')
      `)).rejects.toThrow();
    });

    it('2. effectiveTo NULL -> valid DATE được phép', async () => {
      const id = getUuid();
      await prisma.$executeRawUnsafe(`
        INSERT INTO "MarketInstrument" ("id", "businessKey", "exchange", "canonicalSymbol", "securityType", "currency", "effectiveFrom", "createdAt", "sealedAt")
        VALUES ('${id}', '${id}', 'HOSE', 'AAA2', 'EQUITY', 'VND', '2024-01-01', '${ts}', '${ts}')
      `);
      await expect(prisma.$executeRawUnsafe(`
        UPDATE "MarketInstrument" SET "effectiveTo" = '2025-01-01' WHERE "id" = '${id}'
      `)).resolves.not.toThrow();
    });

    it('3. Sửa effectiveTo lần hai bị từ chối', async () => {
      const id = getUuid();
      await prisma.$executeRawUnsafe(`
        INSERT INTO "MarketInstrument" ("id", "businessKey", "exchange", "canonicalSymbol", "securityType", "currency", "effectiveFrom", "effectiveTo", "createdAt", "sealedAt")
        VALUES ('${id}', '${id}', 'HOSE', 'AAA3', 'EQUITY', 'VND', '2024-01-01', '2025-01-01', '${ts}', '${ts}')
      `);
      await expect(prisma.$executeRawUnsafe(`
        UPDATE "MarketInstrument" SET "effectiveTo" = '2026-01-01' WHERE "id" = '${id}'
      `)).rejects.toThrow();
    });

    it('4. Sửa sealedAt bị từ chối', async () => {
      const id = getUuid();
      await prisma.$executeRawUnsafe(`
        INSERT INTO "MarketInstrument" ("id", "businessKey", "exchange", "canonicalSymbol", "securityType", "currency", "effectiveFrom", "createdAt", "sealedAt")
        VALUES ('${id}', '${id}', 'HOSE', 'AAA4', 'EQUITY', 'VND', '2024-01-01', '${ts}', '${ts}')
      `);
      await expect(prisma.$executeRawUnsafe(`
        UPDATE "MarketInstrument" SET "sealedAt" = '2025-01-01T00:00:00.000Z' WHERE "id" = '${id}'
      `)).rejects.toThrow();
    });

    it('5. DELETE bị từ chối', async () => {
      const id = getUuid();
      await prisma.$executeRawUnsafe(`
        INSERT INTO "MarketInstrument" ("id", "businessKey", "exchange", "canonicalSymbol", "securityType", "currency", "effectiveFrom", "createdAt", "sealedAt")
        VALUES ('${id}', '${id}', 'HOSE', 'AAA5', 'EQUITY', 'VND', '2024-01-01', '${ts}', '${ts}')
      `);
      await expect(prisma.$executeRawUnsafe(`
        DELETE FROM "MarketInstrument" WHERE "id" = '${id}'
      `)).rejects.toThrow();
    });
  });

  describe('Calendar and SourceVersion', () => {
    it('6. Calendar UPDATE bị từ chối', async () => {
      const svId = getUuid();
      await prisma.$executeRawUnsafe(`
        INSERT INTO "MarketDataSourceVersion" ("id", "sourceKey", "contractHash", "providerCode", "datasetKind", "adapterKind", "adapterVersion", "schemaVersion", "canonicalizationVersion", "priceUnit", "encoding", "createdAt", "sealedAt")
        VALUES ('${svId}', '${svId}', '${getHash()}', 'P', 'EOD_MARKET_DATA', 'REPOSITORY_CSV_FIXTURE', '1', '1', '1', 'VND_PER_SHARE', 'UTF8', '${ts}', '${ts}')
      `);
      const id = getUuid();
      await prisma.$executeRawUnsafe(`
        INSERT INTO "TradingCalendarDay" ("id", "sourceVersionId", "exchange", "marketDate", "dayType", "canonicalHash", "createdAt")
        VALUES ('${id}', '${svId}', 'HOSE', '2024-01-01', 'TRADING', '${getHash()}', '${ts}')
      `);
      await expect(prisma.$executeRawUnsafe(`
        UPDATE "TradingCalendarDay" SET "dayType" = 'CLOSED' WHERE "id" = '${id}'
      `)).rejects.toThrow();
    });

    it('7. Calendar DELETE bị từ chối', async () => {
      const svId = getUuid();
      await prisma.$executeRawUnsafe(`
        INSERT INTO "MarketDataSourceVersion" ("id", "sourceKey", "contractHash", "providerCode", "datasetKind", "adapterKind", "adapterVersion", "schemaVersion", "canonicalizationVersion", "priceUnit", "encoding", "createdAt", "sealedAt")
        VALUES ('${svId}', '${svId}', '${getHash()}', 'P', 'EOD_MARKET_DATA', 'REPOSITORY_CSV_FIXTURE', '1', '1', '1', 'VND_PER_SHARE', 'UTF8', '${ts}', '${ts}')
      `);
      const id = getUuid();
      await prisma.$executeRawUnsafe(`
        INSERT INTO "TradingCalendarDay" ("id", "sourceVersionId", "exchange", "marketDate", "dayType", "canonicalHash", "createdAt")
        VALUES ('${id}', '${svId}', 'HOSE', '2024-01-02', 'TRADING', '${getHash()}', '${ts}')
      `);
      await expect(prisma.$executeRawUnsafe(`
        DELETE FROM "TradingCalendarDay" WHERE "id" = '${id}'
      `)).rejects.toThrow();
    });

    it('8. SourceVersion UPDATE bị từ chối', async () => {
      const id = getUuid();
      await prisma.$executeRawUnsafe(`
        INSERT INTO "MarketDataSourceVersion" ("id", "sourceKey", "contractHash", "providerCode", "datasetKind", "adapterKind", "adapterVersion", "schemaVersion", "canonicalizationVersion", "priceUnit", "encoding", "createdAt", "sealedAt")
        VALUES ('${id}', '${id}', '${getHash()}', 'P', 'EOD_MARKET_DATA', 'REPOSITORY_CSV_FIXTURE', '1', '1', '1', 'VND_PER_SHARE', 'UTF8', '${ts}', '${ts}')
      `);
      await expect(prisma.$executeRawUnsafe(`
        UPDATE "MarketDataSourceVersion" SET "providerCode" = 'Q' WHERE "id" = '${id}'
      `)).rejects.toThrow();
    });

    it('9. SourceVersion DELETE bị từ chối', async () => {
      const id = getUuid();
      await prisma.$executeRawUnsafe(`
        INSERT INTO "MarketDataSourceVersion" ("id", "sourceKey", "contractHash", "providerCode", "datasetKind", "adapterKind", "adapterVersion", "schemaVersion", "canonicalizationVersion", "priceUnit", "encoding", "createdAt", "sealedAt")
        VALUES ('${id}', '${id}', '${getHash()}', 'P', 'EOD_MARKET_DATA', 'REPOSITORY_CSV_FIXTURE', '1', '1', '1', 'VND_PER_SHARE', 'UTF8', '${ts}', '${ts}')
      `);
      await expect(prisma.$executeRawUnsafe(`
        DELETE FROM "MarketDataSourceVersion" WHERE "id" = '${id}'
      `)).rejects.toThrow();
    });

    it('39. Insert SourceVersion với sealedAt = NULL bị từ chối (NOT NULL violation)', async () => {
      const id = getUuid();
      await expect(prisma.$executeRawUnsafe(`
        INSERT INTO "MarketDataSourceVersion" ("id", "sourceKey", "contractHash", "providerCode", "datasetKind", "adapterKind", "adapterVersion", "schemaVersion", "canonicalizationVersion", "priceUnit", "encoding", "createdAt", "sealedAt")
        VALUES ('${id}', '${id}', '${getHash()}', 'P', 'EOD_MARKET_DATA', 'REPOSITORY_CSV_FIXTURE', '1', '1', '1', 'VND_PER_SHARE', 'UTF8', '${ts}', NULL)
      `)).rejects.toThrow();
    });

    it('40. Insert SourceVersion với sealedAt = non-null timestamp hợp lệ được phép', async () => {
      const id = getUuid();
      await expect(prisma.$executeRawUnsafe(`
        INSERT INTO "MarketDataSourceVersion" ("id", "sourceKey", "contractHash", "providerCode", "datasetKind", "adapterKind", "adapterVersion", "schemaVersion", "canonicalizationVersion", "priceUnit", "encoding", "createdAt", "sealedAt")
        VALUES ('${id}', '${id}', '${getHash()}', 'P', 'EOD_MARKET_DATA', 'REPOSITORY_CSV_FIXTURE', '1', '1', '1', 'VND_PER_SHARE', 'UTF8', '${ts}', '${ts}')
      `)).resolves.not.toThrow();
    });
  });

  describe('ImportBatch', () => {
    let svId: string;
    beforeAll(async () => {
      svId = getUuid();
      await prisma.$executeRawUnsafe(`
        INSERT INTO "MarketDataSourceVersion" ("id", "sourceKey", "contractHash", "providerCode", "datasetKind", "adapterKind", "adapterVersion", "schemaVersion", "canonicalizationVersion", "priceUnit", "encoding", "createdAt", "sealedAt")
        VALUES ('${svId}', '${svId}', '${getHash()}', 'P', 'EOD_MARKET_DATA', 'REPOSITORY_CSV_FIXTURE', '1', '1', '1', 'VND_PER_SHARE', 'UTF8', '${ts}', '${ts}')
      `);
    });

    it('10. Negative count bị từ chối', async () => {
      const id = getUuid();
      await expect(prisma.$executeRawUnsafe(`
        INSERT INTO "MarketDataImportBatch" ("id", "batchBusinessKey", "creationIdempotencyKey", "creationRequestHash", "sourceVersionId", "sourceObjectKey", "sourceContentHash", "sourceByteSize", "importMode", "status", "startedAt", "parsedRowCount", "acceptedRowCount", "flaggedRowCount", "quarantinedRowCount", "createdAt")
        VALUES ('${id}', '${id}', '${id}', '${id}', '${svId}', 'obj', 'hash', 10, 'INITIAL', 'PENDING', '${ts}', -1, 0, 0, 0, '${ts}')
      `)).rejects.toThrow();
    });

    it('11. Invalid timestamp/status combination bị từ chối', async () => {
      const id = getUuid();
      await expect(prisma.$executeRawUnsafe(`
        INSERT INTO "MarketDataImportBatch" ("id", "batchBusinessKey", "creationIdempotencyKey", "creationRequestHash", "sourceVersionId", "sourceObjectKey", "sourceContentHash", "sourceByteSize", "importMode", "status", "startedAt", "completedAt", "parsedRowCount", "acceptedRowCount", "flaggedRowCount", "quarantinedRowCount", "createdAt")
        VALUES ('${id}', '${id}', '${id}', '${id}', '${svId}', 'obj', 'hash', 10, 'INITIAL', 'PENDING', '${ts}', '${ts}', 0, 0, 0, 0, '${ts}')
      `)).rejects.toThrow();
    });

    it('12. Completed count equation sai bị từ chối', async () => {
      const id = getUuid();
      await expect(prisma.$executeRawUnsafe(`
        INSERT INTO "MarketDataImportBatch" ("id", "batchBusinessKey", "creationIdempotencyKey", "creationRequestHash", "sourceVersionId", "sourceObjectKey", "sourceContentHash", "sourceByteSize", "importMode", "status", "startedAt", "completedAt", "parsedRowCount", "acceptedRowCount", "flaggedRowCount", "quarantinedRowCount", "createdAt")
        VALUES ('${id}', '${id}', '${id}', '${id}', '${svId}', 'obj', 'hash', 10, 'INITIAL', 'COMPLETED', '${ts}', '${ts}', 10, 5, 0, 0, '${ts}')
      `)).rejects.toThrow();
    });

    it('13. PENDING -> COMPLETED được phép', async () => {
      const id = getUuid();
      await prisma.$executeRawUnsafe(`
        INSERT INTO "MarketDataImportBatch" ("id", "batchBusinessKey", "creationIdempotencyKey", "creationRequestHash", "sourceVersionId", "sourceObjectKey", "sourceContentHash", "sourceByteSize", "importMode", "status", "startedAt", "parsedRowCount", "acceptedRowCount", "flaggedRowCount", "quarantinedRowCount", "createdAt")
        VALUES ('${id}', '${id}', '${id}', '${id}', '${svId}', 'obj', 'hash', 10, 'INITIAL', 'PENDING', '${ts}', 0, 0, 0, 0, '${ts}')
      `);
      await expect(prisma.$executeRawUnsafe(`
        UPDATE "MarketDataImportBatch" SET "status" = 'COMPLETED', "completedAt" = '${ts}', "parsedRowCount" = 10, "acceptedRowCount" = 10 WHERE "id" = '${id}'
      `)).resolves.not.toThrow();
    });

    it('14. PENDING -> COMPLETED_WITH_QUARANTINE được phép', async () => {
      const id = getUuid();
      await prisma.$executeRawUnsafe(`
        INSERT INTO "MarketDataImportBatch" ("id", "batchBusinessKey", "creationIdempotencyKey", "creationRequestHash", "sourceVersionId", "sourceObjectKey", "sourceContentHash", "sourceByteSize", "importMode", "status", "startedAt", "parsedRowCount", "acceptedRowCount", "flaggedRowCount", "quarantinedRowCount", "createdAt")
        VALUES ('${id}', '${id}', '${id}', '${id}', '${svId}', 'obj', 'hash', 10, 'INITIAL', 'PENDING', '${ts}', 0, 0, 0, 0, '${ts}')
      `);
      await expect(prisma.$executeRawUnsafe(`
        UPDATE "MarketDataImportBatch" SET "status" = 'COMPLETED_WITH_QUARANTINE', "completedAt" = '${ts}', "parsedRowCount" = 10, "acceptedRowCount" = 5, "quarantinedRowCount" = 5 WHERE "id" = '${id}'
      `)).resolves.not.toThrow();
    });

    it('15. PENDING -> FAILED được phép', async () => {
      const id = getUuid();
      await prisma.$executeRawUnsafe(`
        INSERT INTO "MarketDataImportBatch" ("id", "batchBusinessKey", "creationIdempotencyKey", "creationRequestHash", "sourceVersionId", "sourceObjectKey", "sourceContentHash", "sourceByteSize", "importMode", "status", "startedAt", "parsedRowCount", "acceptedRowCount", "flaggedRowCount", "quarantinedRowCount", "createdAt")
        VALUES ('${id}', '${id}', '${id}', '${id}', '${svId}', 'obj', 'hash', 10, 'INITIAL', 'PENDING', '${ts}', 0, 0, 0, 0, '${ts}')
      `);
      await expect(prisma.$executeRawUnsafe(`
        UPDATE "MarketDataImportBatch" SET "status" = 'FAILED', "failedAt" = '${ts}', "failureCode" = 'ERROR' WHERE "id" = '${id}'
      `)).resolves.not.toThrow();
    });

    it('16. Terminal update bị từ chối', async () => {
      const id = getUuid();
      await prisma.$executeRawUnsafe(`
        INSERT INTO "MarketDataImportBatch" ("id", "batchBusinessKey", "creationIdempotencyKey", "creationRequestHash", "sourceVersionId", "sourceObjectKey", "sourceContentHash", "sourceByteSize", "importMode", "status", "startedAt", "completedAt", "parsedRowCount", "acceptedRowCount", "flaggedRowCount", "quarantinedRowCount", "createdAt")
        VALUES ('${id}', '${id}', '${id}', '${id}', '${svId}', 'obj', 'hash', 10, 'INITIAL', 'COMPLETED', '${ts}', '${ts}', 0, 0, 0, 0, '${ts}')
      `);
      await expect(prisma.$executeRawUnsafe(`
        UPDATE "MarketDataImportBatch" SET "status" = 'FAILED' WHERE "id" = '${id}'
      `)).rejects.toThrow();
    });

    it('17. Provenance mutation cùng terminal transition bị từ chối', async () => {
      const id = getUuid();
      await prisma.$executeRawUnsafe(`
        INSERT INTO "MarketDataImportBatch" ("id", "batchBusinessKey", "creationIdempotencyKey", "creationRequestHash", "sourceVersionId", "sourceObjectKey", "sourceContentHash", "sourceByteSize", "importMode", "status", "startedAt", "parsedRowCount", "acceptedRowCount", "flaggedRowCount", "quarantinedRowCount", "createdAt")
        VALUES ('${id}', '${id}', '${id}', '${id}', '${svId}', 'obj', 'hash', 10, 'INITIAL', 'PENDING', '${ts}', 0, 0, 0, 0, '${ts}')
      `);
      await expect(prisma.$executeRawUnsafe(`
        UPDATE "MarketDataImportBatch" SET "status" = 'COMPLETED', "completedAt" = '${ts}', "batchBusinessKey" = 'mutated' WHERE "id" = '${id}'
      `)).rejects.toThrow();
    });
  });

  describe('Daily bar', () => {
    let svId: string;
    let bId: string;
    let iId: string;
    beforeAll(async () => {
      svId = getUuid();
      bId = getUuid();
      iId = getUuid();
      await prisma.$executeRawUnsafe(`
        INSERT INTO "MarketDataSourceVersion" ("id", "sourceKey", "contractHash", "providerCode", "datasetKind", "adapterKind", "adapterVersion", "schemaVersion", "canonicalizationVersion", "priceUnit", "encoding", "createdAt", "sealedAt")
        VALUES ('${svId}', '${svId}', '${getHash()}', 'P', 'EOD_MARKET_DATA', 'REPOSITORY_CSV_FIXTURE', '1', '1', '1', 'VND_PER_SHARE', 'UTF8', '${ts}', '${ts}')
      `);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "MarketDataImportBatch" ("id", "batchBusinessKey", "creationIdempotencyKey", "creationRequestHash", "sourceVersionId", "sourceObjectKey", "sourceContentHash", "sourceByteSize", "importMode", "status", "startedAt", "parsedRowCount", "acceptedRowCount", "flaggedRowCount", "quarantinedRowCount", "createdAt")
        VALUES ('${bId}', '${bId}', '${bId}', '${bId}', '${svId}', 'obj', 'hash', 10, 'INITIAL', 'PENDING', '${ts}', 0, 0, 0, 0, '${ts}')
      `);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "MarketInstrument" ("id", "businessKey", "exchange", "canonicalSymbol", "securityType", "currency", "effectiveFrom", "createdAt", "sealedAt")
        VALUES ('${iId}', '${iId}', 'HOSE', 'AAA', 'EQUITY', 'VND', '2024-01-01', '${ts}', '${ts}')
      `);
    });

    const insertBar = async (id: string, overrides: string, dt = '2024-01-01') => {
      const query = `
        INSERT INTO "DailyMarketBar" ("id", "sourceVersionId", "importBatchId", "sourceRecordKey", "instrumentId", "marketDate", "barKind", "open", "high", "low", "close", "volume", "tradingValue", "correctionVersion", "supersedesBarId", "qualityDecision", "qualityFlags", "sourceRowHash", "canonicalHash", "recordedAt")
        VALUES ('${id}', '${svId}', '${bId}', '${id}', '${iId}', '${dt}', ${overrides}, '${getHash()}', '${getHash()}', '${ts}')
      `;
      return prisma.$executeRawUnsafe(query);
    };

    it('18. Accepted TRADED hợp lệ được phép', async () => {
      await expect(insertBar(getUuid(), `'TRADED', 10, 20, 5, 15, 100, 1500, 0, NULL, 'ACCEPTED', '[]'`)).resolves.not.toThrow();
    });

    it('19. Accepted TRADED thiếu OHLC bị từ chối', async () => {
      await expect(insertBar(getUuid(), `'TRADED', NULL, 20, 5, 15, 100, 1500, 0, NULL, 'ACCEPTED', '[]'`)).rejects.toThrow();
    });

    it('20. Accepted no-trade có giá bị từ chối', async () => {
      await expect(insertBar(getUuid(), `'NO_TRADE', 10, 20, 5, 15, 0, 0, 0, NULL, 'ACCEPTED', '[]'`)).rejects.toThrow();
    });

    it('21. Accepted suspended có volume khác 0 bị từ chối', async () => {
      await expect(insertBar(getUuid(), `'SUSPENDED', NULL, NULL, NULL, NULL, 100, 0, 0, NULL, 'ACCEPTED', '[]'`)).rejects.toThrow();
    });

    it('22. Parseable QUARANTINED negative values được phép', async () => {
      await expect(insertBar(getUuid(), `'TRADED', -10, 20, 5, 15, 100, 1500, 0, NULL, 'QUARANTINED', '[]'`, '2024-01-02')).resolves.not.toThrow();
    });

    it('23. Version 0 có supersedes bị từ chối', async () => {
      await expect(insertBar(getUuid(), `'TRADED', 10, 20, 5, 15, 100, 1500, 0, '${getUuid()}', 'ACCEPTED', '[]'`)).rejects.toThrow();
    });

    it('24. Version >0 thiếu supersedes bị từ chối', async () => {
      await expect(insertBar(getUuid(), `'TRADED', 10, 20, 5, 15, 100, 1500, 1, NULL, 'ACCEPTED', '[]'`)).rejects.toThrow();
    });

    it('25. UPDATE bar bị từ chối', async () => {
      const id = getUuid();
      await insertBar(id, `'TRADED', 10, 20, 5, 15, 100, 1500, 0, NULL, 'ACCEPTED', '[]'`, '2024-01-03');
      await expect(prisma.$executeRawUnsafe(`UPDATE "DailyMarketBar" SET volume = 200 WHERE "id" = '${id}'`)).rejects.toThrow();
    });

    it('26. DELETE bar bị từ chối', async () => {
      const id = getUuid();
      await insertBar(id, `'TRADED', 10, 20, 5, 15, 100, 1500, 0, NULL, 'ACCEPTED', '[]'`, '2024-01-04');
      await expect(prisma.$executeRawUnsafe(`DELETE FROM "DailyMarketBar" WHERE "id" = '${id}'`)).rejects.toThrow();
    });
  });

  describe('Snapshot and entries', () => {
    let svId: string;
    let bId: string;
    let iId: string;
    let barId: string;

    beforeAll(async () => {
      svId = getUuid();
      bId = getUuid();
      iId = getUuid();
      barId = getUuid();

      await prisma.$executeRawUnsafe(`
        INSERT INTO "MarketDataSourceVersion" ("id", "sourceKey", "contractHash", "providerCode", "datasetKind", "adapterKind", "adapterVersion", "schemaVersion", "canonicalizationVersion", "priceUnit", "encoding", "createdAt", "sealedAt")
        VALUES ('${svId}', '${svId}', '${getHash()}', 'P', 'EOD_MARKET_DATA', 'REPOSITORY_CSV_FIXTURE', '1', '1', '1', 'VND_PER_SHARE', 'UTF8', '${ts}', '${ts}')
      `);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "MarketDataImportBatch" ("id", "batchBusinessKey", "creationIdempotencyKey", "creationRequestHash", "sourceVersionId", "sourceObjectKey", "sourceContentHash", "sourceByteSize", "importMode", "status", "startedAt", "parsedRowCount", "acceptedRowCount", "flaggedRowCount", "quarantinedRowCount", "createdAt")
        VALUES ('${bId}', '${bId}', '${bId}', '${bId}', '${svId}', 'obj', 'hash', 10, 'INITIAL', 'PENDING', '${ts}', 0, 0, 0, 0, '${ts}')
      `);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "MarketInstrument" ("id", "businessKey", "exchange", "canonicalSymbol", "securityType", "currency", "effectiveFrom", "createdAt", "sealedAt")
        VALUES ('${iId}', '${iId}', 'HOSE', 'AAA', 'EQUITY', 'VND', '2024-01-01', '${ts}', '${ts}')
      `);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "DailyMarketBar" ("id", "sourceVersionId", "importBatchId", "sourceRecordKey", "instrumentId", "marketDate", "barKind", "open", "high", "low", "close", "volume", "tradingValue", "correctionVersion", "qualityDecision", "qualityFlags", "sourceRowHash", "canonicalHash", "recordedAt")
        VALUES ('${barId}', '${svId}', '${bId}', '${barId}', '${iId}', '2024-01-01', 'TRADED', 10, 20, 5, 15, 100, 1500, 0, 'ACCEPTED', '[]', '${getHash()}', '${getHash()}', '${ts}')
      `);
    });

    const insertSnap = async (id: string, overrides: string) => {
      const query = `
        INSERT INTO "DatasetSnapshot" ("id", "businessKey", "sourceVersionId", "rangeStart", "rangeEnd", "universeDefinitionJson", "universeHash", "dataCutoffKey", "dataCutoffAt", "canonicalizationVersion", "creationIdempotencyKey", "creationRequestHash", "status", "sealedAt", "rowCount", "manifestHash", "contentHash", "createdAt")
        VALUES ('${id}', '${id}', '${svId}', ${overrides}, '1', '${id}', '${id}', 'DRAFT', NULL, 0, '${getHash()}', '${getHash()}', '${ts}')
      `;
      return prisma.$executeRawUnsafe(query);
    };

    it('27. Invalid range bị từ chối', async () => {
      await expect(insertSnap(getUuid(), `'2024-01-02', '2024-01-01', '{}', 'h', 'c', '${ts}'`)).rejects.toThrow();
    });

    it('28. Negative rowCount bị từ chối', async () => {
      await expect(prisma.$executeRawUnsafe(`
        INSERT INTO "DatasetSnapshot" ("id", "businessKey", "sourceVersionId", "rangeStart", "rangeEnd", "universeDefinitionJson", "universeHash", "dataCutoffKey", "dataCutoffAt", "canonicalizationVersion", "creationIdempotencyKey", "creationRequestHash", "status", "sealedAt", "rowCount", "manifestHash", "contentHash", "createdAt")
        VALUES ('${getUuid()}', '${getUuid()}', '${svId}', '2024-01-01', '2024-01-02', '{}', 'h', 'c', '${ts}', '1', '${getUuid()}', '${getUuid()}', 'DRAFT', NULL, -1, 'h1', 'h2', '${ts}')
      `)).rejects.toThrow();
    });

    it('29. DRAFT có sealedAt bị từ chối', async () => {
      await expect(prisma.$executeRawUnsafe(`
        INSERT INTO "DatasetSnapshot" ("id", "businessKey", "sourceVersionId", "rangeStart", "rangeEnd", "universeDefinitionJson", "universeHash", "dataCutoffKey", "dataCutoffAt", "canonicalizationVersion", "creationIdempotencyKey", "creationRequestHash", "status", "sealedAt", "rowCount", "manifestHash", "contentHash", "createdAt")
        VALUES ('${getUuid()}', '${getUuid()}', '${svId}', '2024-01-01', '2024-01-02', '{}', 'h', 'c', '${ts}', '1', '${getUuid()}', '${getUuid()}', 'DRAFT', '${ts}', 0, 'h1', 'h2', '${ts}')
      `)).rejects.toThrow();
    });

    it('30. SEALED thiếu sealedAt bị từ chối', async () => {
      await expect(prisma.$executeRawUnsafe(`
        INSERT INTO "DatasetSnapshot" ("id", "businessKey", "sourceVersionId", "rangeStart", "rangeEnd", "universeDefinitionJson", "universeHash", "dataCutoffKey", "dataCutoffAt", "canonicalizationVersion", "creationIdempotencyKey", "creationRequestHash", "status", "sealedAt", "rowCount", "manifestHash", "contentHash", "createdAt")
        VALUES ('${getUuid()}', '${getUuid()}', '${svId}', '2024-01-01', '2024-01-02', '{}', 'h', 'c', '${ts}', '1', '${getUuid()}', '${getUuid()}', 'SEALED', NULL, 0, 'h1', 'h2', '${ts}')
      `)).rejects.toThrow();
    });

    it('31. DRAFT -> DRAFT update bị từ chối', async () => {
      const id = getUuid();
      await insertSnap(id, `'2024-01-01', '2024-01-02', '{}', 'h', 'c', '${ts}'`);
      await expect(prisma.$executeRawUnsafe(`UPDATE "DatasetSnapshot" SET "rowCount" = 1 WHERE "id" = '${id}'`)).rejects.toThrow();
    });

    it('32. DRAFT -> SEALED hợp lệ được phép', async () => {
      const id = getUuid();
      await insertSnap(id, `'2024-01-01', '2024-01-02', '{}', 'h', 'c', '${ts}'`);
      await expect(prisma.$executeRawUnsafe(`UPDATE "DatasetSnapshot" SET "status" = 'SEALED', "sealedAt" = '${ts}', "rowCount" = 1 WHERE "id" = '${id}'`)).resolves.not.toThrow();
    });

    it('33. SEALED update bị từ chối', async () => {
      const id = getUuid();
      await insertSnap(id, `'2024-01-01', '2024-01-02', '{}', 'h', 'c', '${ts}'`);
      await prisma.$executeRawUnsafe(`UPDATE "DatasetSnapshot" SET "status" = 'SEALED', "sealedAt" = '${ts}', "rowCount" = 1 WHERE "id" = '${id}'`);
      await expect(prisma.$executeRawUnsafe(`UPDATE "DatasetSnapshot" SET "rowCount" = 2 WHERE "id" = '${id}'`)).rejects.toThrow();
    });

    it('34. Snapshot DELETE bị từ chối', async () => {
      const id = getUuid();
      await insertSnap(id, `'2024-01-01', '2024-01-02', '{}', 'h', 'c', '${ts}'`);
      await expect(prisma.$executeRawUnsafe(`DELETE FROM "DatasetSnapshot" WHERE "id" = '${id}'`)).rejects.toThrow();
    });

    it('35. Entry sequence 0 bị từ chối', async () => {
      const sId = getUuid();
      await insertSnap(sId, `'2024-01-01', '2024-01-02', '{}', 'h', 'c', '${ts}'`);
      await expect(prisma.$executeRawUnsafe(`
        INSERT INTO "DatasetSnapshotEntry" ("id", "snapshotId", "dailyBarId", "entrySequence", "instrumentBusinessKey", "marketDate", "barCanonicalHash", "entryHash")
        VALUES ('${getUuid()}', '${sId}', '${barId}', 0, '${iId}', '2024-01-01', '${getHash()}', '${getHash()}')
      `)).rejects.toThrow();
    });

    it('36. Entry INSERT vào SEALED snapshot bị từ chối', async () => {
      const sId = getUuid();
      await insertSnap(sId, `'2024-01-01', '2024-01-02', '{}', 'h', 'c', '${ts}'`);
      await prisma.$executeRawUnsafe(`UPDATE "DatasetSnapshot" SET "status" = 'SEALED', "sealedAt" = '${ts}', "rowCount" = 0 WHERE "id" = '${sId}'`);
      await expect(prisma.$executeRawUnsafe(`
        INSERT INTO "DatasetSnapshotEntry" ("id", "snapshotId", "dailyBarId", "entrySequence", "instrumentBusinessKey", "marketDate", "barCanonicalHash", "entryHash")
        VALUES ('${getUuid()}', '${sId}', '${barId}', 1, '${iId}', '2024-01-01', '${getHash()}', '${getHash()}')
      `)).rejects.toThrow();
    });

    it('37. Entry UPDATE bị từ chối', async () => {
      const sId = getUuid();
      await insertSnap(sId, `'2024-01-01', '2024-01-02', '{}', 'h', 'c', '${ts}'`);
      const eId = getUuid();
      await prisma.$executeRawUnsafe(`
        INSERT INTO "DatasetSnapshotEntry" ("id", "snapshotId", "dailyBarId", "entrySequence", "instrumentBusinessKey", "marketDate", "barCanonicalHash", "entryHash")
        VALUES ('${eId}', '${sId}', '${barId}', 1, '${iId}', '2024-01-01', '${getHash()}', '${getHash()}')
      `);
      await expect(prisma.$executeRawUnsafe(`UPDATE "DatasetSnapshotEntry" SET "marketDate" = '2024-01-02' WHERE "id" = '${eId}'`)).rejects.toThrow();
    });

    it('38. Entry DELETE bị từ chối', async () => {
      const sId = getUuid();
      await insertSnap(sId, `'2024-01-01', '2024-01-02', '{}', 'h', 'c', '${ts}'`);
      const eId = getUuid();
      await prisma.$executeRawUnsafe(`
        INSERT INTO "DatasetSnapshotEntry" ("id", "snapshotId", "dailyBarId", "entrySequence", "instrumentBusinessKey", "marketDate", "barCanonicalHash", "entryHash")
        VALUES ('${eId}', '${sId}', '${barId}', 1, '${iId}', '2024-01-01', '${getHash()}', '${getHash()}')
      `);
      await expect(prisma.$executeRawUnsafe(`DELETE FROM "DatasetSnapshotEntry" WHERE "id" = '${eId}'`)).rejects.toThrow();
    });
  });
});
