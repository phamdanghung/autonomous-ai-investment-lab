-- CreateEnum
CREATE TYPE "MarketExchange" AS ENUM ('HOSE', 'HNX', 'UPCOM');

-- CreateEnum
CREATE TYPE "SecurityType" AS ENUM ('EQUITY');

-- CreateEnum
CREATE TYPE "CurrencyCode" AS ENUM ('VND');

-- CreateEnum
CREATE TYPE "MarketDayType" AS ENUM ('TRADING', 'CLOSED', 'SPECIAL');

-- CreateEnum
CREATE TYPE "MarketDatasetKind" AS ENUM ('EOD_MARKET_DATA');

-- CreateEnum
CREATE TYPE "MarketAdapterKind" AS ENUM ('REPOSITORY_CSV_FIXTURE');

-- CreateEnum
CREATE TYPE "MarketPriceUnit" AS ENUM ('VND_PER_SHARE');

-- CreateEnum
CREATE TYPE "SourceEncoding" AS ENUM ('UTF8');

-- CreateEnum
CREATE TYPE "MarketImportMode" AS ENUM ('INITIAL', 'CORRECTION');

-- CreateEnum
CREATE TYPE "MarketImportStatus" AS ENUM ('PENDING', 'COMPLETED', 'COMPLETED_WITH_QUARANTINE', 'FAILED');

-- CreateEnum
CREATE TYPE "MarketBarKind" AS ENUM ('TRADED', 'NO_TRADE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "MarketQualityDecision" AS ENUM ('ACCEPTED', 'ACCEPTED_WITH_FLAGS', 'QUARANTINED');

-- CreateEnum
CREATE TYPE "DatasetSnapshotStatus" AS ENUM ('DRAFT', 'SEALED');

-- CreateTable
CREATE TABLE "MarketInstrument" (
    "id" TEXT NOT NULL,
    "businessKey" TEXT NOT NULL,
    "exchange" "MarketExchange" NOT NULL,
    "canonicalSymbol" TEXT NOT NULL,
    "securityType" "SecurityType" NOT NULL,
    "currency" "CurrencyCode" NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sealedAt" TIMESTAMP(3) NOT NULL NOT NULL NOT NULL NOT NULL,

    CONSTRAINT "MarketInstrument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradingCalendarDay" (
    "id" TEXT NOT NULL,
    "sourceVersionId" TEXT NOT NULL,
    "exchange" "MarketExchange" NOT NULL,
    "marketDate" DATE NOT NULL,
    "dayType" "MarketDayType" NOT NULL,
    "reason" TEXT,
    "canonicalHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradingCalendarDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketDataSourceVersion" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "providerCode" TEXT NOT NULL,
    "datasetKind" "MarketDatasetKind" NOT NULL,
    "adapterKind" "MarketAdapterKind" NOT NULL,
    "adapterVersion" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "canonicalizationVersion" TEXT NOT NULL,
    "priceUnit" "MarketPriceUnit" NOT NULL,
    "encoding" "SourceEncoding" NOT NULL,
    "contractHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sealedAt" TIMESTAMP(3),

    CONSTRAINT "MarketDataSourceVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketDataImportBatch" (
    "id" TEXT NOT NULL,
    "batchBusinessKey" TEXT NOT NULL,
    "creationIdempotencyKey" TEXT NOT NULL,
    "creationRequestHash" TEXT NOT NULL,
    "sourceVersionId" TEXT NOT NULL,
    "sourceObjectKey" TEXT NOT NULL,
    "sourceContentHash" TEXT NOT NULL,
    "sourceByteSize" BIGINT NOT NULL,
    "declaredRowCount" INTEGER,
    "parsedRowCount" INTEGER NOT NULL DEFAULT 0,
    "acceptedRowCount" INTEGER NOT NULL DEFAULT 0,
    "flaggedRowCount" INTEGER NOT NULL DEFAULT 0,
    "quarantinedRowCount" INTEGER NOT NULL DEFAULT 0,
    "importMode" "MarketImportMode" NOT NULL,
    "status" "MarketImportStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketDataImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyMarketBar" (
    "id" TEXT NOT NULL,
    "sourceVersionId" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "sourceRecordKey" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "marketDate" DATE NOT NULL,
    "barKind" "MarketBarKind" NOT NULL,
    "open" BIGINT,
    "high" BIGINT,
    "low" BIGINT,
    "close" BIGINT,
    "volume" BIGINT NOT NULL,
    "tradingValue" BIGINT,
    "correctionVersion" INTEGER NOT NULL,
    "supersedesBarId" TEXT,
    "qualityDecision" "MarketQualityDecision" NOT NULL,
    "qualityFlags" TEXT NOT NULL,
    "sourceRowHash" TEXT NOT NULL,
    "canonicalHash" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyMarketBar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DatasetSnapshot" (
    "id" TEXT NOT NULL,
    "businessKey" TEXT NOT NULL,
    "sourceVersionId" TEXT NOT NULL,
    "rangeStart" DATE NOT NULL,
    "rangeEnd" DATE NOT NULL,
    "universeDefinitionJson" TEXT NOT NULL,
    "universeHash" TEXT NOT NULL,
    "dataCutoffKey" TEXT NOT NULL,
    "dataCutoffAt" TIMESTAMP(3),
    "canonicalizationVersion" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "manifestHash" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "status" "DatasetSnapshotStatus" NOT NULL,
    "creationIdempotencyKey" TEXT NOT NULL,
    "creationRequestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sealedAt" TIMESTAMP(3),

    CONSTRAINT "DatasetSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DatasetSnapshotEntry" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "dailyBarId" TEXT NOT NULL,
    "entrySequence" INTEGER NOT NULL,
    "instrumentBusinessKey" TEXT NOT NULL,
    "marketDate" DATE NOT NULL,
    "barCanonicalHash" TEXT NOT NULL,
    "entryHash" TEXT NOT NULL,

    CONSTRAINT "DatasetSnapshotEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketInstrument_businessKey_key" ON "MarketInstrument"("businessKey");

-- CreateIndex
CREATE INDEX "MarketInstrument_exchange_canonicalSymbol_securityType_effe_idx" ON "MarketInstrument"("exchange", "canonicalSymbol", "securityType", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "TradingCalendarDay_canonicalHash_key" ON "TradingCalendarDay"("canonicalHash");

-- CreateIndex
CREATE INDEX "TradingCalendarDay_exchange_marketDate_idx" ON "TradingCalendarDay"("exchange", "marketDate");

-- CreateIndex
CREATE UNIQUE INDEX "TradingCalendarDay_sourceVersionId_exchange_marketDate_key" ON "TradingCalendarDay"("sourceVersionId", "exchange", "marketDate");

-- CreateIndex
CREATE UNIQUE INDEX "MarketDataSourceVersion_sourceKey_key" ON "MarketDataSourceVersion"("sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "MarketDataSourceVersion_contractHash_key" ON "MarketDataSourceVersion"("contractHash");

-- CreateIndex
CREATE UNIQUE INDEX "MarketDataImportBatch_batchBusinessKey_key" ON "MarketDataImportBatch"("batchBusinessKey");

-- CreateIndex
CREATE UNIQUE INDEX "MarketDataImportBatch_creationIdempotencyKey_key" ON "MarketDataImportBatch"("creationIdempotencyKey");

-- CreateIndex
CREATE INDEX "MarketDataImportBatch_sourceVersionId_status_createdAt_idx" ON "MarketDataImportBatch"("sourceVersionId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DailyMarketBar_supersedesBarId_key" ON "DailyMarketBar"("supersedesBarId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyMarketBar_canonicalHash_key" ON "DailyMarketBar"("canonicalHash");

-- CreateIndex
CREATE INDEX "DailyMarketBar_instrumentId_marketDate_idx" ON "DailyMarketBar"("instrumentId", "marketDate");

-- CreateIndex
CREATE INDEX "DailyMarketBar_importBatchId_idx" ON "DailyMarketBar"("importBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyMarketBar_sourceVersionId_instrumentId_marketDate_corr_key" ON "DailyMarketBar"("sourceVersionId", "instrumentId", "marketDate", "correctionVersion");

-- CreateIndex
CREATE UNIQUE INDEX "DailyMarketBar_sourceVersionId_sourceRecordKey_correctionVe_key" ON "DailyMarketBar"("sourceVersionId", "sourceRecordKey", "correctionVersion");

-- CreateIndex
CREATE UNIQUE INDEX "DatasetSnapshot_businessKey_key" ON "DatasetSnapshot"("businessKey");

-- CreateIndex
CREATE UNIQUE INDEX "DatasetSnapshot_creationIdempotencyKey_key" ON "DatasetSnapshot"("creationIdempotencyKey");

-- CreateIndex
CREATE INDEX "DatasetSnapshot_manifestHash_idx" ON "DatasetSnapshot"("manifestHash");

-- CreateIndex
CREATE INDEX "DatasetSnapshot_contentHash_idx" ON "DatasetSnapshot"("contentHash");

-- CreateIndex
CREATE INDEX "DatasetSnapshot_status_rangeStart_rangeEnd_idx" ON "DatasetSnapshot"("status", "rangeStart", "rangeEnd");

-- CreateIndex
CREATE UNIQUE INDEX "DatasetSnapshotEntry_snapshotId_entrySequence_key" ON "DatasetSnapshotEntry"("snapshotId", "entrySequence");

-- CreateIndex
CREATE UNIQUE INDEX "DatasetSnapshotEntry_snapshotId_dailyBarId_key" ON "DatasetSnapshotEntry"("snapshotId", "dailyBarId");

-- CreateIndex
CREATE UNIQUE INDEX "DatasetSnapshotEntry_snapshotId_instrumentBusinessKey_marke_key" ON "DatasetSnapshotEntry"("snapshotId", "instrumentBusinessKey", "marketDate");

-- CreateIndex
CREATE UNIQUE INDEX "DatasetSnapshotEntry_snapshotId_entryHash_key" ON "DatasetSnapshotEntry"("snapshotId", "entryHash");

-- AddForeignKey
ALTER TABLE "TradingCalendarDay" ADD CONSTRAINT "TradingCalendarDay_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "MarketDataSourceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketDataImportBatch" ADD CONSTRAINT "MarketDataImportBatch_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "MarketDataSourceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyMarketBar" ADD CONSTRAINT "DailyMarketBar_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "MarketDataSourceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyMarketBar" ADD CONSTRAINT "DailyMarketBar_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "MarketDataImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyMarketBar" ADD CONSTRAINT "DailyMarketBar_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "MarketInstrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyMarketBar" ADD CONSTRAINT "DailyMarketBar_supersedesBarId_fkey" FOREIGN KEY ("supersedesBarId") REFERENCES "DailyMarketBar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatasetSnapshot" ADD CONSTRAINT "DatasetSnapshot_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "MarketDataSourceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatasetSnapshotEntry" ADD CONSTRAINT "DatasetSnapshotEntry_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "DatasetSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatasetSnapshotEntry" ADD CONSTRAINT "DatasetSnapshotEntry_dailyBarId_fkey" FOREIGN KEY ("dailyBarId") REFERENCES "DailyMarketBar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;




-- Phase 1B Custom PostgreSQL Triggers & Constraints

-- CHECK CONSTRAINTS

-- MarketInstrument
ALTER TABLE "MarketInstrument" ADD CONSTRAINT "MarketInstrument_effectiveTo_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");

-- MarketDataImportBatch
ALTER TABLE "MarketDataImportBatch" ADD CONSTRAINT "MarketDataImportBatch_sourceByteSize_check" CHECK ("sourceByteSize" >= 0);
ALTER TABLE "MarketDataImportBatch" ADD CONSTRAINT "MarketDataImportBatch_declaredRowCount_check" CHECK ("declaredRowCount" IS NULL OR "declaredRowCount" >= 0);
ALTER TABLE "MarketDataImportBatch" ADD CONSTRAINT "MarketDataImportBatch_parsedRowCount_check" CHECK ("parsedRowCount" >= 0);
ALTER TABLE "MarketDataImportBatch" ADD CONSTRAINT "MarketDataImportBatch_acceptedRowCount_check" CHECK ("acceptedRowCount" >= 0);
ALTER TABLE "MarketDataImportBatch" ADD CONSTRAINT "MarketDataImportBatch_flaggedRowCount_check" CHECK ("flaggedRowCount" >= 0);
ALTER TABLE "MarketDataImportBatch" ADD CONSTRAINT "MarketDataImportBatch_quarantinedRowCount_check" CHECK ("quarantinedRowCount" >= 0);
ALTER TABLE "MarketDataImportBatch" ADD CONSTRAINT "MarketDataImportBatch_status_timestamps_check" CHECK (
  ("status" = 'PENDING' AND "startedAt" IS NOT NULL AND "completedAt" IS NULL AND "failedAt" IS NULL AND "failureCode" IS NULL) OR
  ("status" IN ('COMPLETED', 'COMPLETED_WITH_QUARANTINE') AND "startedAt" IS NOT NULL AND "completedAt" IS NOT NULL AND "failedAt" IS NULL AND "failureCode" IS NULL AND "parsedRowCount" = "acceptedRowCount" + "flaggedRowCount" + "quarantinedRowCount") OR
  ("status" = 'FAILED' AND "startedAt" IS NOT NULL AND "completedAt" IS NULL AND "failedAt" IS NOT NULL AND "failureCode" IS NOT NULL)
);

-- DailyMarketBar
ALTER TABLE "DailyMarketBar" ADD CONSTRAINT "DailyMarketBar_correctionVersion_check" CHECK ("correctionVersion" >= 0);
ALTER TABLE "DailyMarketBar" ADD CONSTRAINT "DailyMarketBar_supersedesBarId_check" CHECK (
  ("correctionVersion" = 0 AND "supersedesBarId" IS NULL) OR
  ("correctionVersion" > 0 AND "supersedesBarId" IS NOT NULL)
);
ALTER TABLE "DailyMarketBar" ADD CONSTRAINT "DailyMarketBar_quality_check" CHECK (
  ("qualityDecision" = 'QUARANTINED') OR
  (
    "qualityDecision" IN ('ACCEPTED', 'ACCEPTED_WITH_FLAGS') AND
    "barKind" = 'TRADED' AND
    "open" IS NOT NULL AND "high" IS NOT NULL AND "low" IS NOT NULL AND "close" IS NOT NULL AND
    "open" >= 0 AND "high" >= 0 AND "low" >= 0 AND "close" >= 0 AND
    "high" >= "low" AND "open" BETWEEN "low" AND "high" AND "close" BETWEEN "low" AND "high" AND
    "volume" >= 0 AND
    ("tradingValue" IS NULL OR "tradingValue" >= 0)
  ) OR
  (
    "qualityDecision" IN ('ACCEPTED', 'ACCEPTED_WITH_FLAGS') AND
    "barKind" IN ('NO_TRADE', 'SUSPENDED') AND
    "open" IS NULL AND "high" IS NULL AND "low" IS NULL AND "close" IS NULL AND
    "volume" = 0 AND
    ("tradingValue" IS NULL OR "tradingValue" = 0)
  )
);

-- DatasetSnapshot
ALTER TABLE "DatasetSnapshot" ADD CONSTRAINT "DatasetSnapshot_range_check" CHECK ("rangeEnd" >= "rangeStart");
ALTER TABLE "DatasetSnapshot" ADD CONSTRAINT "DatasetSnapshot_rowCount_check" CHECK ("rowCount" >= 0);
ALTER TABLE "DatasetSnapshot" ADD CONSTRAINT "DatasetSnapshot_status_sealedAt_check" CHECK (
  ("status" = 'DRAFT' AND "sealedAt" IS NULL) OR
  ("status" = 'SEALED' AND "sealedAt" IS NOT NULL)
);

-- DatasetSnapshotEntry
ALTER TABLE "DatasetSnapshotEntry" ADD CONSTRAINT "DatasetSnapshotEntry_entrySequence_check" CHECK ("entrySequence" > 0);


-- TRIGGERS

-- 1. MarketInstrument
CREATE OR REPLACE FUNCTION block_market_instrument_mutation()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'MarketInstrument is immutable and cannot be deleted.';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF OLD."effectiveTo" IS NOT NULL THEN
            RAISE EXCEPTION 'MarketInstrument effectiveTo cannot be changed once set.';
        END IF;
        IF NEW."id" <> OLD."id" OR
           NEW."businessKey" <> OLD."businessKey" OR
           NEW."exchange" <> OLD."exchange" OR
           NEW."canonicalSymbol" <> OLD."canonicalSymbol" OR
           NEW."securityType" <> OLD."securityType" OR
           NEW."currency" <> OLD."currency" OR
           NEW."effectiveFrom" <> OLD."effectiveFrom" OR
           NEW."createdAt" <> OLD."createdAt" OR
           NEW."sealedAt" <> OLD."sealedAt" THEN
            RAISE EXCEPTION 'MarketInstrument core fields are immutable.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_market_instrument_mutation
BEFORE UPDATE OR DELETE ON "MarketInstrument"
FOR EACH ROW EXECUTE FUNCTION block_market_instrument_mutation();

-- 2. TradingCalendarDay
CREATE OR REPLACE FUNCTION block_trading_calendar_day_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'TradingCalendarDay is immutable after insert. No UPDATE or DELETE allowed.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_trading_calendar_day_mutation
BEFORE UPDATE OR DELETE ON "TradingCalendarDay"
FOR EACH ROW EXECUTE FUNCTION block_trading_calendar_day_mutation();

-- 3. MarketDataSourceVersion
CREATE OR REPLACE FUNCTION block_market_data_source_version_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'MarketDataSourceVersion is immutable. No UPDATE or DELETE allowed.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_market_data_source_version_mutation
BEFORE UPDATE OR DELETE ON "MarketDataSourceVersion"
FOR EACH ROW EXECUTE FUNCTION block_market_data_source_version_mutation();

-- 4. MarketDataImportBatch
CREATE OR REPLACE FUNCTION block_import_batch_status_transition()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD."status" IN ('COMPLETED', 'COMPLETED_WITH_QUARANTINE', 'FAILED') THEN
            RAISE EXCEPTION 'Terminal MarketDataImportBatch cannot be deleted.';
        END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        -- Immutable provenance comparison phải chạy trước status logic.
        IF NEW."id" <> OLD."id" OR
           NEW."batchBusinessKey" <> OLD."batchBusinessKey" OR
           NEW."creationIdempotencyKey" <> OLD."creationIdempotencyKey" OR
           NEW."creationRequestHash" <> OLD."creationRequestHash" OR
           NEW."sourceVersionId" <> OLD."sourceVersionId" OR
           NEW."sourceObjectKey" <> OLD."sourceObjectKey" OR
           NEW."sourceContentHash" <> OLD."sourceContentHash" OR
           NEW."sourceByteSize" <> OLD."sourceByteSize" OR
           NEW."importMode" <> OLD."importMode" OR
           NEW."createdAt" <> OLD."createdAt" OR
           NEW."startedAt" <> OLD."startedAt" THEN
            RAISE EXCEPTION 'MarketDataImportBatch identity/provenance fields are immutable.';
        END IF;
        
        -- Allowed transitions
        IF OLD."status" = 'PENDING' AND NEW."status" = 'PENDING' THEN
            RETURN NEW;
        END IF;
        
        IF OLD."status" = 'PENDING' AND NEW."status" IN ('COMPLETED', 'COMPLETED_WITH_QUARANTINE', 'FAILED') THEN
            RETURN NEW;
        END IF;
        
        RAISE EXCEPTION 'Invalid status transition. Terminal state cannot be changed.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_import_batch_status_transition
BEFORE UPDATE OR DELETE ON "MarketDataImportBatch"
FOR EACH ROW EXECUTE FUNCTION block_import_batch_status_transition();

-- 5. DailyMarketBar
CREATE OR REPLACE FUNCTION block_daily_market_bar_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'DailyMarketBar is append-only. No UPDATE or DELETE allowed.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_daily_bar_append_only
BEFORE UPDATE OR DELETE ON "DailyMarketBar"
FOR EACH ROW EXECUTE FUNCTION block_daily_market_bar_mutation();

-- 6. DatasetSnapshot
CREATE OR REPLACE FUNCTION block_dataset_snapshot_mutation()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'DatasetSnapshot cannot be deleted.';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF OLD."status" = 'SEALED' THEN
            RAISE EXCEPTION 'SEALED DatasetSnapshot cannot be modified.';
        END IF;
        
        -- Only DRAFT -> SEALED is allowed for status transition
        IF OLD."status" = 'DRAFT' AND NEW."status" = 'DRAFT' THEN
            RAISE EXCEPTION 'DRAFT -> DRAFT update is not allowed.';
        END IF;
        
        IF OLD."status" = 'DRAFT' AND NEW."status" = 'SEALED' THEN
            IF NEW."id" <> OLD."id" OR
               NEW."businessKey" <> OLD."businessKey" OR
               NEW."sourceVersionId" <> OLD."sourceVersionId" OR
               NEW."rangeStart" <> OLD."rangeStart" OR
               NEW."rangeEnd" <> OLD."rangeEnd" OR
               NEW."universeDefinitionJson" <> OLD."universeDefinitionJson" OR
               NEW."universeHash" <> OLD."universeHash" OR
               NEW."dataCutoffKey" <> OLD."dataCutoffKey" OR
               NEW."dataCutoffAt" IS DISTINCT FROM OLD."dataCutoffAt" OR
               NEW."canonicalizationVersion" <> OLD."canonicalizationVersion" OR
               NEW."creationIdempotencyKey" <> OLD."creationIdempotencyKey" OR
               NEW."creationRequestHash" <> OLD."creationRequestHash" OR
               NEW."createdAt" <> OLD."createdAt" THEN
                RAISE EXCEPTION 'DatasetSnapshot identity/content fields are immutable.';
            END IF;
            
            -- sealedAt: null -> non-null
            IF OLD."sealedAt" IS NOT NULL OR NEW."sealedAt" IS NULL THEN
                RAISE EXCEPTION 'sealedAt must transition from NULL to NON-NULL when sealing.';
            END IF;
            
            RETURN NEW;
        END IF;
        
        RAISE EXCEPTION 'Only DRAFT -> SEALED transition is allowed.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_dataset_snapshot_immutable
BEFORE UPDATE OR DELETE ON "DatasetSnapshot"
FOR EACH ROW EXECUTE FUNCTION block_dataset_snapshot_mutation();

-- 7. DatasetSnapshotEntry
CREATE OR REPLACE FUNCTION block_dataset_snapshot_entry_mutation()
RETURNS TRIGGER AS $$
DECLARE
    parent_status "DatasetSnapshotStatus";
BEGIN
    IF TG_OP = 'INSERT' THEN
        SELECT status INTO parent_status FROM "DatasetSnapshot" WHERE id = NEW."snapshotId";
        IF parent_status IS NULL THEN
            RETURN NEW;
        END IF;
        IF parent_status = 'SEALED' THEN
            RAISE EXCEPTION 'Cannot insert DatasetSnapshotEntry into a SEALED DatasetSnapshot.';
        END IF;
        RETURN NEW;
    END IF;
    
    RAISE EXCEPTION 'DatasetSnapshotEntry is immutable. No UPDATE or DELETE allowed.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_dataset_snapshot_entry_mutation
BEFORE INSERT OR UPDATE OR DELETE ON "DatasetSnapshotEntry"
FOR EACH ROW EXECUTE FUNCTION block_dataset_snapshot_entry_mutation();
