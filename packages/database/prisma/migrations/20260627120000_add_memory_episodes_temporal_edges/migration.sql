-- Add a learning-oriented episodic projection for Fit Graph evidence.
CREATE TABLE "MemoryEpisode" (
    "id" TEXT NOT NULL,
    "ownerType" "MemoryOwnerType" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "subjectType" "MemorySubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "kind" "MemoryKind" NOT NULL,
    "label" TEXT NOT NULL,
    "sourceType" "MemorySourceType" NOT NULL,
    "sourceRefType" TEXT,
    "sourceRefId" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "purpose" "MemoryUseScope",
    "audience" TEXT,
    "outcome" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "affectedMemoryIds" TEXT[],
    "affectedEdgeIds" TEXT[],
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryEpisode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MemoryEpisode_ownerType_ownerId_occurredAt_idx" ON "MemoryEpisode"("ownerType", "ownerId", "occurredAt");
CREATE INDEX "MemoryEpisode_subjectType_subjectId_occurredAt_idx" ON "MemoryEpisode"("subjectType", "subjectId", "occurredAt");
CREATE INDEX "MemoryEpisode_sourceRefType_sourceRefId_idx" ON "MemoryEpisode"("sourceRefType", "sourceRefId");
CREATE INDEX "MemoryEpisode_entityType_entityId_idx" ON "MemoryEpisode"("entityType", "entityId");

-- Add temporal/evidence metadata to the existing operational Fit Graph edge.
ALTER TABLE "MemoryEdge"
  ADD COLUMN "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "validUntil" TIMESTAMP(3),
  ADD COLUMN "lastEvidenceAt" TIMESTAMP(3),
  ADD COLUMN "decayPolicy" TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN "supersededByEdgeId" TEXT,
  ADD COLUMN "evidenceRefs" JSONB;

CREATE INDEX "MemoryEdge_lastEvidenceAt_idx" ON "MemoryEdge"("lastEvidenceAt");
CREATE INDEX "MemoryEdge_supersededByEdgeId_idx" ON "MemoryEdge"("supersededByEdgeId");
