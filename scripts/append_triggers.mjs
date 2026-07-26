import fs from 'fs';
const migrationPath = 'prisma/migrations/20260725065616_phase_1a_init/migration.sql';
const sql = `
-- IMMUTABILITY TRIGGERS
CREATE OR REPLACE FUNCTION protect_runcoreconfigversion_immutability() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'RunCoreConfigVersion is immutable and cannot be updated.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prevent_runcoreconfigversion_update
BEFORE UPDATE ON "RunCoreConfigVersion"
FOR EACH ROW EXECUTE FUNCTION protect_runcoreconfigversion_immutability();

CREATE OR REPLACE FUNCTION protect_simulationrunevent_immutability() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'SimulationRunEvent is immutable and cannot be updated.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prevent_simulationrunevent_update
BEFORE UPDATE ON "SimulationRunEvent"
FOR EACH ROW EXECUTE FUNCTION protect_simulationrunevent_immutability();

CREATE OR REPLACE FUNCTION protect_simulationrun_immutable_fields() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.id != OLD.id OR NEW."creationIdempotencyKey" != OLD."creationIdempotencyKey" OR NEW."configVersionId" != OLD."configVersionId" THEN
        RAISE EXCEPTION 'Immutable fields of SimulationRun cannot be modified.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prevent_simulationrun_immutable_fields_update
BEFORE UPDATE ON "SimulationRun"
FOR EACH ROW EXECUTE FUNCTION protect_simulationrun_immutable_fields();
`;
fs.appendFileSync(migrationPath, sql);
console.log('Triggers appended.');
