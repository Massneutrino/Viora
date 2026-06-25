CREATE TYPE "MemoryOwnerType" AS ENUM ('organisation', 'worker');

CREATE TYPE "MemorySubjectType" AS ENUM ('organisation', 'site', 'worker', 'role', 'booking_request', 'booking', 'shift', 'relationship');

CREATE TYPE "MemoryKind" AS ENUM ('preference', 'instruction', 'pattern', 'risk', 'fit_signal', 'briefing_note', 'availability_signal', 'pay_signal', 'feedback_summary');

CREATE TYPE "MemorySourceType" AS ENUM ('user_entered', 'agent_inferred', 'system_event', 'feedback');

CREATE TYPE "MemoryVisibility" AS ENUM ('private', 'operational', 'shared');

CREATE TYPE "MemoryStatus" AS ENUM ('pending_confirmation', 'active', 'archived', 'deleted');

CREATE TABLE "MemoryEntry" (
    "id" TEXT NOT NULL,
    "ownerType" "MemoryOwnerType" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "subjectType" "MemorySubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "kind" "MemoryKind" NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "value" JSONB,
    "sourceType" "MemorySourceType" NOT NULL,
    "sourceRefType" TEXT,
    "sourceRefId" TEXT,
    "visibility" "MemoryVisibility" NOT NULL DEFAULT 'operational',
    "status" "MemoryStatus" NOT NULL DEFAULT 'pending_confirmation',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "confirmedAt" TIMESTAMP(3),
    "confirmedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemoryEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MemoryEdge" (
    "id" TEXT NOT NULL,
    "ownerType" "MemoryOwnerType" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "fromType" "MemorySubjectType" NOT NULL,
    "fromId" TEXT NOT NULL,
    "toType" "MemorySubjectType" NOT NULL,
    "toId" TEXT NOT NULL,
    "kind" "MemoryKind" NOT NULL,
    "label" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "evidenceCount" INTEGER NOT NULL DEFAULT 1,
    "sourceType" "MemorySourceType" NOT NULL,
    "sourceRefType" TEXT,
    "sourceRefId" TEXT,
    "visibility" "MemoryVisibility" NOT NULL DEFAULT 'operational',
    "status" "MemoryStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemoryEdge_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MemoryEntry_ownerType_ownerId_status_idx" ON "MemoryEntry"("ownerType", "ownerId", "status");
CREATE INDEX "MemoryEntry_subjectType_subjectId_idx" ON "MemoryEntry"("subjectType", "subjectId");
CREATE INDEX "MemoryEntry_key_idx" ON "MemoryEntry"("key");
CREATE INDEX "MemoryEntry_sourceRefType_sourceRefId_idx" ON "MemoryEntry"("sourceRefType", "sourceRefId");

CREATE UNIQUE INDEX "MemoryEdge_ownerType_ownerId_fromType_fromId_toType_toId_kind_key" ON "MemoryEdge"("ownerType", "ownerId", "fromType", "fromId", "toType", "toId", "kind");
CREATE INDEX "MemoryEdge_ownerType_ownerId_status_idx" ON "MemoryEdge"("ownerType", "ownerId", "status");
CREATE INDEX "MemoryEdge_fromType_fromId_idx" ON "MemoryEdge"("fromType", "fromId");
CREATE INDEX "MemoryEdge_toType_toId_idx" ON "MemoryEdge"("toType", "toId");
CREATE INDEX "MemoryEdge_kind_idx" ON "MemoryEdge"("kind");
