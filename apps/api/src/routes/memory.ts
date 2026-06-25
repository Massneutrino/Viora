import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { Prisma } from "@viora/database";
import type {
  MemoryConnectorType,
  MemoryOwnerType,
  MemorySensitivity,
  MemoryUseScope,
  MemoryVisibility,
} from "@viora/domain";
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
  return app.db.memoryEntry.findMany({
    where: {
      ownerType,
      ownerId,
      ...(scope?.success ? { useScopes: { has: scope.data } } : {}),
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
