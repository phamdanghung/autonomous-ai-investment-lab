-- Block DELETE on RunCoreConfigVersion
CREATE OR REPLACE FUNCTION protect_runcoreconfigversion_delete() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'RunCoreConfigVersion is immutable and cannot be deleted.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_runcoreconfigversion_delete ON "RunCoreConfigVersion";
CREATE TRIGGER prevent_runcoreconfigversion_delete
BEFORE DELETE ON "RunCoreConfigVersion"
FOR EACH ROW EXECUTE FUNCTION protect_runcoreconfigversion_delete();


-- Block DELETE on SimulationRunEvent
CREATE OR REPLACE FUNCTION protect_simulationrunevent_delete() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'SimulationRunEvent is immutable and cannot be deleted.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_simulationrunevent_delete ON "SimulationRunEvent";
CREATE TRIGGER prevent_simulationrunevent_delete
BEFORE DELETE ON "SimulationRunEvent"
FOR EACH ROW EXECUTE FUNCTION protect_simulationrunevent_delete();


-- Block DELETE on SimulationRun
CREATE OR REPLACE FUNCTION protect_simulationrun_delete() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'SimulationRun cannot be deleted.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_simulationrun_delete ON "SimulationRun";
CREATE TRIGGER prevent_simulationrun_delete
BEFORE DELETE ON "SimulationRun"
FOR EACH ROW EXECUTE FUNCTION protect_simulationrun_delete();


-- SimulationRun Lifecycle UPDATE Trigger
CREATE OR REPLACE FUNCTION check_simulationrun_lifecycle() RETURNS TRIGGER AS $$
BEGIN
    -- 1. Immutable forever
    IF NEW.id <> OLD.id THEN RAISE EXCEPTION 'Cannot change id'; END IF;
    IF NEW."creationIdempotencyKey" <> OLD."creationIdempotencyKey" THEN RAISE EXCEPTION 'Cannot change creationIdempotencyKey'; END IF;
    IF NEW."creationRequestHash" <> OLD."creationRequestHash" THEN RAISE EXCEPTION 'Cannot change creationRequestHash'; END IF;
    IF NEW."configVersionId" <> OLD."configVersionId" THEN RAISE EXCEPTION 'Cannot change configVersionId'; END IF;
    IF NEW.mode <> OLD.mode THEN RAISE EXCEPTION 'Cannot change mode'; END IF;
    IF NEW."createdAt" <> OLD."createdAt" THEN RAISE EXCEPTION 'Cannot change createdAt'; END IF;

    -- 2. Lifecycle
    IF OLD.status = 'SEALED' THEN
        RAISE EXCEPTION 'Cannot modify a SEALED SimulationRun';
    END IF;

    IF NEW.version <> OLD.version + 1 THEN
        RAISE EXCEPTION 'Version must be incremented by exactly 1 on update';
    END IF;

    -- 3. Bind once logic
    IF (NEW."dataOriginHash" IS DISTINCT FROM OLD."dataOriginHash") OR 
       (NEW."canonicalStartDate" IS DISTINCT FROM OLD."canonicalStartDate") OR 
       (NEW."simulationDate" IS DISTINCT FROM OLD."simulationDate") OR 
       (NEW."runBusinessKey" IS DISTINCT FROM OLD."runBusinessKey") THEN
        
        IF OLD.status <> 'INITIALIZED' OR NEW.status <> 'CONFIGURED' THEN
            RAISE EXCEPTION 'Can only bind data origin during INITIALIZED -> CONFIGURED transition';
        END IF;

        IF OLD."dataOriginHash" IS NOT NULL OR OLD."canonicalStartDate" IS NOT NULL OR 
           OLD."simulationDate" IS NOT NULL OR OLD."runBusinessKey" IS NOT NULL THEN
            RAISE EXCEPTION 'Bind once fields are already set';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS check_simulationrun_lifecycle_trigger ON "SimulationRun";
CREATE TRIGGER check_simulationrun_lifecycle_trigger
BEFORE UPDATE ON "SimulationRun"
FOR EACH ROW EXECUTE FUNCTION check_simulationrun_lifecycle();
