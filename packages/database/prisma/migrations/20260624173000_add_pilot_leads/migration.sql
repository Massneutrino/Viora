-- CreateTable
CREATE TABLE "PilotLead" (
    "id" TEXT NOT NULL,
    "leadType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "organisationName" TEXT,
    "roleTitle" TEXT,
    "postcode" TEXT,
    "workerRoleTypes" TEXT[],
    "complianceReadiness" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PilotLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PilotLead_leadType_createdAt_idx" ON "PilotLead"("leadType", "createdAt");

-- CreateIndex
CREATE INDEX "PilotLead_status_createdAt_idx" ON "PilotLead"("status", "createdAt");
