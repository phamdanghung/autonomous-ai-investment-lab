-- ======================================================================================
-- MIGRATION: phase_1a_reject_non_event_version_bumps
-- ======================================================================================

CREATE OR REPLACE FUNCTION simulation_run_lifecycle_guard()
RETURNS TRIGGER AS $$
BEGIN
  -- 1. Version Increment Guard
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Version must be incremented by exactly 1 on update';
  END IF;

  -- 2. Status Change requirement (No non-event version bumps allowed in Phase 1A)
  IF NEW.status = OLD.status AND NEW.version IS DISTINCT FROM OLD.version THEN
    RAISE EXCEPTION 'SimulationRun version cannot change without an approved state transition';
  END IF;

  -- 3. Immutable Forever Fields Guard
  IF NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'Cannot change id'; END IF;
  IF NEW."creationIdempotencyKey" IS DISTINCT FROM OLD."creationIdempotencyKey" THEN RAISE EXCEPTION 'Cannot change creationIdempotencyKey'; END IF;
  IF NEW."creationRequestHash" IS DISTINCT FROM OLD."creationRequestHash" THEN RAISE EXCEPTION 'Cannot change creationRequestHash'; END IF;
  IF NEW."configVersionId" IS DISTINCT FROM OLD."configVersionId" THEN RAISE EXCEPTION 'Cannot change configVersionId'; END IF;
  IF NEW.mode IS DISTINCT FROM OLD.mode THEN RAISE EXCEPTION 'Cannot change mode'; END IF;
  IF NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN RAISE EXCEPTION 'Cannot change createdAt'; END IF;

  -- 4. SEALED State Protection
  IF OLD.status = 'SEALED' THEN
    RAISE EXCEPTION 'Cannot update a SEALED SimulationRun';
  END IF;

  -- 5. Bind-Once Fields Protection (dataOriginHash, canonicalStartDate, simulationDate, runBusinessKey)
  IF (
    NEW."dataOriginHash" IS DISTINCT FROM OLD."dataOriginHash" OR
    NEW."canonicalStartDate" IS DISTINCT FROM OLD."canonicalStartDate" OR
    NEW."simulationDate" IS DISTINCT FROM OLD."simulationDate" OR
    NEW."runBusinessKey" IS DISTINCT FROM OLD."runBusinessKey"
  ) THEN
    IF OLD.status <> 'INITIALIZED' OR NEW.status <> 'CONFIGURED' THEN
      RAISE EXCEPTION 'Can only bind data origin during INITIALIZED -> CONFIGURED transition';
    END IF;

    -- Cannot revert to NULL or change if already set
    IF OLD."dataOriginHash" IS NOT NULL OR OLD."canonicalStartDate" IS NOT NULL OR OLD."simulationDate" IS NOT NULL OR OLD."runBusinessKey" IS NOT NULL THEN
      RAISE EXCEPTION 'Bind-once fields are already bound';
    END IF;

    -- Must not bind partially
    IF NEW."dataOriginHash" IS NULL OR NEW."canonicalStartDate" IS NULL OR NEW."simulationDate" IS NULL OR NEW."runBusinessKey" IS NULL THEN
      RAISE EXCEPTION 'Must bind all bind-once fields simultaneously';
    END IF;

    -- simulationDate must equal canonicalStartDate
    IF NEW."simulationDate" <> NEW."canonicalStartDate" THEN
      RAISE EXCEPTION 'simulationDate must equal canonicalStartDate at bind time';
    END IF;
  END IF;

  -- 6. Strict State Machine
  IF NEW.status <> OLD.status THEN
    IF OLD.status = 'INITIALIZED' AND NEW.status = 'CONFIGURED' THEN
      -- Valid
    ELSIF OLD.status = 'CONFIGURED' AND NEW.status = 'RUNNING' THEN
      -- Valid
    ELSIF OLD.status = 'RUNNING' AND NEW.status = 'PAUSED' THEN
      -- Valid
    ELSIF OLD.status = 'PAUSED' AND NEW.status = 'RUNNING' THEN
      -- Valid
    ELSIF OLD.status = 'CONFIGURED' AND NEW.status = 'TERMINATED' THEN
      -- Valid
    ELSIF OLD.status = 'RUNNING' AND NEW.status = 'TERMINATED' THEN
      -- Valid
    ELSIF OLD.status = 'PAUSED' AND NEW.status = 'TERMINATED' THEN
      -- Valid
    ELSIF OLD.status = 'FAILED' AND NEW.status = 'TERMINATED' THEN
      -- Valid
    ELSIF OLD.status = 'TERMINATED' AND NEW.status = 'SEALED' THEN
      -- Valid
    ELSIF OLD.status = 'RUNNING' AND NEW.status = 'SEALED' THEN
      IF OLD.mode = 'LIVE_FORWARD' THEN
        RAISE EXCEPTION 'LIVE_FORWARD cannot transition directly from RUNNING to SEALED';
      END IF;
      -- Valid for HISTORICAL_REPLAY
    ELSE
      RAISE EXCEPTION 'Invalid state transition from % to %', OLD.status, NEW.status;
    END IF;
  END IF;

  -- 7. Lifecycle Timestamp Validation
  -- start: startedAt
  IF NEW."startedAt" IS DISTINCT FROM OLD."startedAt" THEN
    IF OLD."startedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot modify already set startedAt';
    END IF;
    IF NEW.status <> 'RUNNING' THEN
      RAISE EXCEPTION 'Can only set startedAt when transitioning to RUNNING';
    END IF;
  END IF;

  -- terminate: terminatedAt
  IF NEW."terminatedAt" IS DISTINCT FROM OLD."terminatedAt" THEN
    IF OLD."terminatedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot modify already set terminatedAt';
    END IF;
    IF NEW.status <> 'TERMINATED' THEN
      RAISE EXCEPTION 'Can only set terminatedAt when transitioning to TERMINATED';
    END IF;
  END IF;

  -- seal: sealedAt
  IF NEW."sealedAt" IS DISTINCT FROM OLD."sealedAt" THEN
    IF OLD."sealedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot modify already set sealedAt';
    END IF;
    IF NEW.status <> 'SEALED' THEN
      RAISE EXCEPTION 'Can only set sealedAt when transitioning to SEALED';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
