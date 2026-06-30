-- Keep Prisma schema and database aligned after introducing weekly availability patterns.

ALTER TABLE "WorkerAvailabilityPattern"
  ALTER COLUMN "daysOfWeek" SET NOT NULL;
