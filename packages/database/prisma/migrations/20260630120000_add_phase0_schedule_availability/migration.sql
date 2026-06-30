-- Phase 0 in-app schedule support: worker unavailability blocks and weekly pattern metadata.

CREATE TABLE "WorkerAvailabilityBlock" (
  "id" TEXT NOT NULL,
  "workerId" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'unavailable',
  "startAt" TIMESTAMP(3) NOT NULL,
  "endAt" TIMESTAMP(3) NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WorkerAvailabilityBlock_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkerAvailabilityPattern" (
  "workerId" TEXT NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'Europe/London',
  "daysOfWeek" INTEGER[],
  "startTime" TEXT,
  "endTime" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WorkerAvailabilityPattern_pkey" PRIMARY KEY ("workerId")
);

CREATE INDEX "WorkerAvailabilityBlock_workerId_startAt_idx" ON "WorkerAvailabilityBlock"("workerId", "startAt");
CREATE INDEX "WorkerAvailabilityBlock_workerId_endAt_idx" ON "WorkerAvailabilityBlock"("workerId", "endAt");

ALTER TABLE "WorkerAvailabilityBlock"
  ADD CONSTRAINT "WorkerAvailabilityBlock_workerId_fkey"
  FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkerAvailabilityPattern"
  ADD CONSTRAINT "WorkerAvailabilityPattern_workerId_fkey"
  FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
