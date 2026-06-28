import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { Prisma } from "@viora/database";
import type {
  MemoryConnectorType,
  MemoryKind,
  MemoryOwnerType,
  MemorySensitivity,
  MemoryUseScope,
  MemoryVisibility,
} from "@viora/domain";
import { validateMemoryValue } from "@viora/domain";
import { writeAuditEvent } from "../audit.js";

const subjectTypeSchema = z.enum([
  "organisation",
  "site",
  "worker",
  "role",
  "booking_request",
  "booking",
  "shift",
  "relationship",
]);
const kindSchema = z.enum([
  "preference",
  "instruction",
  "pattern",
  "risk",
  "fit_signal",
  "briefing_note",
  "availability_signal",
  "pay_signal",
  "feedback_summary",
]);
const visibilitySchema = z.enum(["private", "operational", "shared"]);
const statusSchema = z.enum(["pending_confirmation", "active", "archived", "deleted"]);
const useScopeSchema = z.enum([
  "profile",
  "intake_default",
  "ranking_signal",
  "briefing",
  "explanation",
  "connector_export",
]);
const sensitivitySchema = z.enum(["standard", "sensitive"]);
const connectorTypeSchema = z.enum(["manual_json", "institutional_kb", "personal_ai_memory", "mcp_adapter"]);

const governanceSchema = {
  useScopes: z.array(useScopeSchema).max(6).optional(),
  sensitivity: sensitivitySchema.optional(),
  sourceLabel: z.string().min(1).max(180).optional(),
  expiresAt: z.coerce.date().nullable().optional(),
  connectorType: connectorTypeSchema.nullable().optional(),
  connectorRef: z.string().min(1).max(240).nullable().optional(),
  connectorMetadata: z.record(z.string(), z.unknown()).nullable().optional(),
};

const createMemorySchema = z
  .object({
    subjectType: subjectTypeSchema.optional(),
    subjectId: z.string().min(1).optional(),
    kind: kindSchema,
    key: z.string().min(1).max(120).optional(),
    title: z.string().min(1).max(180),
    content: z.string().min(1).max(2000),
    value: z.record(z.string(), z.unknown()).optional(),
    visibility: visibilitySchema.optional(),
    status: statusSchema.optional(),
    confidence: z.number().min(0).max(1).default(1),
    actorId: z.string().min(1).optional(),
    ...governanceSchema,
  })
  .strict();

const updateMemorySchema = z
  .object({
    title: z.string().min(1).max(180).optional(),
    content: z.string().min(1).max(2000).optional(),
    value: z.record(z.string(), z.unknown()).nullable().optional(),
    visibility: visibilitySchema.optional(),
    status: statusSchema.optional(),
    confidence: z.number().min(0).max(1).optional(),
    actorId: z.string().min(1).optional(),
    ...governanceSchema,
  })
  .strict();

const importItemSchema = createMemorySchema.omit({ actorId: true, status: true }).extend({
  connectorType: connectorTypeSchema,
  connectorRef: z.string().min(1).max(240),
});

const importMemorySchema = z
  .object({
    actorId: z.string().min(1).optional(),
    connectorType: connectorTypeSchema,
    connectorRef: z.string().min(1).max(240).optional(),
    sourceLabel: z.string().min(1).max(180).optional(),
    items: z.array(importItemSchema).min(1).max(20),
  })
  .strict();

const consolidationDecisionSchema = z
  .object({
    adminId: z.string().min(1).default("admin"),
  })
  .strict();

const CONNECTORS: Array<{
  type: MemoryConnectorType;
  name: string;
  direction: "import_export" | "import" | "export";
  liveSync: false;
}> = [
  { type: "manual_json", name: "Manual JSON", direction: "import_export", liveSync: false },
  { type: "institutional_kb", name: "Institutional knowledge base", direction: "import_export", liveSync: false },
  { type: "personal_ai_memory", name: "Personal AI memory", direction: "import_export", liveSync: false },
  { type: "mcp_adapter", name: "MCP memory adapter", direction: "import_export", liveSync: false },
];

const ORG_SCOPES: MemoryUseScope[] = [
  "intake_default",
  "ranking_signal",
  "briefing",
  "explanation",
  "connector_export",
];
const WORKER_OPERATIONAL_SCOPES: MemoryUseScope[] = ["profile", "ranking_signal", "briefing", "explanation"];

function defaultSubject(ownerType: MemoryOwnerType) {
  return ownerType === "organisation" ? "organisation" : "worker";
}

function keyFromTitle(kind: string, title: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return `${kind}_${slug || "memory"}`;
}

function uniqueScopes(scopes: MemoryUseScope[]) {
  return [...new Set(scopes)];
}

function defaultVisibility(ownerType: MemoryOwnerType, connectorType?: MemoryConnectorType | null): MemoryVisibility {
  if (ownerType === "worker" || connectorType === "personal_ai_memory") return "private";
  return "operational";
}

function defaultUseScopes(
  ownerType: MemoryOwnerType,
  visibility: MemoryVisibility,
  sourceType: "user_entered" | "connector_import",
  provided?: MemoryUseScope[],
): MemoryUseScope[] {
  if (provided?.length) return uniqueScopes(provided);
  if (ownerType === "organisation") return ORG_SCOPES;
  if (visibility === "private") return sourceType === "connector_import" ? ["profile", "connector_export"] : ["profile"];
  return WORKER_OPERATIONAL_SCOPES;
}

function defaultSensitivity(visibility: MemoryVisibility, provided?: MemorySensitivity): MemorySensitivity {
  if (provided) return provided;
  return visibility === "private" ? "sensitive" : "standard";
}

function normalizeMemoryInput(
  ownerType: MemoryOwnerType,
  body: z.infer<typeof createMemorySchema>,
  sourceType: "user_entered" | "connector_import",
) {
  const visibility = body.visibility ?? defaultVisibility(ownerType, body.connectorType ?? null);
  const useScopes = defaultUseScopes(ownerType, visibility, sourceType, body.useScopes as MemoryUseScope[] | undefined);
  const sensitivity = defaultSensitivity(visibility, body.sensitivity as MemorySensitivity | undefined);
  const status = sourceType === "connector_import" ? "pending_confirmation" : (body.status ?? "active");
  return { visibility, useScopes, sensitivity, status };
}

function parseMemoryBody<T extends { kind?: MemoryKind; value?: Record<string, unknown> | null }>(
  body: T,
  existingKind?: MemoryKind,
) {
  const kind = body.kind ?? existingKind;
  if (!kind || body.value === undefined || body.value === null) return body;
  const validation = validateMemoryValue(kind, body.value);
  if (!validation.ok) {
    const error = new Error(`Invalid memory value: ${validation.errors.join(" ")}`) as Error & {
      statusCode?: number;
      validation?: { path: string[]; message: string }[];
    };
    error.statusCode = 400;
    error.validation = validation.errors.map((message) => ({ path: ["value"], message }));
    throw error;
  }
  return body;
}

async function assertOwnerExists(app: Parameters<FastifyPluginAsync>[0], ownerType: MemoryOwnerType, ownerId: string) {
  if (ownerType === "organisation") {
    const org = await app.db.organisation.findUnique({ where: { id: ownerId }, select: { id: true } });
    return Boolean(org);
  }
  const worker = await app.db.worker.findUnique({ where: { id: ownerId }, select: { id: true } });
  return Boolean(worker);
}

async function listMemories(
  app: Parameters<FastifyPluginAsync>[0],
  ownerType: MemoryOwnerType,
  ownerId: string,
  query: Record<string, unknown>,
) {
  const status = typeof query.status === "string" ? statusSchema.safeParse(query.status) : null;
  const includeDeleted = query.includeDeleted === "true";
  const scope = typeof query.scope === "string" ? useScopeSchema.safeParse(query.scope) : null;
  const kind = typeof query.kind === "string" ? kindSchema.safeParse(query.kind) : null;
  const visibility = typeof query.visibility === "string" ? visibilitySchema.safeParse(query.visibility) : null;
  const sensitivity = typeof query.sensitivity === "string" ? sensitivitySchema.safeParse(query.sensitivity) : null;
  const connectorType =
    typeof query.connectorType === "string" ? connectorTypeSchema.safeParse(query.connectorType) : null;
  const search = typeof query.search === "string" ? query.search.trim().slice(0, 120) : "";
  return app.db.memoryEntry.findMany({
    where: {
      ownerType,
      ownerId,
      ...(scope?.success ? { useScopes: { has: scope.data } } : {}),
      ...(kind?.success ? { kind: kind.data } : {}),
      ...(visibility?.success ? { visibility: visibility.data } : {}),
      ...(sensitivity?.success ? { sensitivity: sensitivity.data } : {}),
      ...(connectorType?.success ? { connectorType: connectorType.data } : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: "insensitive" } },
              { content: { contains: search, mode: "insensitive" } },
              { sourceLabel: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(status?.success
        ? { status: status.data }
        : includeDeleted
          ? {}
          : { status: { in: ["active", "pending_confirmation"] } }),
    },
    orderBy: [{ status: "asc" }, { confidence: "desc" }, { updatedAt: "desc" }],
    take: 100,
  });
}

async function createMemory(
  app: Parameters<FastifyPluginAsync>[0],
  ownerType: MemoryOwnerType,
  ownerId: string,
  body: z.infer<typeof createMemorySchema>,
  sourceType: "user_entered" | "connector_import" = "user_entered",
  actorType: "user" | "system" = "user",
) {
  parseMemoryBody(body);
  const actorId = body.actorId ?? ownerId;
  const normalized = normalizeMemoryInput(ownerType, body, sourceType);
  return app.db.$transaction(async (tx) => {
    const memory = await tx.memoryEntry.create({
      data: {
        ownerType,
        ownerId,
        subjectType: body.subjectType ?? defaultSubject(ownerType),
        subjectId: body.subjectId ?? ownerId,
        kind: body.kind,
        key: body.key ?? keyFromTitle(body.kind, body.title),
        title: body.title,
        content: body.content,
        value: body.value as Prisma.InputJsonValue | undefined,
        sourceType,
        sourceRefType: body.connectorType ? "MemoryConnector" : undefined,
        sourceRefId: body.connectorRef ?? undefined,
        visibility: normalized.visibility,
        status: normalized.status,
        useScopes: normalized.useScopes,
        sensitivity: normalized.sensitivity,
        sourceLabel: body.sourceLabel ?? (sourceType === "connector_import" ? "Connector import" : "User entered"),
        expiresAt: body.expiresAt ?? undefined,
        connectorType: body.connectorType ?? undefined,
        connectorRef: body.connectorRef ?? undefined,
        connectorMetadata: body.connectorMetadata as Prisma.InputJsonValue | undefined,
        confidence: body.confidence,
        confirmedAt: normalized.status === "active" ? new Date() : undefined,
        confirmedBy: normalized.status === "active" ? actorId : undefined,
      },
    });
    await writeAuditEvent(tx, {
      actorType,
      actorId,
      action: sourceType === "connector_import" ? "memory.import" : "memory.create",
      entityType: "MemoryEntry",
      entityId: memory.id,
      inputs: body as Prisma.InputJsonValue,
      outputs: {
        memoryId: memory.id,
        ownerType,
        ownerId,
        status: memory.status,
        visibility: memory.visibility,
        useScopes: memory.useScopes,
      } as Prisma.InputJsonValue,
      outcome: memory.status,
    });
    return memory;
  });
}

async function updateMemory(
  app: Parameters<FastifyPluginAsync>[0],
  ownerType: MemoryOwnerType,
  ownerId: string,
  memoryId: string,
  body: z.infer<typeof updateMemorySchema>,
) {
  const existing = await app.db.memoryEntry.findUnique({ where: { id: memoryId } });
  if (!existing || existing.ownerType !== ownerType || existing.ownerId !== ownerId) return null;
  parseMemoryBody(body, existing.kind as MemoryKind);
  const actorId = body.actorId ?? ownerId;
  const data: Prisma.MemoryEntryUpdateInput = {};
  if (body.title !== undefined) data.title = body.title;
  if (body.content !== undefined) data.content = body.content;
  if (body.value !== undefined) data.value = body.value as Prisma.InputJsonValue;
  if (body.visibility !== undefined) data.visibility = body.visibility;
  if (body.confidence !== undefined) data.confidence = body.confidence;
  if (body.useScopes !== undefined) data.useScopes = uniqueScopes(body.useScopes as MemoryUseScope[]);
  if (body.sensitivity !== undefined) data.sensitivity = body.sensitivity;
  if (body.sourceLabel !== undefined) data.sourceLabel = body.sourceLabel;
  if (body.expiresAt !== undefined) data.expiresAt = body.expiresAt;
  if (body.connectorType !== undefined) data.connectorType = body.connectorType;
  if (body.connectorRef !== undefined) data.connectorRef = body.connectorRef;
  if (body.connectorMetadata !== undefined) data.connectorMetadata = body.connectorMetadata as Prisma.InputJsonValue;
  if (body.status !== undefined) {
    data.status = body.status;
    if (body.status === "active") {
      data.confirmedAt = new Date();
      data.confirmedBy = actorId;
    }
    if (body.status === "deleted") {
      data.deletedAt = new Date();
      data.content = "[deleted]";
      data.value = Prisma.JsonNull;
    }
  }

  return app.db.$transaction(async (tx) => {
    const memory = await tx.memoryEntry.update({ where: { id: memoryId }, data });
    await writeAuditEvent(tx, {
      actorType: "user",
      actorId,
      action: "memory.update",
      entityType: "MemoryEntry",
      entityId: memory.id,
      inputs: body as Prisma.InputJsonValue,
      outputs: {
        updatedFields: Object.keys(body),
        status: memory.status,
        visibility: memory.visibility,
        useScopes: memory.useScopes,
      } as Prisma.InputJsonValue,
      outcome: "updated",
    });
    return memory;
  });
}

async function softDeleteMemory(
  app: Parameters<FastifyPluginAsync>[0],
  ownerType: MemoryOwnerType,
  ownerId: string,
  memoryId: string,
  actorId: string,
) {
  const existing = await app.db.memoryEntry.findUnique({ where: { id: memoryId } });
  if (!existing || existing.ownerType !== ownerType || existing.ownerId !== ownerId) return null;
  return app.db.$transaction(async (tx) => {
    const linkedEdgeWhere: Prisma.MemoryEdgeWhereInput[] = [{ sourceRefType: "MemoryEntry", sourceRefId: memoryId }];
    if (existing.sourceRefType && existing.sourceRefId) {
      linkedEdgeWhere.push({ sourceRefType: existing.sourceRefType, sourceRefId: existing.sourceRefId });
    }
    const archivedEdges = await tx.memoryEdge.updateMany({
      where: {
        ownerType,
        ownerId,
        status: "active",
        OR: linkedEdgeWhere,
      },
      data: { status: "archived" },
    });
    const memory = await tx.memoryEntry.update({
      where: { id: memoryId },
      data: {
        status: "deleted",
        content: "[deleted]",
        value: Prisma.JsonNull,
        deletedAt: new Date(),
      },
    });
    await writeAuditEvent(tx, {
      actorType: "user",
      actorId,
      action: "memory.delete",
      entityType: "MemoryEntry",
      entityId: memory.id,
      inputs: { memoryId } as Prisma.InputJsonValue,
      outputs: { status: memory.status, archivedEdges: archivedEdges.count } as Prisma.InputJsonValue,
      outcome: "deleted",
    });
    return memory;
  });
}

function routeOwner(params: { ownerType: "organisations" | "workers"; id: string }) {
  return {
    ownerType: (params.ownerType === "organisations" ? "organisation" : "worker") as MemoryOwnerType,
    ownerId: params.id,
  };
}

function slugText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function proceduralPlaybookKey(input: {
  organisationId: string;
  siteId?: string;
  roleType?: string;
  missingFields: string[];
}) {
  return [
    "procedural_playbook",
    "intake",
    input.organisationId,
    input.siteId ?? "any_site",
    input.roleType ?? "any_role",
    [...input.missingFields].sort().join("+"),
  ].join(":");
}

function postShiftLearningKey(action: string, input: {
  ownerId: string;
  siteId?: string;
  workerId?: string;
  roleType?: string;
}) {
  return [
    action,
    input.ownerId,
    input.siteId ?? "any_site",
    input.workerId ?? "any_worker",
    input.roleType ?? "any_role",
  ].join(":");
}

function suggestionKey(action: string, ids: string[]) {
  return `${action}:${[...ids].sort().join(":")}`;
}

async function upsertSuggestion(
  app: Parameters<FastifyPluginAsync>[0],
  input: {
    action: string;
    ownerType: MemoryOwnerType;
    ownerId: string;
    subjectType?: z.infer<typeof subjectTypeSchema>;
    subjectId?: string;
    affectedMemoryIds?: string[];
    affectedEdgeIds?: string[];
    title: string;
    explanation: string;
    inputs: Record<string, unknown>;
  },
) {
  const key =
    typeof input.inputs.key === "string"
      ? input.inputs.key
      : suggestionKey(input.action, [...(input.affectedMemoryIds ?? []), ...(input.affectedEdgeIds ?? [])]);
  const existing = await app.db.memoryReviewSuggestion.findFirst({
    where: { status: "pending", inputs: { path: ["key"], equals: key } },
  });
  const data = {
    action: input.action,
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    affectedMemoryIds: input.affectedMemoryIds ?? [],
    affectedEdgeIds: input.affectedEdgeIds ?? [],
    title: input.title,
    explanation: input.explanation,
    inputs: { ...input.inputs, key } as Prisma.InputJsonValue,
  };
  if (existing) {
    return app.db.memoryReviewSuggestion.update({ where: { id: existing.id }, data });
  }
  return app.db.memoryReviewSuggestion.create({ data });
}

function contradictionGroupKey(memory: { ownerType: string; ownerId: string; subjectType: string; subjectId: string; kind: string }) {
  return `${memory.ownerType}:${memory.ownerId}:${memory.subjectType}:${memory.subjectId}:${memory.kind}`;
}

async function analyzeMemoryConsolidation(app: Parameters<FastifyPluginAsync>[0]) {
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000);
  const proceduralCutoff = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  const [activeMemories, influenceEvents, edges, recentEpisodes, intakeClarifications] = await Promise.all([
    app.db.memoryEntry.findMany({
      where: { status: "active" },
      orderBy: [{ updatedAt: "desc" }],
      take: 300,
    }),
    app.db.auditEvent.findMany({
      where: { action: "memory.influence", createdAt: { gte: staleCutoff } },
      orderBy: [{ createdAt: "desc" }],
      take: 500,
    }),
    app.db.memoryEdge.findMany({
      where: { status: "active" },
      orderBy: [{ updatedAt: "desc" }],
      take: 300,
    }),
    app.db.memoryEpisode.findMany({
      where: { occurredAt: { gte: proceduralCutoff } },
      orderBy: [{ occurredAt: "desc" }],
      take: 300,
    }),
    app.db.auditEvent.findMany({
      where: { action: "intake.clarify", createdAt: { gte: proceduralCutoff }, outcome: "clarification_required" },
      orderBy: [{ createdAt: "desc" }],
      take: 1000,
    }),
  ]);

  const usedMemoryIds = new Set<string>();
  for (const event of influenceEvents) {
    const inputs = event.inputs as Record<string, unknown>;
    const ids = Array.isArray(inputs.memoryIds) ? inputs.memoryIds : [];
    for (const id of ids) if (typeof id === "string") usedMemoryIds.add(id);
  }

  for (const memory of activeMemories) {
    const isExpired = memory.expiresAt && memory.expiresAt <= now;
    const isUnused = !usedMemoryIds.has(memory.id) && memory.updatedAt < staleCutoff && memory.visibility !== "private";
    if (!isExpired && !isUnused) continue;
    await upsertSuggestion(app, {
      action: "archive",
      ownerType: memory.ownerType,
      ownerId: memory.ownerId,
      subjectType: memory.subjectType,
      subjectId: memory.subjectId,
      affectedMemoryIds: [memory.id],
      title: `Archive stale memory: ${memory.title}`,
      explanation: isExpired
        ? "This active memory is past its expiry date and should be archived unless it is still valid."
        : "This active memory has not influenced recent actions and is old enough to review for archive.",
      inputs: { reason: isExpired ? "expired" : "unused_active", staleCutoff: staleCutoff.toISOString() },
    });
  }

  const byDuplicateKey = new Map<string, typeof activeMemories>();
  for (const memory of activeMemories) {
    const key = `${contradictionGroupKey(memory)}:${slugText(memory.key || memory.title).slice(0, 48)}`;
    byDuplicateKey.set(key, [...(byDuplicateKey.get(key) ?? []), memory]);
  }
  for (const group of byDuplicateKey.values()) {
    if (group.length < 2) continue;
    const first = group[0];
    if (!first) continue;
    await upsertSuggestion(app, {
      action: "merge",
      ownerType: first.ownerType,
      ownerId: first.ownerId,
      subjectType: first.subjectType,
      subjectId: first.subjectId,
      affectedMemoryIds: group.map((memory) => memory.id),
      title: `Merge duplicate memories: ${first.title}`,
      explanation: "These active memories share the same owner, subject, kind and key/title shape. Keep the strongest row and archive the duplicates.",
      inputs: { reason: "duplicate_key", memoryIds: group.map((memory) => memory.id) },
    });
  }

  const contradictionKinds = new Set<MemoryKind>(["availability_signal", "pay_signal", "instruction", "preference", "fit_signal"]);
  const byContradictionKey = new Map<string, typeof activeMemories>();
  for (const memory of activeMemories) {
    if (!contradictionKinds.has(memory.kind as MemoryKind)) continue;
    const key = contradictionGroupKey(memory);
    byContradictionKey.set(key, [...(byContradictionKey.get(key) ?? []), memory]);
  }
  for (const group of byContradictionKey.values()) {
    const normalized = new Set(group.map((memory) => slugText(`${memory.title} ${memory.content}`).slice(0, 120)));
    if (group.length < 2 || normalized.size < 2) continue;
    const first = group[0];
    if (!first) continue;
    await upsertSuggestion(app, {
      action: "needs_human_review",
      ownerType: first.ownerType,
      ownerId: first.ownerId,
      subjectType: first.subjectType,
      subjectId: first.subjectId,
      affectedMemoryIds: group.map((memory) => memory.id),
      title: `Review conflicting ${first.kind} memories`,
      explanation: "Multiple active memories for the same owner, subject and kind appear to disagree. A human should confirm which one V can rely on.",
      inputs: { reason: "possible_contradiction", memoryIds: group.map((memory) => memory.id) },
    });
  }

  for (const edge of edges) {
    const oldEvidence = edge.lastEvidenceAt && edge.lastEvidenceAt < staleCutoff && edge.evidenceCount <= 1;
    const nearZero = Math.abs(edge.weight) < 0.08 && edge.confidence < 0.55;
    if (!oldEvidence && !nearZero) continue;
    await upsertSuggestion(app, {
      action: "supersede",
      ownerType: edge.ownerType,
      ownerId: edge.ownerId,
      subjectType: edge.toType,
      subjectId: edge.toId,
      affectedEdgeIds: [edge.id],
      title: `Archive weak edge: ${edge.label}`,
      explanation: "This active graph edge is old or weak enough to review for archive so it stops shaping temporal fit scoring.",
      inputs: { reason: oldEvidence ? "old_low_evidence_edge" : "weak_low_confidence_edge", edgeId: edge.id },
    });
  }

  const episodeGroups = new Map<string, typeof recentEpisodes>();
  for (const episode of recentEpisodes) {
    if (!episode.affectedEdgeIds.length) continue;
    const key = `${episode.ownerType}:${episode.ownerId}:${episode.subjectType}:${episode.subjectId}:${episode.kind}:${episode.outcome}`;
    episodeGroups.set(key, [...(episodeGroups.get(key) ?? []), episode]);
  }
  for (const group of episodeGroups.values()) {
    if (group.length < 3) continue;
    const first = group[0];
    if (!first) continue;
    await upsertSuggestion(app, {
      action: "confirm_pattern",
      ownerType: first.ownerType,
      ownerId: first.ownerId,
      subjectType: first.subjectType,
      subjectId: first.subjectId,
      affectedEdgeIds: [...new Set(group.flatMap((episode) => episode.affectedEdgeIds))],
      title: `Confirm repeated pattern: ${first.label}`,
      explanation: "Repeated episodes suggest a durable memory candidate. Confirmation creates a pending memory rather than silently changing ranking.",
      inputs: {
        reason: "repeated_episode_pattern",
        episodeIds: group.map((episode) => episode.id),
        count: group.length,
      },
    });
  }

  const existingPlaybookKeys = new Set(
    activeMemories
      .filter((memory) => memory.kind === "pattern")
      .map((memory) => jsonRecord(memory.value))
      .filter((value) => value.valueType === "procedural_playbook" && typeof value.key === "string")
      .map((value) => String(value.key)),
  );
  const intakeGroups = new Map<
    string,
    Array<{
      id: string;
      organisationId: string;
      siteId?: string;
      roleType?: string;
      missingFields: string[];
      rawInput?: string;
      createdAt: Date;
    }>
  >();
  for (const event of intakeClarifications) {
    const inputs = jsonRecord(event.inputs);
    const intent = jsonRecord(inputs.intent);
    const organisationId = typeof inputs.organisationId === "string" ? inputs.organisationId : undefined;
    const missingFields = stringList(inputs.missingFields).sort();
    if (!organisationId || missingFields.length === 0) continue;
    const siteId = typeof intent.siteId === "string" ? intent.siteId : undefined;
    const roleType = typeof intent.roleType === "string" ? intent.roleType : undefined;
    const key = proceduralPlaybookKey({ organisationId, siteId, roleType, missingFields });
    intakeGroups.set(key, [
      ...(intakeGroups.get(key) ?? []),
      {
        id: event.id,
        organisationId,
        siteId,
        roleType,
        missingFields,
        rawInput: typeof inputs.rawInput === "string" ? inputs.rawInput : undefined,
        createdAt: event.createdAt,
      },
    ]);
  }
  for (const [key, group] of intakeGroups) {
    if (group.length < 3 || existingPlaybookKeys.has(key)) continue;
    const first = group[0];
    if (!first) continue;
    const missing = first.missingFields.join(", ");
    const triggerParts = [
      first.roleType ? `role ${first.roleType}` : "any role",
      first.siteId ? `site ${first.siteId}` : "any site",
      `missing ${missing}`,
    ];
    const guidance = `When ${triggerParts.join(" / ")} recurs for this organisation, ask a concise follow-up for ${missing} before confirming the booking. Treat this as clarification guidance only; do not change compliance, ranking, or employer guardrails.`;
    await upsertSuggestion(app, {
      action: "propose_playbook",
      ownerType: "organisation",
      ownerId: first.organisationId,
      subjectType: first.siteId ? "site" : "organisation",
      subjectId: first.siteId ?? first.organisationId,
      title: `Approve intake playbook: ${missing}`,
      explanation: `V saw ${group.length} similar intake clarifications in the last 60 days. Approval creates an active intake guidance memory, not a ranking or compliance rule.`,
      inputs: {
        key,
        reason: "repeated_intake_clarification",
        trigger: {
          organisationId: first.organisationId,
          siteId: first.siteId,
          roleType: first.roleType,
          missingFields: first.missingFields,
        },
        guidance,
        eventIds: group.map((item) => item.id),
        sampleInputs: group.map((item) => item.rawInput).filter(Boolean).slice(0, 3),
        count: group.length,
        windowDays: 60,
      },
    });
  }

  const fitFeedbackGroups = new Map<
    string,
    Array<{
      episodeId: string;
      edgeIds: string[];
      workerId: string;
      organisationId: string;
      siteId: string;
      roleType?: string;
      rating: number;
      comment?: string;
    }>
  >();
  const briefingFeedbackGroups = new Map<
    string,
    Array<{
      episodeId: string;
      edgeIds: string[];
      organisationId: string;
      siteId: string;
      workerId: string;
      roleType?: string;
      rating: number | null;
      comment: string;
    }>
  >();
  for (const episode of recentEpisodes) {
    if (episode.sourceRefType !== "Feedback") continue;
    const metadata = jsonRecord(episode.metadata);
    if (metadata.contested === true) continue;
    const siteId = typeof metadata.siteId === "string" ? metadata.siteId : episode.subjectId;
    const roleType = typeof metadata.roleType === "string" ? metadata.roleType : undefined;
    const workerId = typeof metadata.workerId === "string" ? metadata.workerId : undefined;
    const organisationId = typeof metadata.organisationId === "string" ? metadata.organisationId : undefined;
    const rating = typeof metadata.rating === "number" ? metadata.rating : null;
    const comment = typeof metadata.comment === "string" ? metadata.comment.trim() : "";
    const feedbackFromType = typeof metadata.feedbackFromType === "string" ? metadata.feedbackFromType : "";

    if (feedbackFromType === "organisation" && episode.ownerType === "worker" && workerId && organisationId && rating !== null && rating >= 4) {
      const key = postShiftLearningKey("propose_fit_feedback", { ownerId: workerId, siteId, workerId, roleType });
      fitFeedbackGroups.set(key, [
        ...(fitFeedbackGroups.get(key) ?? []),
        { episodeId: episode.id, edgeIds: episode.affectedEdgeIds, workerId, organisationId, siteId, roleType, rating, comment },
      ]);
    }

    if (feedbackFromType === "worker" && episode.ownerType === "organisation" && workerId && organisationId && comment.length >= 12) {
      const briefingTerms = /\b(brief|briefing|prepare|prepared|lesson|plan|behaviour|behavior|access|arrival|parking|reception|gate|sen|send)\b/i;
      if (!briefingTerms.test(comment)) continue;
      const key = postShiftLearningKey("propose_briefing_note", { ownerId: organisationId, siteId, roleType });
      briefingFeedbackGroups.set(key, [
        ...(briefingFeedbackGroups.get(key) ?? []),
        { episodeId: episode.id, edgeIds: episode.affectedEdgeIds, organisationId, siteId, workerId, roleType, rating, comment },
      ]);
    }
  }

  for (const [key, group] of fitFeedbackGroups) {
    if (group.length < 2) continue;
    const first = group[0];
    if (!first) continue;
    const averageRating = group.reduce((sum, item) => sum + item.rating, 0) / group.length;
    const content = `Employer feedback repeatedly rated this worker strongly at this site${first.roleType ? ` for ${first.roleType}` : ""}. Review before using as an operational fit signal.`;
    await upsertSuggestion(app, {
      action: "propose_fit_feedback",
      ownerType: "worker",
      ownerId: first.workerId,
      subjectType: "site",
      subjectId: first.siteId,
      affectedEdgeIds: [...new Set(group.flatMap((item) => item.edgeIds))],
      title: "Review post-shift fit feedback",
      explanation: `${group.length} non-contested employer feedback items suggest a repeat fit signal. Approval creates a pending worker memory for confirmation, not an active ranking rule.`,
      inputs: {
        key,
        reason: "repeated_positive_employer_feedback",
        workerId: first.workerId,
        organisationId: first.organisationId,
        siteId: first.siteId,
        roleType: first.roleType,
        ratingAverage: Number(averageRating.toFixed(2)),
        content,
        episodeIds: group.map((item) => item.episodeId),
        comments: group.map((item) => item.comment).filter(Boolean).slice(0, 3),
        count: group.length,
      },
    });
  }

  for (const [key, group] of briefingFeedbackGroups) {
    if (group.length < 2) continue;
    const first = group[0];
    if (!first) continue;
    const comments = group.map((item) => item.comment).filter(Boolean).slice(0, 3);
    const note = `Workers repeatedly mentioned this preparation detail for future shifts: ${comments.join(" / ")}`.slice(0, 1000);
    await upsertSuggestion(app, {
      action: "propose_briefing_note",
      ownerType: "organisation",
      ownerId: first.organisationId,
      subjectType: "site",
      subjectId: first.siteId,
      affectedEdgeIds: [...new Set(group.flatMap((item) => item.edgeIds))],
      title: "Create briefing note from shift feedback",
      explanation: `${group.length} non-contested worker feedback items mention preparation or site context. Approval creates an active briefing note for future shifts.`,
      inputs: {
        key,
        reason: "repeated_worker_briefing_feedback",
        organisationId: first.organisationId,
        siteId: first.siteId,
        roleType: first.roleType,
        note,
        episodeIds: group.map((item) => item.episodeId),
        comments,
        count: group.length,
      },
    });
  }

  return app.db.memoryReviewSuggestion.findMany({
    where: { status: "pending" },
    orderBy: [{ createdAt: "desc" }],
    take: 100,
  });
}

async function resolveSuggestion(
  app: Parameters<FastifyPluginAsync>[0],
  suggestionId: string,
  adminId: string,
  decision: "applied" | "rejected",
) {
  const suggestion = await app.db.memoryReviewSuggestion.findUnique({ where: { id: suggestionId } });
  if (!suggestion || suggestion.status !== "pending") return null;
  if (decision === "rejected") {
    return app.db.$transaction(async (tx) => {
      const resolved = await tx.memoryReviewSuggestion.update({
        where: { id: suggestionId },
        data: { status: "rejected", resolvedAt: new Date(), resolvedBy: adminId, outputs: { decision } },
      });
      await writeAuditEvent(tx, {
        actorType: "admin",
        actorId: adminId,
        action: "memory.consolidation.reject",
        entityType: "MemoryReviewSuggestion",
        entityId: suggestionId,
        inputs: suggestion.inputs as Prisma.InputJsonValue,
        outputs: { action: suggestion.action, affectedMemoryIds: suggestion.affectedMemoryIds, affectedEdgeIds: suggestion.affectedEdgeIds } as Prisma.InputJsonValue,
        outcome: "rejected",
      });
      return resolved;
    });
  }

  return app.db.$transaction(async (tx) => {
    const outputs: Record<string, unknown> = { decision, action: suggestion.action };
    if (suggestion.action === "archive" || suggestion.action === "supersede") {
      if (suggestion.affectedMemoryIds.length) {
        const archived = await tx.memoryEntry.updateMany({
          where: { id: { in: suggestion.affectedMemoryIds }, status: "active" },
          data: { status: "archived" },
        });
        outputs.archivedMemories = archived.count;
      }
      if (suggestion.affectedEdgeIds.length) {
        const archived = await tx.memoryEdge.updateMany({
          where: { id: { in: suggestion.affectedEdgeIds }, status: "active" },
          data: { status: "archived", validUntil: new Date() },
        });
        outputs.archivedEdges = archived.count;
      }
    } else if (suggestion.action === "merge") {
      const memories = await tx.memoryEntry.findMany({
        where: { id: { in: suggestion.affectedMemoryIds } },
        orderBy: [{ confidence: "desc" }, { updatedAt: "desc" }],
      });
      const keeper = memories[0];
      const duplicates = memories.slice(1);
      if (keeper && duplicates.length) {
        await tx.memoryEntry.update({
          where: { id: keeper.id },
          data: {
            content: `${keeper.content}\n\nMerged notes: ${duplicates.map((memory) => memory.content).join(" ")}`.slice(0, 2000),
            confidence: Math.max(keeper.confidence, ...duplicates.map((memory) => memory.confidence)),
          },
        });
        const archived = await tx.memoryEntry.updateMany({
          where: { id: { in: duplicates.map((memory) => memory.id) } },
          data: { status: "archived" },
        });
        outputs.keptMemoryId = keeper.id;
        outputs.archivedMemories = archived.count;
      }
    } else if (suggestion.action === "confirm_pattern") {
      const memory = await tx.memoryEntry.create({
        data: {
          ownerType: suggestion.ownerType,
          ownerId: suggestion.ownerId,
          subjectType: suggestion.subjectType ?? (suggestion.ownerType === "organisation" ? "organisation" : "worker"),
          subjectId: suggestion.subjectId ?? suggestion.ownerId,
          kind: "fit_signal",
          key: keyFromTitle("fit_signal", suggestion.title),
          title: suggestion.title,
          content: suggestion.explanation,
          sourceType: "system_event",
          sourceRefType: "MemoryReviewSuggestion",
          sourceRefId: suggestion.id,
          visibility: "operational",
          status: "pending_confirmation",
          useScopes: suggestion.ownerType === "organisation" ? ORG_SCOPES : WORKER_OPERATIONAL_SCOPES,
          sensitivity: "standard",
          sourceLabel: "Memory consolidation",
          confidence: 0.72,
        },
      });
      outputs.createdMemoryId = memory.id;
    } else if (suggestion.action === "propose_playbook") {
      const inputs = jsonRecord(suggestion.inputs);
      const trigger = jsonRecord(inputs.trigger);
      const missingFields = stringList(trigger.missingFields);
      const value = {
        valueType: "procedural_playbook",
        playbookType: "intake_clarification",
        key: typeof inputs.key === "string" ? inputs.key : suggestion.id,
        trigger: {
          organisationId: suggestion.ownerId,
          ...(typeof trigger.siteId === "string" ? { siteId: trigger.siteId } : {}),
          ...(typeof trigger.roleType === "string" ? { roleType: trigger.roleType } : {}),
          missingFields,
        },
        guidance: typeof inputs.guidance === "string" ? inputs.guidance : suggestion.explanation,
        evidence: {
          eventIds: stringList(inputs.eventIds),
          count: typeof inputs.count === "number" ? inputs.count : stringList(inputs.eventIds).length,
          windowDays: typeof inputs.windowDays === "number" ? inputs.windowDays : 60,
        },
        guardrails: {
          reviewRequired: true,
          rankingImpact: "none",
          complianceImpact: "none",
        },
      };
      const memory = await tx.memoryEntry.create({
        data: {
          ownerType: "organisation",
          ownerId: suggestion.ownerId,
          subjectType: suggestion.subjectType ?? "organisation",
          subjectId: suggestion.subjectId ?? suggestion.ownerId,
          kind: "pattern",
          key: keyFromTitle("pattern", suggestion.title),
          title: suggestion.title,
          content: value.guidance,
          value: value as Prisma.InputJsonValue,
          sourceType: "system_event",
          sourceRefType: "MemoryReviewSuggestion",
          sourceRefId: suggestion.id,
          visibility: "operational",
          status: "active",
          useScopes: ["intake_default", "explanation"],
          sensitivity: "standard",
          sourceLabel: "Procedural learning",
          confidence: 0.76,
          confirmedAt: new Date(),
          confirmedBy: adminId,
        },
      });
      outputs.createdMemoryId = memory.id;
    } else if (suggestion.action === "propose_briefing_note") {
      const inputs = jsonRecord(suggestion.inputs);
      const note = typeof inputs.note === "string" ? inputs.note : suggestion.explanation;
      const value = {
        valueType: "briefing_note",
        note,
        audience: "worker",
        priority: "normal",
      };
      const memory = await tx.memoryEntry.create({
        data: {
          ownerType: "organisation",
          ownerId: suggestion.ownerId,
          subjectType: suggestion.subjectType ?? "site",
          subjectId: suggestion.subjectId ?? suggestion.ownerId,
          kind: "briefing_note",
          key: keyFromTitle("briefing_note", suggestion.title),
          title: suggestion.title,
          content: note,
          value: value as Prisma.InputJsonValue,
          sourceType: "feedback",
          sourceRefType: "MemoryReviewSuggestion",
          sourceRefId: suggestion.id,
          visibility: "operational",
          status: "active",
          useScopes: ["briefing", "explanation"],
          sensitivity: "standard",
          sourceLabel: "Post-shift learning",
          confidence: 0.74,
          confirmedAt: new Date(),
          confirmedBy: adminId,
        },
      });
      outputs.createdMemoryId = memory.id;
    } else if (suggestion.action === "propose_fit_feedback") {
      const inputs = jsonRecord(suggestion.inputs);
      const roleType = typeof inputs.roleType === "string" ? inputs.roleType : "post_shift_feedback";
      const ratingAverage = typeof inputs.ratingAverage === "number" ? inputs.ratingAverage : 4;
      const content = typeof inputs.content === "string" ? inputs.content : suggestion.explanation;
      const value = {
        valueType: "role_confidence",
        roleType,
        confidence: Math.max(0, Math.min(1, ratingAverage / 5)),
        evidence: content,
      };
      const memory = await tx.memoryEntry.create({
        data: {
          ownerType: "worker",
          ownerId: suggestion.ownerId,
          subjectType: suggestion.subjectType ?? "site",
          subjectId: suggestion.subjectId ?? suggestion.ownerId,
          kind: "fit_signal",
          key: keyFromTitle("fit_signal", suggestion.title),
          title: suggestion.title,
          content,
          value: value as Prisma.InputJsonValue,
          sourceType: "feedback",
          sourceRefType: "MemoryReviewSuggestion",
          sourceRefId: suggestion.id,
          visibility: "operational",
          status: "pending_confirmation",
          useScopes: ["ranking_signal", "explanation"],
          sensitivity: "standard",
          sourceLabel: "Post-shift learning",
          confidence: 0.7,
        },
      });
      outputs.createdMemoryId = memory.id;
    }

    const resolved = await tx.memoryReviewSuggestion.update({
      where: { id: suggestionId },
      data: { status: "applied", resolvedAt: new Date(), resolvedBy: adminId, outputs: outputs as Prisma.InputJsonValue },
    });
    await writeAuditEvent(tx, {
      actorType: "admin",
      actorId: adminId,
      action: "memory.consolidation.apply",
      entityType: "MemoryReviewSuggestion",
      entityId: suggestionId,
      inputs: suggestion.inputs as Prisma.InputJsonValue,
      outputs: outputs as Prisma.InputJsonValue,
      outcome: "applied",
    });
    return resolved;
  });
}

export const memoryRoutes: FastifyPluginAsync = async (app) => {
  app.get("/:ownerType(organisations|workers)/:id/memory", async (request, reply) => {
    const { ownerType, ownerId } = routeOwner(request.params as { ownerType: "organisations" | "workers"; id: string });
    const exists = await assertOwnerExists(app, ownerType, ownerId);
    if (!exists) return reply.code(404).send({ error: `${ownerType} not found.` });
    const memories = await listMemories(app, ownerType, ownerId, request.query as Record<string, unknown>);
    return reply.send({ memories });
  });

  app.get("/:ownerType(organisations|workers)/:id/memory/connectors", async (request, reply) => {
    const { ownerType, ownerId } = routeOwner(request.params as { ownerType: "organisations" | "workers"; id: string });
    const exists = await assertOwnerExists(app, ownerType, ownerId);
    if (!exists) return reply.code(404).send({ error: `${ownerType} not found.` });
    return reply.send({
      connectors: CONNECTORS.map((connector) => ({
        ...connector,
        enabled: true,
        reviewGated: true,
      })),
    });
  });

  app.get("/:ownerType(organisations|workers)/:id/memory/export", async (request, reply) => {
    const { ownerType, ownerId } = routeOwner(request.params as { ownerType: "organisations" | "workers"; id: string });
    const exists = await assertOwnerExists(app, ownerType, ownerId);
    if (!exists) return reply.code(404).send({ error: `${ownerType} not found.` });
    const memories = await app.db.memoryEntry.findMany({
      where: {
        ownerType,
        ownerId,
        status: "active",
        useScopes: { has: "connector_export" },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 250,
    });
    return reply.send({
      ownerType,
      ownerId,
      exportedAt: new Date().toISOString(),
      memories,
    });
  });

  app.post("/:ownerType(organisations|workers)/:id/memory/import", async (request, reply) => {
    const { ownerType, ownerId } = routeOwner(request.params as { ownerType: "organisations" | "workers"; id: string });
    const exists = await assertOwnerExists(app, ownerType, ownerId);
    if (!exists) return reply.code(404).send({ error: `${ownerType} not found.` });
    const body = importMemorySchema.parse(request.body);
    const actorId = body.actorId ?? ownerId;
    const memories = [];
    for (const item of body.items) {
      memories.push(
        await createMemory(
          app,
          ownerType,
          ownerId,
          {
            ...item,
            actorId,
            connectorType: item.connectorType ?? body.connectorType,
            connectorRef: item.connectorRef ?? body.connectorRef,
            sourceLabel: item.sourceLabel ?? body.sourceLabel ?? "Connector import",
          },
          "connector_import",
          "user",
        ),
      );
    }
    return reply.code(202).send({ memories, reviewRequired: true });
  });

  app.post("/:ownerType(organisations|workers)/:id/memory", async (request, reply) => {
    const { ownerType, ownerId } = routeOwner(request.params as { ownerType: "organisations" | "workers"; id: string });
    const exists = await assertOwnerExists(app, ownerType, ownerId);
    if (!exists) return reply.code(404).send({ error: `${ownerType} not found.` });
    const body = createMemorySchema.parse(request.body);
    const memory = await createMemory(app, ownerType, ownerId, body);
    return reply.code(201).send({ memory });
  });

  app.patch("/:ownerType(organisations|workers)/:id/memory/:memoryId", async (request, reply) => {
    const params = request.params as {
      ownerType: "organisations" | "workers";
      id: string;
      memoryId: string;
    };
    const { ownerType, ownerId } = routeOwner(params);
    const body = updateMemorySchema.parse(request.body);
    const memory = await updateMemory(app, ownerType, ownerId, params.memoryId, body);
    if (!memory) return reply.code(404).send({ error: "Memory not found." });
    return reply.send({ memory });
  });

  app.delete("/:ownerType(organisations|workers)/:id/memory/:memoryId", async (request, reply) => {
    const params = request.params as {
      ownerType: "organisations" | "workers";
      id: string;
      memoryId: string;
    };
    const { ownerType, ownerId } = routeOwner(params);
    const actorId =
      typeof (request.query as Record<string, unknown>).actorId === "string"
        ? String((request.query as Record<string, unknown>).actorId)
        : ownerId;
    const memory = await softDeleteMemory(app, ownerType, ownerId, params.memoryId, actorId);
    if (!memory) return reply.code(404).send({ error: "Memory not found." });
    return reply.send({ memory });
  });

  app.get("/admin/memory/pending", async () => {
    const memories = await app.db.memoryEntry.findMany({
      where: { status: "pending_confirmation" },
      orderBy: [{ confidence: "desc" }, { createdAt: "desc" }],
      take: 100,
    });
    return { memories };
  });

  app.get("/admin/memory/evidence", async () => {
    const [episodes, edges, influence] = await Promise.all([
      app.db.memoryEpisode.findMany({
        orderBy: [{ occurredAt: "desc" }],
        take: 40,
      }),
      app.db.memoryEdge.findMany({
        where: { status: { in: ["active", "archived"] } },
        orderBy: [{ lastEvidenceAt: "desc" }, { updatedAt: "desc" }],
        take: 40,
      }),
      app.db.auditEvent.findMany({
        where: { action: "memory.influence" },
        orderBy: [{ createdAt: "desc" }],
        take: 30,
      }),
    ]);
    return {
      episodes,
      edges,
      influence: influence.map((event) => ({
        id: event.id,
        entityType: event.entityType,
        entityId: event.entityId,
        outcome: event.outcome,
        createdAt: event.createdAt,
        inputs: event.inputs,
        outputs: event.outputs,
      })),
    };
  });

  app.get("/admin/memory/consolidation", async () => {
    const suggestions = await analyzeMemoryConsolidation(app);
    return { suggestions };
  });

  app.post("/admin/memory/consolidation/:id/apply", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = consolidationDecisionSchema.parse(request.body ?? {});
    const suggestion = await resolveSuggestion(app, id, body.adminId, "applied");
    if (!suggestion) return reply.code(404).send({ error: "Pending memory suggestion not found." });
    return { suggestion };
  });

  app.post("/admin/memory/consolidation/:id/reject", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = consolidationDecisionSchema.parse(request.body ?? {});
    const suggestion = await resolveSuggestion(app, id, body.adminId, "rejected");
    if (!suggestion) return reply.code(404).send({ error: "Pending memory suggestion not found." });
    return { suggestion };
  });

  app.patch("/admin/memory/:memoryId", async (request, reply) => {
    const { memoryId } = request.params as { memoryId: string };
    const body = updateMemorySchema.extend({ adminId: z.string().min(1).default("admin") }).parse(request.body);
    const existing = await app.db.memoryEntry.findUnique({ where: { id: memoryId } });
    if (!existing) return reply.code(404).send({ error: "Memory not found." });
    const { adminId, ...updates } = body;
    const memory = await updateMemory(app, existing.ownerType, existing.ownerId, memoryId, {
      ...updates,
      actorId: adminId,
    });
    return reply.send({ memory });
  });
};
