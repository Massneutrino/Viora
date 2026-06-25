import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { Prisma } from "@viora/database";
import { writeAuditEvent } from "../audit.js";

// Employer settings: organisation profile is editable; sites + team are
// read-only this pass. Automation rules live on the org's GuardrailPolicy.
const orgProfileSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    type: z.string().min(1).max(60).optional(),
    timezone: z.string().min(1).max(60).optional(),
  })
  .strict();

const orgGuardrailSchema = z
  .object({
    autonomyLevel: z.enum(["L0", "L1", "L2", "L3", "L4"]).optional(),
    budgetCeiling: z.number().min(0).max(100000).nullable().optional(),
    payFloor: z.number().min(0).max(100000).nullable().optional(),
    maxCommuteMinutes: z.number().int().min(0).max(600).nullable().optional(),
    approvedRoleTypes: z.array(z.string().min(1).max(60)).max(20).optional(),
  })
  .strict();

const GUARDRAIL_SELECT = {
  autonomyLevel: true,
  budgetCeiling: true,
  payFloor: true,
  maxCommuteMinutes: true,
  approvedRoleTypes: true,
} as const;

export const organisationRoutes: FastifyPluginAsync = async (app) => {
  /** GET /v1/organisations/:id — org profile, sites, team and guardrail policy */
  app.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const org = await app.db.organisation.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        sector: true,
        type: true,
        timezone: true,
        sites: {
          orderBy: { name: "asc" },
          select: { id: true, name: true, address: true },
        },
        users: {
          orderBy: { name: "asc" },
          select: { id: true, name: true, email: true, role: true },
        },
        guardrailPolicy: { select: GUARDRAIL_SELECT },
      },
    });
    if (!org) return reply.code(404).send({ error: "Organisation not found." });

    const { guardrailPolicy, ...profile } = org;
    return reply.send({ organisation: profile, guardrail: guardrailPolicy ?? null });
  });

  /** PATCH /v1/organisations/:id — update organisation profile fields */
  app.patch("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = orgProfileSchema.parse(request.body);

    const existing = await app.db.organisation.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return reply.code(404).send({ error: "Organisation not found." });

    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined) data[key] = value;
    }

    const organisation = await app.db.$transaction(async (tx) => {
      const updated = Object.keys(data).length
        ? await tx.organisation.update({
            where: { id },
            data: data as Prisma.OrganisationUpdateInput,
            select: { id: true, name: true, sector: true, type: true, timezone: true },
          })
        : await tx.organisation.findUniqueOrThrow({
            where: { id },
            select: { id: true, name: true, sector: true, type: true, timezone: true },
          });

      await writeAuditEvent(tx, {
        actorType: "user",
        actorId: id,
        action: "organisation.profile.update",
        entityType: "Organisation",
        entityId: id,
        inputs: body as Prisma.InputJsonValue,
        outputs: { updatedFields: Object.keys(body) } as Prisma.InputJsonValue,
        outcome: "updated",
      });

      return updated;
    });

    await app.agents.memory.rememberFromEvent({
      ownerType: "organisation",
      ownerId: id,
      subjectType: "organisation",
      subjectId: id,
      sourceRefType: "Organisation",
      sourceRefId: id,
      text: `Organisation profile update: ${JSON.stringify(body)}`,
      data: { updatedFields: Object.keys(body) },
    }).catch((err) => request.log.warn({ err }, "memory inference failed after organisation update"));

    return reply.send({ organisation });
  });

  /** PATCH /v1/organisations/:id/guardrail — upsert the org's automation guardrails */
  app.patch("/:id/guardrail", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = orgGuardrailSchema.parse(request.body);

    const existing = await app.db.organisation.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return reply.code(404).send({ error: "Organisation not found." });

    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined) data[key] = value;
    }

    const guardrail = await app.db.$transaction(async (tx) => {
      const upserted = await tx.guardrailPolicy.upsert({
        where: { organisationId: id },
        update: data,
        create: { organisationId: id, ...data },
        select: GUARDRAIL_SELECT,
      });

      await writeAuditEvent(tx, {
        actorType: "user",
        actorId: id,
        action: "organisation.guardrail.update",
        entityType: "GuardrailPolicy",
        entityId: id,
        inputs: body as Prisma.InputJsonValue,
        outputs: { updatedFields: Object.keys(body) } as Prisma.InputJsonValue,
        outcome: "updated",
      });

      return upserted;
    });

    await app.agents.memory.rememberFromEvent({
      ownerType: "organisation",
      ownerId: id,
      subjectType: "organisation",
      subjectId: id,
      sourceRefType: "GuardrailPolicy",
      sourceRefId: id,
      text: `Organisation guardrail update: ${JSON.stringify(body)}`,
      data: { updatedFields: Object.keys(body) },
    }).catch((err) => request.log.warn({ err }, "memory inference failed after guardrail update"));

    return reply.send({ guardrail });
  });
};
