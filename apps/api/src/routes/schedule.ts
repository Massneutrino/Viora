import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { Prisma } from "@viora/database";
import {
  buildScheduleResponse,
  DEFAULT_SCHEDULE_RANGE_DAYS,
  DEFAULT_SCHEDULE_TIMEZONE,
  MAX_SCHEDULE_RANGE_DAYS,
  type ScheduleEvent,
  type ScheduleGranularity,
} from "@viora/domain";
import { writeAuditEvent } from "../audit.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const scheduleQuerySchema = z
  .object({
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    granularity: z.enum(["day", "hour"]).default("day"),
    siteId: z.string().min(1).optional(),
  })
  .strict();

const availabilityQuerySchema = z
  .object({
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

const availabilityBlockCreateSchema = z
  .object({
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }),
    note: z.string().max(500).nullable().optional(),
  })
  .strict();

const availabilityBlockPatchSchema = z
  .object({
    startAt: z.string().datetime({ offset: true }).optional(),
    endAt: z.string().datetime({ offset: true }).optional(),
    note: z.string().max(500).nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one field is required.",
  });

const availabilityPatternSchema = z
  .object({
    timezone: z.string().min(1).max(60).default(DEFAULT_SCHEDULE_TIMEZONE),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7),
    startTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
    endTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  })
  .strict();

function defaultRange() {
  const from = new Date();
  from.setUTCHours(0, 0, 0, 0);
  const day = from.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  from.setUTCDate(from.getUTCDate() - daysSinceMonday);
  const to = new Date(from.getTime() + DEFAULT_SCHEDULE_RANGE_DAYS * MS_PER_DAY);
  return { from, to };
}

function parseRange(query: { from?: string; to?: string }) {
  const fallback = defaultRange();
  const from = query.from ? new Date(query.from) : fallback.from;
  const to = query.to ? new Date(query.to) : fallback.to;
  const days = (to.getTime() - from.getTime()) / MS_PER_DAY;
  if (to <= from) {
    return { error: "to must be after from." as const };
  }
  if (days > MAX_SCHEDULE_RANGE_DAYS) {
    return { error: `Schedule range cannot exceed ${MAX_SCHEDULE_RANGE_DAYS} days.` as const };
  }
  return { from, to };
}

function overlapWhere(from: Date, to: Date) {
  return {
    startAt: { lt: to },
    endAt: { gt: from },
  };
}

function roleLabel(roleType: string): string {
  return roleType
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function siteAddress(site?: { address?: string | null; city?: string | null; postcode?: string | null } | null) {
  return site ? [site.address, site.city, site.postcode].filter(Boolean).join(", ") : "";
}

function workerName(worker?: { firstName: string; lastName: string } | null) {
  return worker ? `${worker.firstName} ${worker.lastName}` : undefined;
}

export const scheduleRoutes: FastifyPluginAsync = async (app) => {
  app.get("/workers/:id/schedule", async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = scheduleQuerySchema.parse(request.query);
    const range = parseRange(query);
    if ("error" in range) return reply.code(400).send({ error: range.error });

    const worker = await app.db.worker.findUnique({ where: { id }, select: { id: true } });
    if (!worker) return reply.code(404).send({ error: "Worker not found." });

    const [offers, bookings, blocks] = await Promise.all([
      app.db.offer.findMany({
        where: {
          workerId: id,
          status: "pending",
          expiresAt: { gt: new Date() },
          bookingRequest: overlapWhere(range.from, range.to),
        },
        include: {
          bookingRequest: {
            include: {
              organisation: { select: { id: true, name: true, timezone: true } },
              site: { select: { id: true, name: true, address: true, city: true, postcode: true } },
            },
          },
        },
        orderBy: { bookingRequest: { startAt: "asc" } },
      }),
      app.db.booking.findMany({
        where: { workerId: id, ...overlapWhere(range.from, range.to) },
        include: {
          organisation: { select: { id: true, name: true, timezone: true } },
          site: { select: { id: true, name: true, address: true, city: true, postcode: true } },
          shift: true,
          timesheet: true,
        },
        orderBy: { startAt: "asc" },
      }),
      app.db.workerAvailabilityBlock.findMany({
        where: { workerId: id, ...overlapWhere(range.from, range.to) },
        orderBy: { startAt: "asc" },
      }),
    ]);

    const timezone =
      bookings[0]?.organisation.timezone ??
      offers[0]?.bookingRequest.organisation.timezone ??
      DEFAULT_SCHEDULE_TIMEZONE;

    const bookingOfferIds = new Set(bookings.map((booking) => booking.offerId));
    const events: ScheduleEvent[] = [
      ...bookings.map((booking) => ({
        id: `booking:${booking.id}`,
        kind: "confirmed_shift" as const,
        audience: "worker" as const,
        startAt: booking.startAt.toISOString(),
        endAt: booking.endAt.toISOString(),
        timezone: booking.organisation.timezone,
        title: roleLabel(booking.roleType),
        subtitle: `${booking.organisation.name} · ${booking.site.name}`,
        status: booking.status,
        meta: {
          bookingId: booking.id,
          bookingRequestId: booking.bookingRequestId,
          shiftId: booking.shift?.id,
          organisationId: booking.organisationId,
          organisationName: booking.organisation.name,
          siteId: booking.siteId,
          siteName: booking.site.name,
          siteAddress: siteAddress(booking.site),
          roleType: booking.roleType,
          payRate: booking.payRate,
          timesheetApproved: booking.timesheet?.approved ?? false,
        },
      })),
      ...offers
        .filter((offer) => !bookingOfferIds.has(offer.id))
        .map((offer) => ({
          id: `offer:${offer.id}`,
          kind: "pending_offer" as const,
          audience: "worker" as const,
          startAt: offer.bookingRequest.startAt.toISOString(),
          endAt: offer.bookingRequest.endAt.toISOString(),
          timezone: offer.bookingRequest.organisation.timezone,
          title: roleLabel(offer.bookingRequest.roleType),
          subtitle: `${offer.bookingRequest.organisation.name} · ${offer.bookingRequest.site.name}`,
          status: "pending" as const,
          meta: {
            bookingRequestId: offer.bookingRequestId,
            offerId: offer.id,
            organisationId: offer.bookingRequest.organisationId,
            organisationName: offer.bookingRequest.organisation.name,
            siteId: offer.bookingRequest.siteId,
            siteName: offer.bookingRequest.site.name,
            siteAddress: siteAddress(offer.bookingRequest.site),
            roleType: offer.bookingRequest.roleType,
            payRate: offer.payRate,
            rateMode: offer.bookingRequest.rateMode,
          },
        })),
      ...blocks.map((block) => ({
        id: `availability:${block.id}`,
        kind: "unavailable_block" as const,
        audience: "worker" as const,
        startAt: block.startAt.toISOString(),
        endAt: block.endAt.toISOString(),
        timezone,
        title: "Unavailable",
        subtitle: block.note ?? undefined,
        status: "unavailable" as const,
        meta: {
          availabilityBlockId: block.id,
          workerId: block.workerId,
          note: block.note ?? undefined,
        },
      })),
    ];

    return reply.send(buildScheduleResponse({
      events,
      from: range.from,
      to: range.to,
      timezone,
      granularity: query.granularity as ScheduleGranularity,
    }));
  });

  app.get("/organisations/:id/schedule", async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = scheduleQuerySchema.parse(request.query);
    const range = parseRange(query);
    if ("error" in range) return reply.code(400).send({ error: range.error });

    const organisation = await app.db.organisation.findUnique({
      where: { id },
      select: { id: true, name: true, timezone: true },
    });
    if (!organisation) return reply.code(404).send({ error: "Organisation not found." });

    const siteFilter = query.siteId ? { siteId: query.siteId } : {};
    const [bookings, requests] = await Promise.all([
      app.db.booking.findMany({
        where: { organisationId: id, ...siteFilter, ...overlapWhere(range.from, range.to) },
        include: {
          worker: { select: { id: true, firstName: true, lastName: true } },
          site: { select: { id: true, name: true, address: true, city: true, postcode: true } },
          shift: true,
          timesheet: true,
        },
        orderBy: { startAt: "asc" },
      }),
      app.db.bookingRequest.findMany({
        where: {
          organisationId: id,
          ...siteFilter,
          ...overlapWhere(range.from, range.to),
          status: { in: ["pending_confirmation", "confirmed", "broadcasting"] },
        },
        include: {
          site: { select: { id: true, name: true, address: true, city: true, postcode: true } },
          booking: { select: { id: true } },
        },
        orderBy: { startAt: "asc" },
      }),
    ]);

    const coveredRequestIds = new Set(bookings.map((booking) => booking.bookingRequestId));
    const events: ScheduleEvent[] = [
      ...bookings.map((booking) => ({
        id: `booking:${booking.id}`,
        kind: "confirmed_shift" as const,
        audience: "organisation" as const,
        startAt: booking.startAt.toISOString(),
        endAt: booking.endAt.toISOString(),
        timezone: organisation.timezone,
        title: roleLabel(booking.roleType),
        subtitle: `${booking.site.name} · ${workerName(booking.worker) ?? "Worker confirmed"}`,
        status: booking.status,
        meta: {
          bookingId: booking.id,
          bookingRequestId: booking.bookingRequestId,
          shiftId: booking.shift?.id,
          organisationId: booking.organisationId,
          organisationName: organisation.name,
          siteId: booking.siteId,
          siteName: booking.site.name,
          siteAddress: siteAddress(booking.site),
          workerId: booking.workerId,
          workerName: workerName(booking.worker),
          roleType: booking.roleType,
          payRate: booking.payRate,
          timesheetApproved: booking.timesheet?.approved ?? false,
        },
      })),
      ...requests
        .filter((bookingRequest) => !bookingRequest.booking && !coveredRequestIds.has(bookingRequest.id))
        .map((bookingRequest) => ({
          id: `request:${bookingRequest.id}`,
          kind: "open_request" as const,
          audience: "organisation" as const,
          startAt: bookingRequest.startAt.toISOString(),
          endAt: bookingRequest.endAt.toISOString(),
          timezone: organisation.timezone,
          title: roleLabel(bookingRequest.roleType),
          subtitle: `${bookingRequest.site.name} · Open cover`,
          status: "open" as const,
          meta: {
            bookingRequestId: bookingRequest.id,
            organisationId: bookingRequest.organisationId,
            organisationName: organisation.name,
            siteId: bookingRequest.siteId,
            siteName: bookingRequest.site.name,
            siteAddress: siteAddress(bookingRequest.site),
            roleType: bookingRequest.roleType,
            payRate: bookingRequest.payRate,
            rateMode: bookingRequest.rateMode,
          },
        })),
    ];

    return reply.send(buildScheduleResponse({
      events,
      from: range.from,
      to: range.to,
      timezone: organisation.timezone,
      granularity: query.granularity as ScheduleGranularity,
    }));
  });

  app.get("/workers/:id/availability", async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = availabilityQuerySchema.parse(request.query);
    const range = parseRange(query);
    if ("error" in range) return reply.code(400).send({ error: range.error });

    const worker = await app.db.worker.findUnique({ where: { id }, select: { id: true } });
    if (!worker) return reply.code(404).send({ error: "Worker not found." });

    const [pattern, blocks] = await Promise.all([
      app.db.workerAvailabilityPattern.findUnique({ where: { workerId: id } }),
      app.db.workerAvailabilityBlock.findMany({
        where: { workerId: id, ...overlapWhere(range.from, range.to) },
        orderBy: { startAt: "asc" },
      }),
    ]);

    return reply.send({
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      pattern,
      blocks,
    });
  });

  app.put("/workers/:id/availability/pattern", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = availabilityPatternSchema.parse(request.body);

    const worker = await app.db.worker.findUnique({ where: { id }, select: { id: true } });
    if (!worker) return reply.code(404).send({ error: "Worker not found." });
    if (body.startTime && body.endTime && body.endTime <= body.startTime) {
      return reply.code(422).send({ error: "endTime must be after startTime." });
    }

    const pattern = await app.db.$transaction(async (tx) => {
      const row = await tx.workerAvailabilityPattern.upsert({
        where: { workerId: id },
        update: body,
        create: { workerId: id, ...body },
      });
      await writeAuditEvent(tx, {
        actorType: "user",
        actorId: id,
        action: "schedule.availability.pattern.update",
        entityType: "WorkerAvailabilityPattern",
        entityId: id,
        inputs: body as Prisma.InputJsonValue,
        outputs: { workerId: id, daysOfWeek: row.daysOfWeek } as Prisma.InputJsonValue,
        outcome: "updated",
      });
      return row;
    });

    return reply.send({ pattern });
  });

  app.post("/workers/:id/availability/blocks", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = availabilityBlockCreateSchema.parse(request.body);
    const startAt = new Date(body.startAt);
    const endAt = new Date(body.endAt);
    if (endAt <= startAt) return reply.code(422).send({ error: "endAt must be after startAt." });
    if ((endAt.getTime() - startAt.getTime()) / MS_PER_DAY > MAX_SCHEDULE_RANGE_DAYS) {
      return reply.code(422).send({ error: `Availability block cannot exceed ${MAX_SCHEDULE_RANGE_DAYS} days.` });
    }

    const worker = await app.db.worker.findUnique({ where: { id }, select: { id: true } });
    if (!worker) return reply.code(404).send({ error: "Worker not found." });

    const block = await app.db.$transaction(async (tx) => {
      const row = await tx.workerAvailabilityBlock.create({
        data: {
          workerId: id,
          startAt,
          endAt,
          note: body.note ?? null,
        },
      });
      await writeAuditEvent(tx, {
        actorType: "user",
        actorId: id,
        action: "schedule.availability.block.create",
        entityType: "WorkerAvailabilityBlock",
        entityId: row.id,
        inputs: { workerId: id, startAt: body.startAt, endAt: body.endAt, note: body.note ?? null } as Prisma.InputJsonValue,
        outputs: { blockId: row.id } as Prisma.InputJsonValue,
        outcome: "created",
      });
      return row;
    });

    return reply.code(201).send({ block });
  });

  app.patch("/workers/:id/availability/blocks/:blockId", async (request, reply) => {
    const { id, blockId } = request.params as { id: string; blockId: string };
    const body = availabilityBlockPatchSchema.parse(request.body);
    const existing = await app.db.workerAvailabilityBlock.findUnique({ where: { id: blockId } });
    if (!existing || existing.workerId !== id) return reply.code(404).send({ error: "Availability block not found." });

    const startAt = body.startAt ? new Date(body.startAt) : existing.startAt;
    const endAt = body.endAt ? new Date(body.endAt) : existing.endAt;
    if (endAt <= startAt) return reply.code(422).send({ error: "endAt must be after startAt." });

    const data: Prisma.WorkerAvailabilityBlockUpdateInput = {};
    if (body.startAt) data.startAt = startAt;
    if (body.endAt) data.endAt = endAt;
    if (body.note !== undefined) data.note = body.note;

    const block = await app.db.$transaction(async (tx) => {
      const row = await tx.workerAvailabilityBlock.update({ where: { id: blockId }, data });
      await writeAuditEvent(tx, {
        actorType: "user",
        actorId: id,
        action: "schedule.availability.block.update",
        entityType: "WorkerAvailabilityBlock",
        entityId: row.id,
        inputs: body as Prisma.InputJsonValue,
        outputs: { blockId: row.id } as Prisma.InputJsonValue,
        outcome: "updated",
      });
      return row;
    });

    return reply.send({ block });
  });

  app.delete("/workers/:id/availability/blocks/:blockId", async (request, reply) => {
    const { id, blockId } = request.params as { id: string; blockId: string };
    const existing = await app.db.workerAvailabilityBlock.findUnique({ where: { id: blockId } });
    if (!existing || existing.workerId !== id) return reply.code(404).send({ error: "Availability block not found." });

    await app.db.$transaction(async (tx) => {
      await tx.workerAvailabilityBlock.delete({ where: { id: blockId } });
      await writeAuditEvent(tx, {
        actorType: "user",
        actorId: id,
        action: "schedule.availability.block.delete",
        entityType: "WorkerAvailabilityBlock",
        entityId: blockId,
        inputs: { workerId: id, blockId } as Prisma.InputJsonValue,
        outputs: {} as Prisma.InputJsonValue,
        outcome: "deleted",
      });
    });

    return reply.code(204).send();
  });
};
