-- Drop redundant triggers on RunCoreConfigVersion
DROP TRIGGER IF EXISTS prevent_runcoreconfigversion_update ON "RunCoreConfigVersion";
DROP TRIGGER IF EXISTS prevent_runcoreconfigversion_delete ON "RunCoreConfigVersion";
DROP FUNCTION IF EXISTS protect_runcoreconfigversion_immutability();
DROP FUNCTION IF EXISTS protect_runcoreconfigversion_delete();
DROP FUNCTION IF EXISTS protect_runcoreconfigversion_update();

-- Drop redundant triggers on SimulationRunEvent
DROP TRIGGER IF EXISTS prevent_simulationrunevent_update ON "SimulationRunEvent";
DROP TRIGGER IF EXISTS prevent_simulationrunevent_delete ON "SimulationRunEvent";
DROP FUNCTION IF EXISTS protect_simulationrunevent_immutability();
DROP FUNCTION IF EXISTS protect_simulationrunevent_update();
DROP FUNCTION IF EXISTS protect_simulationrunevent_delete();

-- Drop redundant triggers on SimulationRun
DROP TRIGGER IF EXISTS prevent_simulationrun_immutable_fields_update ON "SimulationRun";
DROP TRIGGER IF EXISTS prevent_simulationrun_delete ON "SimulationRun";
DROP TRIGGER IF EXISTS check_simulationrun_lifecycle_trigger ON "SimulationRun";
DROP FUNCTION IF EXISTS protect_simulationrun_immutable_fields();
DROP FUNCTION IF EXISTS protect_simulationrun_delete();
DROP FUNCTION IF EXISTS check_simulationrun_lifecycle();
