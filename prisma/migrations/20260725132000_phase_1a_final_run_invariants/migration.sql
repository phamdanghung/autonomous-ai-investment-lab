-- 1. Block UPDATE on RunCoreConfigVersion
CREATE OR REPLACE FUNCTION protect_runcoreconfigversion_update() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'RunCoreConfigVersion is immutable and cannot be updated.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_runcoreconfigversion_update ON "RunCoreConfigVersion";
CREATE TRIGGER prevent_runcoreconfigversion_update
BEFORE UPDATE ON "RunCoreConfigVersion"
FOR EACH ROW EXECUTE FUNCTION protect_runcoreconfigversion_update();

-- 2. Block UPDATE on SimulationRunEvent
CREATE OR REPLACE FUNCTION protect_simulationrunevent_update() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'SimulationRunEvent is immutable and cannot be updated.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_simulationrunevent_update ON "SimulationRunEvent";
CREATE TRIGGER prevent_simulationrunevent_update
BEFORE UPDATE ON "SimulationRunEvent"
FOR EACH ROW EXECUTE FUNCTION protect_simulationrunevent_update();
