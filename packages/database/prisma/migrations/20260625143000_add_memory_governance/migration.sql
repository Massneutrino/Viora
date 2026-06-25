ALTER TYPE "MemorySourceType" ADD VALUE IF NOT EXISTS 'connector_import';

CREATE TYPE "MemoryUseScope" AS ENUM (
  'profile',
  'intake_default',
  'ranking_signal',
  'briefing',
  'explanation',
  'connector_export'
);

CREATE TYPE "MemorySensitivity" AS ENUM (
  'standard',
  'sensitive'
);

CREATE TYPE "MemoryConnectorType" AS ENUM (
  'manual_json',
  'institutional_kb',
  'personal_ai_memory',
  'mcp_adapter'
);

ALTER TABLE "MemoryEntry"
  ADD COLUMN "useScopes" "MemoryUseScope"[] NOT NULL DEFAULT ARRAY[]::"MemoryUseScope"[],
  ADD COLUMN "sensitivity" "MemorySensitivity" NOT NULL DEFAULT 'standard',
  ADD COLUMN "sourceLabel" TEXT,
  ADD COLUMN "expiresAt" TIMESTAMP(3),
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "connectorType" "MemoryConnectorType",
  ADD COLUMN "connectorRef" TEXT,
  ADD COLUMN "connectorMetadata" JSONB;

UPDATE "MemoryEntry"
SET "useScopes" = ARRAY['intake_default','ranking_signal','briefing','explanation','connector_export']::"MemoryUseScope"[]
WHERE "ownerType" = 'organisation' AND cardinality("useScopes") = 0;

UPDATE "MemoryEntry"
SET "useScopes" = ARRAY['profile']::"MemoryUseScope"[]
WHERE "ownerType" = 'worker' AND cardinality("useScopes") = 0;

UPDATE "MemoryEntry"
SET "sensitivity" = 'sensitive'
WHERE "visibility" = 'private';

UPDATE "MemoryEntry"
SET "deletedAt" = "updatedAt"
WHERE "status" = 'deleted' AND "deletedAt" IS NULL;

CREATE INDEX "MemoryEntry_connectorType_connectorRef_idx" ON "MemoryEntry"("connectorType", "connectorRef");
