CREATE TYPE "PendingApprovalStatus" AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE "PendingApproval" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "explanation" TEXT NOT NULL,
    "status" "PendingApprovalStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,

    CONSTRAINT "PendingApproval_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PendingApproval_organisationId_status_createdAt_idx" ON "PendingApproval"("organisationId", "status", "createdAt");

CREATE INDEX "PendingApproval_entityType_entityId_idx" ON "PendingApproval"("entityType", "entityId");

ALTER TABLE "PendingApproval" ADD CONSTRAINT "PendingApproval_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
