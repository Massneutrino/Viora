CREATE TABLE "MemoryReviewSuggestion" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "ownerType" "MemoryOwnerType" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "subjectType" "MemorySubjectType",
    "subjectId" TEXT,
    "affectedMemoryIds" TEXT[],
    "affectedEdgeIds" TEXT[],
    "title" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "outputs" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,

    CONSTRAINT "MemoryReviewSuggestion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MemoryReviewSuggestion_status_createdAt_idx" ON "MemoryReviewSuggestion"("status", "createdAt");
CREATE INDEX "MemoryReviewSuggestion_ownerType_ownerId_status_idx" ON "MemoryReviewSuggestion"("ownerType", "ownerId", "status");
