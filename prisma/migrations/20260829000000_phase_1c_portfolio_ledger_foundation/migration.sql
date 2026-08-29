-- CreateTable
CREATE TABLE "PortfolioLedger" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "runBusinessKey" TEXT NOT NULL,
    "contractVersion" TEXT NOT NULL,
    "ledgerKind" TEXT NOT NULL,
    "canonicalStartDate" DATE NOT NULL,
    "currency" TEXT NOT NULL,
    "openingCashVnd" BIGINT NOT NULL,
    "openingPositionCount" INTEGER NOT NULL,
    "genesisHash" TEXT NOT NULL,
    "currentCashBalanceVnd" BIGINT NOT NULL,
    "lastEntrySequence" BIGINT NOT NULL,
    "lastEntryHash" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortfolioLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioLedgerPosition" (
    "id" TEXT NOT NULL,
    "ledgerId" TEXT NOT NULL,
    "instrumentBusinessKey" TEXT NOT NULL,
    "quantity" BIGINT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortfolioLedgerPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioLedgerPosting" (
    "id" TEXT NOT NULL,
    "ledgerId" TEXT NOT NULL,
    "ledgerGenesisHash" TEXT NOT NULL,
    "settlementContractVersion" TEXT NOT NULL,
    "postingKind" TEXT NOT NULL,
    "sourceExecutionHash" TEXT NOT NULL,
    "instrumentBusinessKey" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "quantityDelta" BIGINT NOT NULL,
    "grossCashDeltaVnd" BIGINT NOT NULL,
    "feeVnd" BIGINT NOT NULL,
    "taxVnd" BIGINT NOT NULL,
    "netCashDeltaVnd" BIGINT NOT NULL,
    "settlementPayloadHash" TEXT NOT NULL,
    "transitionContractVersion" TEXT NOT NULL,
    "transitionKind" TEXT NOT NULL,
    "cashBalanceBeforeVnd" BIGINT NOT NULL,
    "cashDeltaVnd" BIGINT NOT NULL,
    "cashBalanceAfterVnd" BIGINT NOT NULL,
    "positionQuantityBefore" BIGINT NOT NULL,
    "positionQuantityAfter" BIGINT NOT NULL,
    "transitionHash" TEXT NOT NULL,
    "entryContractVersion" TEXT NOT NULL,
    "entryType" TEXT NOT NULL,
    "entrySequence" BIGINT NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "previousHash" TEXT NOT NULL,
    "entryHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortfolioLedgerPosting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioLedger_runId_key" ON "PortfolioLedger"("runId");
CREATE UNIQUE INDEX "PortfolioLedger_runBusinessKey_key" ON "PortfolioLedger"("runBusinessKey");
CREATE UNIQUE INDEX "PortfolioLedger_genesisHash_key" ON "PortfolioLedger"("genesisHash");
CREATE UNIQUE INDEX "PortfolioLedger_lastEntryHash_key" ON "PortfolioLedger"("lastEntryHash");

-- CreateIndex
CREATE INDEX "PortfolioLedgerPosition_instrumentBusinessKey_idx" ON "PortfolioLedgerPosition"("instrumentBusinessKey");
CREATE UNIQUE INDEX "PortfolioLedgerPosition_ledgerId_instrumentBusinessKey_key" ON "PortfolioLedgerPosition"("ledgerId", "instrumentBusinessKey");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioLedgerPosting_entryHash_key" ON "PortfolioLedgerPosting"("entryHash");
CREATE INDEX "PortfolioLedgerPosting_ledgerId_instrumentBusinessKey_entrySe_idx" ON "PortfolioLedgerPosting"("ledgerId", "instrumentBusinessKey", "entrySequence");
CREATE INDEX "PortfolioLedgerPosting_instrumentBusinessKey_idx" ON "PortfolioLedgerPosting"("instrumentBusinessKey");
CREATE INDEX "PortfolioLedgerPosting_effectiveDate_idx" ON "PortfolioLedgerPosting"("effectiveDate");
CREATE UNIQUE INDEX "PortfolioLedgerPosting_ledgerId_entrySequence_key" ON "PortfolioLedgerPosting"("ledgerId", "entrySequence");
CREATE UNIQUE INDEX "PortfolioLedgerPosting_ledgerId_previousHash_key" ON "PortfolioLedgerPosting"("ledgerId", "previousHash");
CREATE UNIQUE INDEX "PortfolioLedgerPosting_ledgerId_sourceExecutionHash_key" ON "PortfolioLedgerPosting"("ledgerId", "sourceExecutionHash");
CREATE UNIQUE INDEX "PortfolioLedgerPosting_ledgerId_transitionHash_key" ON "PortfolioLedgerPosting"("ledgerId", "transitionHash");

-- AddForeignKey
ALTER TABLE "PortfolioLedger" ADD CONSTRAINT "PortfolioLedger_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SimulationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioLedgerPosition" ADD CONSTRAINT "PortfolioLedgerPosition_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "PortfolioLedger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioLedgerPosition" ADD CONSTRAINT "PortfolioLedgerPosition_instrumentBusinessKey_fkey" FOREIGN KEY ("instrumentBusinessKey") REFERENCES "MarketInstrument"("businessKey") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioLedgerPosting" ADD CONSTRAINT "PortfolioLedgerPosting_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "PortfolioLedger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioLedgerPosting" ADD CONSTRAINT "PortfolioLedgerPosting_instrumentBusinessKey_fkey" FOREIGN KEY ("instrumentBusinessKey") REFERENCES "MarketInstrument"("businessKey") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Add Domain Invariants
ALTER TABLE "PortfolioLedger" ADD CONSTRAINT "chk_ledger_contract" CHECK ("contractVersion" = '1.0');
ALTER TABLE "PortfolioLedger" ADD CONSTRAINT "chk_ledger_kind" CHECK ("ledgerKind" = 'SIMULATION_PORTFOLIO');
ALTER TABLE "PortfolioLedger" ADD CONSTRAINT "chk_ledger_currency" CHECK ("currency" = 'VND');
ALTER TABLE "PortfolioLedger" ADD CONSTRAINT "chk_ledger_opening_cash" CHECK ("openingCashVnd" >= 0);
ALTER TABLE "PortfolioLedger" ADD CONSTRAINT "chk_ledger_opening_pos" CHECK ("openingPositionCount" = 0);
ALTER TABLE "PortfolioLedger" ADD CONSTRAINT "chk_ledger_current_cash" CHECK ("currentCashBalanceVnd" >= 0);
ALTER TABLE "PortfolioLedger" ADD CONSTRAINT "chk_ledger_version" CHECK ("version" >= 1);
ALTER TABLE "PortfolioLedger" ADD CONSTRAINT "chk_ledger_last_seq_min" CHECK ("lastEntrySequence" >= 0);
ALTER TABLE "PortfolioLedger" ADD CONSTRAINT "chk_ledger_last_seq_max" CHECK ("lastEntrySequence" <= 9007199254740991);
ALTER TABLE "PortfolioLedger" ADD CONSTRAINT "chk_ledger_run_key_fmt" CHECK ("runBusinessKey" ~ '^[a-f0-9]{64}$');
ALTER TABLE "PortfolioLedger" ADD CONSTRAINT "chk_ledger_genesis_fmt" CHECK ("genesisHash" ~ '^[a-f0-9]{64}$');
ALTER TABLE "PortfolioLedger" ADD CONSTRAINT "chk_ledger_last_fmt" CHECK ("lastEntryHash" ~ '^[a-f0-9]{64}$');

ALTER TABLE "PortfolioLedgerPosition" ADD CONSTRAINT "chk_pos_quantity" CHECK ("quantity" >= 0);
ALTER TABLE "PortfolioLedgerPosition" ADD CONSTRAINT "chk_pos_version" CHECK ("version" >= 1);

ALTER TABLE "PortfolioLedgerPosting" ADD CONSTRAINT "chk_post_settlement_version" CHECK ("settlementContractVersion" = '1.0');
ALTER TABLE "PortfolioLedgerPosting" ADD CONSTRAINT "chk_post_kind" CHECK ("postingKind" = 'TRADE_SETTLEMENT');
ALTER TABLE "PortfolioLedgerPosting" ADD CONSTRAINT "chk_post_transition_version" CHECK ("transitionContractVersion" = '1.0');
ALTER TABLE "PortfolioLedgerPosting" ADD CONSTRAINT "chk_post_transition_kind" CHECK ("transitionKind" = 'TRADE_SETTLEMENT_APPLIED');
ALTER TABLE "PortfolioLedgerPosting" ADD CONSTRAINT "chk_post_entry_version" CHECK ("entryContractVersion" = '1.0');
ALTER TABLE "PortfolioLedgerPosting" ADD CONSTRAINT "chk_post_entry_type" CHECK ("entryType" = 'POSTING');
ALTER TABLE "PortfolioLedgerPosting" ADD CONSTRAINT "chk_post_seq_min" CHECK ("entrySequence" > 0);
ALTER TABLE "PortfolioLedgerPosting" ADD CONSTRAINT "chk_post_seq_max" CHECK ("entrySequence" <= 9007199254740991);
ALTER TABLE "PortfolioLedgerPosting" ADD CONSTRAINT "chk_post_fee" CHECK ("feeVnd" >= 0);
ALTER TABLE "PortfolioLedgerPosting" ADD CONSTRAINT "chk_post_tax" CHECK ("taxVnd" >= 0);
ALTER TABLE "PortfolioLedgerPosting" ADD CONSTRAINT "chk_post_qty_delta" CHECK ("quantityDelta" <> 0);
ALTER TABLE "PortfolioLedgerPosting" ADD CONSTRAINT "chk_post_gross_cash" CHECK ("grossCashDeltaVnd" <> 0);
ALTER TABLE "PortfolioLedgerPosting" ADD CONSTRAINT "chk_post_cash_before" CHECK ("cashBalanceBeforeVnd" >= 0);
ALTER TABLE "PortfolioLedgerPosting" ADD CONSTRAINT "chk_post_cash_after" CHECK ("cashBalanceAfterVnd" >= 0);
ALTER TABLE "PortfolioLedgerPosting" ADD CONSTRAINT "chk_post_pos_before" CHECK ("positionQuantityBefore" >= 0);
ALTER TABLE "PortfolioLedgerPosting" ADD CONSTRAINT "chk_post_pos_after" CHECK ("positionQuantityAfter" >= 0);
ALTER TABLE "PortfolioLedgerPosting" ADD CONSTRAINT "chk_post_cash_delta" CHECK ("cashDeltaVnd" = "netCashDeltaVnd");
ALTER TABLE "PortfolioLedgerPosting" ADD CONSTRAINT "chk_post_net_cash" CHECK ("netCashDeltaVnd" = "grossCashDeltaVnd" - "feeVnd" - "taxVnd");
ALTER TABLE "PortfolioLedgerPosting" ADD CONSTRAINT "chk_post_cash_after_math" CHECK ("cashBalanceAfterVnd" = "cashBalanceBeforeVnd" + "cashDeltaVnd");
ALTER TABLE "PortfolioLedgerPosting" ADD CONSTRAINT "chk_post_pos_after_math" CHECK ("positionQuantityAfter" = "positionQuantityBefore" + "quantityDelta");
ALTER TABLE "PortfolioLedgerPosting" ADD CONSTRAINT "chk_post_side" CHECK ("side" IN ('BUY', 'SELL'));
ALTER TABLE "PortfolioLedgerPosting" ADD CONSTRAINT "chk_post_side_logic" CHECK (
  ("side" = 'BUY' AND "quantityDelta" > 0 AND "grossCashDeltaVnd" < 0 AND "cashDeltaVnd" < 0 AND "cashBalanceAfterVnd" < "cashBalanceBeforeVnd" AND "positionQuantityAfter" > "positionQuantityBefore")
  OR
  ("side" = 'SELL' AND "quantityDelta" < 0 AND "grossCashDeltaVnd" > 0 AND "netCashDeltaVnd" > 0 AND "cashDeltaVnd" > 0 AND "cashBalanceAfterVnd" > "cashBalanceBeforeVnd" AND "positionQuantityAfter" < "positionQuantityBefore")
);
ALTER TABLE "PortfolioLedgerPosting" ADD CONSTRAINT "chk_post_gen_hash" CHECK ("ledgerGenesisHash" ~ '^[a-f0-9]{64}$');
ALTER TABLE "PortfolioLedgerPosting" ADD CONSTRAINT "chk_post_src_hash" CHECK ("sourceExecutionHash" ~ '^[a-f0-9]{64}$');
ALTER TABLE "PortfolioLedgerPosting" ADD CONSTRAINT "chk_post_settle_hash" CHECK ("settlementPayloadHash" ~ '^[a-f0-9]{64}$');
ALTER TABLE "PortfolioLedgerPosting" ADD CONSTRAINT "chk_post_trans_hash" CHECK ("transitionHash" ~ '^[a-f0-9]{64}$');
ALTER TABLE "PortfolioLedgerPosting" ADD CONSTRAINT "chk_post_prev_hash" CHECK ("previousHash" ~ '^[a-f0-9]{64}$');
ALTER TABLE "PortfolioLedgerPosting" ADD CONSTRAINT "chk_post_entry_hash" CHECK ("entryHash" ~ '^[a-f0-9]{64}$');

-- Add Triggers

-- 1. PortfolioLedger ROOT INSERT
CREATE OR REPLACE FUNCTION validate_portfolio_ledger_insert()
RETURNS TRIGGER AS $$
DECLARE
    sim_run RECORD;
BEGIN
    -- Verify local initialization state
    IF NEW."currentCashBalanceVnd" <> NEW."openingCashVnd" THEN
        RAISE EXCEPTION 'currentCashBalanceVnd must equal openingCashVnd at genesis';
    END IF;
    IF NEW."lastEntrySequence" <> 0 THEN
        RAISE EXCEPTION 'lastEntrySequence must be 0 at genesis';
    END IF;
    IF NEW."lastEntryHash" <> NEW."genesisHash" THEN
        RAISE EXCEPTION 'lastEntryHash must equal genesisHash at genesis';
    END IF;
    IF NEW."version" <> 1 THEN
        RAISE EXCEPTION 'version must be 1 at genesis';
    END IF;

    -- Verify parent state consistency
    SELECT sr.*, rccv."initialCapital" 
    INTO sim_run
    FROM "SimulationRun" sr
    JOIN "RunCoreConfigVersion" rccv ON sr."configVersionId" = rccv."id"
    WHERE sr."id" = NEW."runId";

    IF NOT FOUND THEN
        RAISE EXCEPTION 'SimulationRun not found';
    END IF;
    IF sim_run."runBusinessKey" IS NULL THEN
        RAISE EXCEPTION 'SimulationRun.runBusinessKey IS NULL';
    END IF;
    IF sim_run."canonicalStartDate" IS NULL THEN
        RAISE EXCEPTION 'SimulationRun.canonicalStartDate IS NULL';
    END IF;
    IF sim_run."dataOriginHash" IS NULL THEN
        RAISE EXCEPTION 'SimulationRun.dataOriginHash IS NULL';
    END IF;
    IF sim_run."status" = 'INITIALIZED' THEN
        RAISE EXCEPTION 'SimulationRun is unbound/INITIALIZED';
    END IF;
    IF NEW."runBusinessKey" <> sim_run."runBusinessKey" THEN
        RAISE EXCEPTION 'runBusinessKey mismatch with SimulationRun';
    END IF;
    IF NEW."canonicalStartDate" <> sim_run."canonicalStartDate" THEN
        RAISE EXCEPTION 'canonicalStartDate mismatch with SimulationRun';
    END IF;
    IF NEW."openingCashVnd" <> sim_run."initialCapital" THEN
        RAISE EXCEPTION 'openingCashVnd mismatch with RunCoreConfigVersion.initialCapital';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_portfolio_ledger_insert_guard
BEFORE INSERT ON "PortfolioLedger"
FOR EACH ROW
EXECUTE FUNCTION validate_portfolio_ledger_insert();


-- 2. PortfolioLedger MUTATION GUARD
CREATE OR REPLACE FUNCTION validate_portfolio_ledger_mutation()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'PortfolioLedger cannot be deleted';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        -- Whitelist: only these can change
        IF NEW."id" IS DISTINCT FROM OLD."id" OR
           NEW."runId" IS DISTINCT FROM OLD."runId" OR
           NEW."runBusinessKey" IS DISTINCT FROM OLD."runBusinessKey" OR
           NEW."contractVersion" IS DISTINCT FROM OLD."contractVersion" OR
           NEW."ledgerKind" IS DISTINCT FROM OLD."ledgerKind" OR
           NEW."canonicalStartDate" IS DISTINCT FROM OLD."canonicalStartDate" OR
           NEW."currency" IS DISTINCT FROM OLD."currency" OR
           NEW."openingCashVnd" IS DISTINCT FROM OLD."openingCashVnd" OR
           NEW."openingPositionCount" IS DISTINCT FROM OLD."openingPositionCount" OR
           NEW."genesisHash" IS DISTINCT FROM OLD."genesisHash" OR
           NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
         THEN
            RAISE EXCEPTION 'Immutable fields of PortfolioLedger cannot be updated';
        END IF;

        IF NEW."version" <> OLD."version" + 1 THEN
            RAISE EXCEPTION 'PortfolioLedger version must increment exactly by +1';
        END IF;
        IF NEW."lastEntrySequence" <> OLD."lastEntrySequence" + 1 THEN
            RAISE EXCEPTION 'PortfolioLedger lastEntrySequence must increment exactly by +1';
        END IF;
        IF NEW."lastEntryHash" = OLD."lastEntryHash" THEN
            RAISE EXCEPTION 'PortfolioLedger lastEntryHash must change on update';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_portfolio_ledger_mutation_guard
BEFORE UPDATE OR DELETE ON "PortfolioLedger"
FOR EACH ROW
EXECUTE FUNCTION validate_portfolio_ledger_mutation();


-- 3. PortfolioLedgerPosition MUTATION GUARD
CREATE OR REPLACE FUNCTION validate_portfolio_ledger_position_mutation()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'PortfolioLedgerPosition cannot be deleted';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW."id" IS DISTINCT FROM OLD."id" OR
           NEW."ledgerId" IS DISTINCT FROM OLD."ledgerId" OR
           NEW."instrumentBusinessKey" IS DISTINCT FROM OLD."instrumentBusinessKey" OR
           NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
        THEN
            RAISE EXCEPTION 'Immutable fields of PortfolioLedgerPosition cannot be updated';
        END IF;
        
        IF NEW."version" <> OLD."version" + 1 THEN
            RAISE EXCEPTION 'PortfolioLedgerPosition version must increment exactly by +1';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_portfolio_ledger_position_mutation_guard
BEFORE UPDATE OR DELETE ON "PortfolioLedgerPosition"
FOR EACH ROW
EXECUTE FUNCTION validate_portfolio_ledger_position_mutation();


-- 4. PortfolioLedgerPosting MUTATION GUARD
CREATE OR REPLACE FUNCTION block_portfolio_ledger_posting_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'PortfolioLedgerPosting is completely immutable (append-only)';
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_portfolio_ledger_posting_mutation_guard
BEFORE UPDATE OR DELETE ON "PortfolioLedgerPosting"
FOR EACH ROW
EXECUTE FUNCTION block_portfolio_ledger_posting_mutation();
