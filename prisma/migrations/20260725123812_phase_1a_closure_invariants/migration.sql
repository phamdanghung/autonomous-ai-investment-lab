-- PHASE 1A CLOSURE INVARIANTS

-- 1. Block DELETE on RunCoreConfigVersion
CREATE OR REPLACE FUNCTION protect_runcoreconfigversion_delete() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'RunCoreConfigVersion is immutable and cannot be deleted.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prevent_runcoreconfigversion_delete
BEFORE DELETE ON "RunCoreConfigVersion"
FOR EACH ROW EXECUTE FUNCTION protect_runcoreconfigversion_delete();

-- 2. Block DELETE on SimulationRunEvent
CREATE OR REPLACE FUNCTION protect_simulationrunevent_delete() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'SimulationRunEvent is immutable and cannot be deleted.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prevent_simulationrunevent_delete
BEFORE DELETE ON "SimulationRunEvent"
FOR EACH ROW EXECUTE FUNCTION protect_simulationrunevent_delete();

-- 3. Enhance SimulationRun UPDATE trigger
CREATE OR REPLACE FUNCTION protect_simulationrun_immutable_fields() RETURNS TRIGGER AS $$
BEGIN
    -- Immutable after insert
    IF NEW.id != OLD.id OR 
       NEW."creationIdempotencyKey" != OLD."creationIdempotencyKey" OR 
       NEW."creationRequestHash" != OLD."creationRequestHash" OR 
       NEW."configVersionId" != OLD."configVersionId" OR 
       NEW.mode != OLD.mode OR 
       NEW."createdAt" != OLD."createdAt" THEN
        RAISE EXCEPTION 'Immutable fields of SimulationRun cannot be modified.';
    END IF;

    -- Bind-once fields
    IF OLD."dataOriginHash" IS NOT NULL AND NEW."dataOriginHash" != OLD."dataOriginHash" THEN
        RAISE EXCEPTION 'dataOriginHash is bind-once and cannot be modified after being set.';
    END IF;
    IF OLD."canonicalStartDate" IS NOT NULL AND NEW."canonicalStartDate" != OLD."canonicalStartDate" THEN
        RAISE EXCEPTION 'canonicalStartDate is bind-once and cannot be modified after being set.';
    END IF;
    IF OLD."runBusinessKey" IS NOT NULL AND NEW."runBusinessKey" != OLD."runBusinessKey" THEN
        RAISE EXCEPTION 'runBusinessKey is bind-once and cannot be modified after being set.';
    END IF;
    IF OLD."simulationDate" IS NOT NULL AND NEW."simulationDate" != OLD."simulationDate" THEN
        -- Actually, simulationDate can change as simulation progresses, but the prompt says:
        -- "Bind-once: dataOriginHash, canonicalStartDate, runBusinessKey, simulationDate"
        -- Wait, simulationDate bind once? Yes, for Phase 1A. If it's bind-once:
        RAISE EXCEPTION 'simulationDate is bind-once and cannot be modified after being set.';
    END IF;

    -- Lifecycle protection
    IF OLD.status = 'SEALED' THEN
        RAISE EXCEPTION 'Cannot update a SEALED SimulationRun.';
    END IF;

    IF NEW.status != OLD.status THEN
        IF NEW.version != OLD.version + 1 THEN
            RAISE EXCEPTION 'Version must increase by exactly 1 when status changes.';
        END IF;
    ELSE
        -- If status doesn't change, version might still increase if it's an internal update, 
        -- but if version increases, status should change? The prompt says "Status đổi phải kèm version tăng"
        -- and "Version phải tăng đúng +1". It doesn't strictly say version can only increase on status change.
        -- We will just check if version increments properly if changed.
        IF NEW.version != OLD.version AND NEW.version != OLD.version + 1 THEN
            RAISE EXCEPTION 'Version must increase by exactly 1.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger already exists, but we replaced the function above. No need to recreate the trigger itself.

-- 4. Block DELETE on SimulationRun
CREATE OR REPLACE FUNCTION protect_simulationrun_delete() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'SimulationRun cannot be deleted as it would lose event history.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prevent_simulationrun_delete
BEFORE DELETE ON "SimulationRun"
FOR EACH ROW EXECUTE FUNCTION protect_simulationrun_delete();
