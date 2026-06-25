import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { Prisma } from "@viora/database";
import { writeAuditEvent } from "../audit.js";

const ownerTypeSchema = z.enum(["organisation", "worker"]);
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

const createMemorySchema = z
  .object({
    subjectType: subjectTypeSchema.optional(),
    subjectId: z.string().min(1).optional(),
    kind: kindSchema,
    key: z.string().min(1).max(120).optional(),
    title: z.string().min(1).max(180),
    content: z.string().min(1).max(2000),
    value: z.record(z.string(), z.unknown()).optional(),
    visibility: visibilitySchema.default("operational"),
    status: statusSchema.default("active"),
    confidence: z.number().min(0).max(1).default(1),
    actorId: z.string().min(1).optional(),
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
  })
  .strict();

function defaultSubject(ownerType: "organisation" | "worker") {
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

async function assertOwnerExists(app: Parameters<FastifyPluginAsync>[0], ownerType: "organisation" | "worker", ownerId: string) {
  if (ownerType === "organisation") {
    const org = await app.db.organisation.findUnique({ where: { id: ownerId }, select: { id: true } });
    return Boolean(org);
  }
  const worker = await app.db.worker.findUnique({ where: { id: ownerId }, select: { id: true } });
  return Boolean(worker);
}

async function listMemories(
  app: Parameters<FastifyPluginAsync>[0],
  ownerType: "organisation" | "worker",
  ownerId: string,
  query: Record<string, unknown>,
) {
  const status = typeof query.status === "string" ? statusSchema.safeParse(query.status) : null;
  const includeDeleted = query.includeDeleted === "true";
  return app.db.memoryEntry.findMany({
    where: {
      ownerType,
      ownerId,
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
  ownerType: "organisation" | "worker",
  ownerId: string,
  body: z.infer<typeof createMemorySchema>,
) {
  const actorId = body.actorId ?? ownerId;
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
        sourceType: "user_entered",
        visibility: body.visibility,
        status: body.status,
        confidence: body.confidence,
        confirmedAt: body.status === "active" ? new Date() : undefined,
        confirmedBy: body.status === "active" ? actorId : undefined,
      },
    });
    await writeAuditEvent(tx, {
      actorType: "user",
      actorId,
      action: "memory.create",
      entityType: "MemoryEntry",
      entityId: memory.id,
      inputs: body as Prisma.InputJsonValue,
      outputs: { memoryId: memory.id, ownerType, ownerId } as Prisma.InputJsonValue,
      outcome: memory.status,
    });
    return memory;
  });
}

async function updateMemory(
  app: Parameters<FastifyPluginAsync>[0],
  ownerType: "organisation" | "worker",
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
  if (body.status !== undefined) {
    data.status = body.status;
    if (body.status === "active") {
      data.confirmedAt = new Date();
      data.confirmedBy = actorId;
    }
  }

  return app.db.$transaction(async (tx) => {
    const memory = await tx.memoryEntry.update({ where: { id: memoryId }, data });
    await writeAuditEvent(tx, {
      actorType: ownerType === "organisation" ? "user" : "user",
      actorId,
      action: "memory.update",
      entityType: "MemoryEntry",
      entityId: memory.id,
      inputs: body as Prisma.InputJsonValue,
      outputs: { updatedFields: Object.keys(body), status: memory.status } as Prisma.InputJsonValue,
      outcome: "updated",
    });
    return memory;
  });
}

async function softDeleteMemory(
  app: Parameters<FastifyPluginAsync>[0],
  ownerType: "organisation" | "worker",
  ownerId: string,
  memoryId: string,
  actorId: string,
) {
  const existing = await app.db.memoryEntry.findUnique({ where: { id: memoryId } });
  if (!existing || existing.ownerType !== ownerType || existing.ownerId !== ownerId) return null;
  return app.db.$transaction(async (tx) => {
    const memory = await tx.memoryEntry.update({
      where: { id: memoryId },
      data: {
        status: "deleted",
        content: "[deleted]",
        value: Prisma.JsonNull,
      },
    });
    await writeAuditEvent(tx, {
      actorType: "user",
      actorId,
      action: "memory.delete",
      entityType: "MemoryEntry",
      entityId: memory.id,
      inputs: { memoryId } as Prisma.InputJsonValue,
      outputs: { status: memory.status } as Prisma.InputJsonValue,
      outcome: "deleted",
    });
    return memory;
  });
}

export const memoryRoutes: FastifyPluginAsync = async (app) => {
  app.get("/:ownerType(organisations|workers)/:id/memory", async (request, reply) => {
    const params = request.params as { ownerType: "organisations" | "workers"; id: string };
    const ownerType = params.ownerType === "organisations" ? "organisation" : "worker";
    const exists = await assertOwnerExists(app, ownerType, params.id);
    if (!exists) return reply.code(404).send({ error: `${ownerType} not found.` });
    const memories = await listMemories(app, ownerType, params.id, request.query as Record<string, unknown>);
    return reply.send({ memories });
  });

  app.post("/:ownerType(organisations|workers)/:id/memory", async (request, reply) => {
    const params = request.params as { ownerType: "organisations" | "workers"; id: string };
    const ownerType = params.ownerType === "organisations" ? "organisation" : "worker";
    const exists = await assertOwnerExists(app, ownerType, params.id);
    if (!exists) return reply.code(404).send({ error: `${ownerType} not found.` });
    const body = createMemorySchema.parse(request.body);
    const memory = await createMemory(app, ownerType, params.id, body);
    return reply.code(201).send({ memory });
  });

  app.patch("/:ownerType(organisations|workers)/:id/memory/:memoryId", async (request, reply) => {
    const params = request.params as {
      ownerType: "organisations" | "workers";
      id: string;
      memoryId: string;
    };
    const ownerType = params.ownerType === "organisations" ? "organisation" : "worker";
    const body = updateMemorySchema.parse(request.body);
    const memory = await updateMemory(app, ownerType, params.id, params.memoryId, body);
    if (!memory) return reply.code(404).send({ error: "Memory not found." });
    return reply.send({ memory });
  });

  app.delete("/:ownerType(organisations|workers)/:id/memory/:memoryId", async (request, reply) => {
    const params = request.params as {
      ownerType: "organisations" | "workers";
      id: string;
      memoryId: string;
    };
    const ownerType = params.ownerType === "organisations" ? "organisation" : "worker";
    const actorId =
      typeof (request.query as Record<string, unknown>).actorId === "string"
        ? String((request.query as Record<string, unknown>).actorId)
        : params.id;
    const memory = await softDeleteMemory(app, ownerType, params.id, params.memoryId, actorId);
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
