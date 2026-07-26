-- CreateEnum
CREATE TYPE "RunMode" AS ENUM ('HISTORICAL_REPLAY', 'LIVE_FORWARD');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('INITIALIZED', 'CONFIGURED', 'RUNNING', 'PAUSED', 'FAILED', 'TERMINATED', 'SEALED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('SYSTEM', 'ADMIN', 'VIEWER');

-- CreateTable
CREATE TABLE "RunCoreConfigVersion" (
    "id" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "mode" "RunMode" NOT NULL,
    "initialCapital" BIGINT NOT NULL,
    "codeVersion" TEXT NOT NULL,
    "rngSeed" BIGINT NOT NULL,
    "fillPolicyVersionKey" TEXT NOT NULL,
    "orchestrationVersionKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sealedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunCoreConfigVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulationRun" (
    "id" TEXT NOT NULL,
    "runBusinessKey" TEXT,
    "creationIdempotencyKey" TEXT NOT NULL,
    "creationRequestHash" TEXT NOT NULL,
    "configVersionId" TEXT NOT NULL,
    "mode" "RunMode" NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'INITIALIZED',
    "dataOriginHash" TEXT,
    "canonicalStartDate" DATE,
    "simulationDate" DATE,
    "dataCutoffAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "terminatedAt" TIMESTAMP(3),
    "sealedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "SimulationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulationRunEvent" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "eventSequence" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL,
    "fromStatus" "RunStatus",
    "toStatus" "RunStatus" NOT NULL,
    "simulationDateBefore" DATE,
    "simulationDateAfter" DATE,
    "actorType" "ActorType" NOT NULL,
    "actorBusinessKey" TEXT NOT NULL,
    "reason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payloadJson" TEXT NOT NULL,
    "previousHash" TEXT NOT NULL,
    "eventHash" TEXT NOT NULL,

    CONSTRAINT "SimulationRunEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RunCoreConfigVersion_contentHash_key" ON "RunCoreConfigVersion"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "SimulationRun_runBusinessKey_key" ON "SimulationRun"("runBusinessKey");

-- CreateIndex
CREATE UNIQUE INDEX "SimulationRun_creationIdempotencyKey_key" ON "SimulationRun"("creationIdempotencyKey");

-- CreateIndex
CREATE INDEX "SimulationRun_status_idx" ON "SimulationRun"("status");

-- CreateIndex
CREATE INDEX "SimulationRun_mode_idx" ON "SimulationRun"("mode");

-- CreateIndex
CREATE INDEX "SimulationRun_createdAt_idx" ON "SimulationRun"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SimulationRunEvent_idempotencyKey_key" ON "SimulationRunEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SimulationRunEvent_runId_eventSequence_idx" ON "SimulationRunEvent"("runId", "eventSequence");

-- CreateIndex
CREATE UNIQUE INDEX "SimulationRunEvent_runId_eventSequence_key" ON "SimulationRunEvent"("runId", "eventSequence");

-- AddForeignKey
ALTER TABLE "SimulationRun" ADD CONSTRAINT "SimulationRun_configVersionId_fkey" FOREIGN KEY ("configVersionId") REFERENCES "RunCoreConfigVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulationRunEvent" ADD CONSTRAINT "SimulationRunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SimulationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
