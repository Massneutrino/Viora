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

const shiftFeedbackSchema = z
  .object({
    rating: z.number().int().min(1).max(5).optional(),
    comment: z.string().min(1).max(2000).optional(),
    contested: z.boolean().default(false),
  })
  .refine((body) => body.rating !== undefined || body.comment !== undefined, {
    message: "rating or comment is required.",
  });

const GUARDRAIL_SELECT = {
  autonomyLevel: true,
  budgetCeiling: true,
  payFloor: true,
  maxCommuteMinutes: true,
  approvedRoleTypes: true,
} as const;

export const organisationRoutes: FastifyPluginAsync = async (app) => {
  app.get("/:id/dashboard", async (request, reply) => {
    const { id } = request.params as { id: string };
    const org = await app.db.organisation.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!org) return reply.code(404).send({ error: "Organisation not found." });

    const [lastBooking, requestCounts, activeBookings, openRequests, invoices] = await Promise.all([
      app.db.booking.findFirst({
        where: { organisationId: id },
        include: {
          worker: { select: { firstName: true, lastName: true } },
          site: { select: { name: true, address: true, city: true, postcode: true } },
        },
        orderBy: { startAt: "desc" },
      }),
      app.db.bookingRequest.groupBy({
        by: ["status"],
        where: { organisationId: id },
        _count: { _all: true },
      }),
      app.db.booking.count({ where: { organisationId: id, status: { in: ["confirmed", "in_progress"] } } }),
      app.db.bookingRequest.count({ where: { organisationId: id, status: { in: ["pending_confirmation", "confirmed", "broadcasting"] } } }),
      app.db.invoice.findMany({ where: { organisationId: id }, select: { totalAmount: true } }),
    ]);

    const totalRequests = requestCounts.reduce((sum, row) => sum + row._count._all, 0);
    const filledRequests = requestCounts
      .filter((row) => row.status === "filled")
      .reduce((sum, row) => sum + row._count._all, 0);
    const termSpend = Number(invoices.reduce((sum, invoice) => sum + invoice.totalAmount, 0).toFixed(2));

    return reply.send({
      organisation: org,
      summary: {
        fillRate: totalRequests > 0 ? Number((filledRequests / totalRequests).toFixed(2)) : null,
        activeBookings,
        openRequests,
        termSpend,
      },
      lastBooking,
    });
  });

  app.get("/:id/bookings", async (request, reply) => {
    const { id } = request.params as { id: string };
    const org = await app.db.organisation.findUnique({ where: { id }, select: { id: true } });
    if (!org) return reply.code(404).send({ error: "Organisation not found." });

    const [requests, bookings] = await Promise.all([
      app.db.bookingRequest.findMany({
        where: { organisationId: id },
        include: {
          site: { select: { name: true, address: true, city: true, postcode: true } },
          offers: { select: { id: true, status: true } },
          booking: { select: { id: true, status: true, workerId: true } },
        },
        orderBy: { startAt: "desc" },
        take: 50,
      }),
      app.db.booking.findMany({
        where: { organisationId: id },
        include: {
          worker: { select: { firstName: true, lastName: true } },
          site: { select: { name: true, address: true, city: true, postcode: true } },
          shift: true,
          timesheet: true,
        },
        orderBy: { startAt: "desc" },
        take: 50,
      }),
    ]);

    return reply.send({ requests, bookings });
  });

  app.post("/:id/shifts/:shiftId/feedback", async (request, reply) => {
    const { id: organisationId, shiftId } = request.params as { id: string; shiftId: string };
    const body = shiftFeedbackSchema.parse(request.body ?? {});

    const existing = await app.db.shift.findUnique({
      where: { id: shiftId },
      include: { booking: true },
    });
    if (!existing) return reply.code(404).send({ error: "Shift not found." });
    if (existing.booking.organisationId !== organisationId) return reply.code(403).send({ error: "Forbidden." });
    if (!["checked_out", "completed"].includes(existing.status)) {
      return reply.code(409).send({ error: `Cannot leave feedback from status ${existing.status}.` });
    }

    const duplicate = await app.db.feedback.findFirst({
      where: { shiftId, fromType: "organisation", fromId: organisationId },
      select: { id: true },
    });
    if (duplicate) return reply.code(409).send({ error: "Feedback already submitted for this shift." });

    const feedback = await app.db.$transaction(async (tx) => {
      const row = await tx.feedback.create({
        data: {
          shiftId,
          fromType: "organisation",
          fromId: organisationId,
          rating: body.rating,
          comment: body.comment,
          contested: body.contested,
        },
      });
      await writeAuditEvent(tx, {
        actorType: "user",
        actorId: organisationId,
        action: "shift.feedback",
        entityType: "Feedback",
        entityId: row.id,
        inputs: { organisationId, shiftId, rating: body.rating ?? null, contested: body.contested } as Prisma.InputJsonValue,
        outputs: { feedbackId: row.id, fromType: row.fromType } as Prisma.InputJsonValue,
        outcome: body.contested ? "contested" : "submitted",
      });
      return row;
    });

    await app.agents.memory.recordFeedbackEvent(feedback.id)
      .catch((err) => request.log.warn({ err }, "memory feedback learning failed after organisation feedback"));

    return reply.code(201).send({ feedback });
  });

  app.get("/:id/workers", async (request, reply) => {
    const { id } = request.params as { id: string };
    const org = await app.db.organisation.findUnique({ where: { id }, select: { id: true } });
    if (!org) return reply.code(404).send({ error: "Organisation not found." });

    const [bookings, offers] = await Promise.all([
      app.db.booking.findMany({
        where: { organisationId: id },
        include: {
          worker: { include: { passport: true } },
          site: { select: { name: true } },
        },
        orderBy: { startAt: "desc" },
        take: 100,
      }),
      app.db.offer.findMany({
        where: { bookingRequest: { organisationId: id } },
        include: {
          worker: { include: { passport: true } },
          bookingRequest: { include: { site: { select: { name: true } } } },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    ]);

    const workers = new Map<string, Record<string, unknown>>();
    for (const booking of bookings) {
      const previous = workers.get(booking.workerId);
      workers.set(booking.workerId, {
        id: booking.workerId,
        name: `${booking.worker.firstName} ${booking.worker.lastName}`,
        roleTypes: booking.worker.roleTypes,
        reliabilityScore: booking.worker.passport?.reliabilityScore ?? null,
        compliance: {
          dbsStatus: booking.worker.passport?.dbsStatus ?? null,
          rightToWorkStatus: booking.worker.passport?.rightToWorkStatus ?? null,
          safeguardingStatus: booking.worker.passport?.safeguardingStatus ?? null,
          qtsStatus: booking.worker.passport?.qtsStatus ?? null,
        },
        relationship: booking.status === "confirmed" ? "booked" : "recent",
        bookingCount: Number(previous?.bookingCount ?? 0) + 1,
        lastRoleType: booking.roleType,
        lastSiteName: booking.site.name,
        lastWorkedAt: booking.startAt,
      });
    }
    for (const offer of offers) {
      if (workers.has(offer.workerId)) continue;
      workers.set(offer.workerId, {
        id: offer.workerId,
        name: `${offer.worker.firstName} ${offer.worker.lastName}`,
        roleTypes: offer.worker.roleTypes,
        reliabilityScore: offer.worker.passport?.reliabilityScore ?? null,
        compliance: {
          dbsStatus: offer.worker.passport?.dbsStatus ?? null,
          rightToWorkStatus: offer.worker.passport?.rightToWorkStatus ?? null,
          safeguardingStatus: offer.worker.passport?.safeguardingStatus ?? null,
          qtsStatus: offer.worker.passport?.qtsStatus ?? null,
        },
        relationship: offer.status === "pending" ? "pending_offer" : "previous_offer",
        bookingCount: 0,
        lastRoleType: offer.bookingRequest.roleType,
        lastSiteName: offer.bookingRequest.site.name,
        lastWorkedAt: offer.bookingRequest.startAt,
      });
    }

    return reply.send({ workers: [...workers.values()] });
  });

  app.get("/:id/finance", async (request, reply) => {
    const { id } = request.params as { id: string };
    const org = await app.db.organisation.findUnique({ where: { id }, select: { id: true } });
    if (!org) return reply.code(404).send({ error: "Organisation not found." });

    const [invoices, timesheets] = await Promise.all([
      app.db.invoice.findMany({ where: { organisationId: id }, orderBy: { createdAt: "desc" }, take: 25 }),
      app.db.timesheet.findMany({
        where: { organisationId: id },
        include: {
          booking: {
            include: {
              worker: { select: { firstName: true, lastName: true } },
              site: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);

    return reply.send({
      summary: {
        workerPayTotal: Number(invoices.reduce((sum, invoice) => sum + invoice.workerPayTotal, 0).toFixed(2)),
        vioraFeeTotal: Number(invoices.reduce((sum, invoice) => sum + invoice.vioraFeeTotal, 0).toFixed(2)),
        totalAmount: Number(invoices.reduce((sum, invoice) => sum + invoice.totalAmount, 0).toFixed(2)),
        unapprovedTimesheets: timesheets.filter((timesheet) => !timesheet.approved).length,
      },
      invoices,
      timesheets: timesheets.map((timesheet) => ({
        id: timesheet.id,
        approved: timesheet.approved,
        approvedAt: timesheet.approvedAt,
        hoursWorked: timesheet.hoursWorked,
        workerName: `${timesheet.booking.worker.firstName} ${timesheet.booking.worker.lastName}`,
        roleType: timesheet.booking.roleType,
        siteName: timesheet.booking.site.name,
        payRate: timesheet.booking.payRate,
        workerTotal: Number((timesheet.booking.payRate * timesheet.hoursWorked).toFixed(2)),
        vioraFee: Number((timesheet.booking.vioraFee * timesheet.hoursWorked).toFixed(2)),
        startAt: timesheet.booking.startAt,
      })),
    });
  });
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
          select: { id: true, name: true, address: true, city: true, postcode: true },
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
