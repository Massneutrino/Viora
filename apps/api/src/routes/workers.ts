import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { Prisma } from "@viora/database";
import { haversineKm } from "@viora/domain";
import { queuePendingApproval } from "../approvals.js";
import { writeAuditEvent } from "../audit.js";
import { makeStorageKey, saveFile, readFile, mimeFromKey } from "../storage.js";

// Phase 0: maximum distance from site before check-in is rejected
const CHECK_IN_RADIUS_KM = 0.5;

// Rough urban travel speed for estimating commute minutes from straight-line distance.
const AVG_URBAN_KM_PER_MIN = 0.5; // ~30 km/h

function roleLabel(roleType: string): string {
  return roleType
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const offerDateFmt = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  timeZone: "Europe/London",
});
const offerTimeFmt = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
});

const KNOWN_DOC_TYPES = [
  "enhanced_dbs", "right_to_work", "safeguarding", "qts", "sia",
  "identity", "cv", "reference_letter",
] as const;

const complianceDocumentSchema = z.object({
  documentType: z.string().min(1),
  status: z.enum(["pending", "verified", "expired", "rejected"]).default("pending"),
  expiresAt: z.string().datetime().optional(),
  storageKey: z.string().min(1).optional(),
  verifiedBy: z.string().min(1).optional(),
  bookingRequestId: z.string().min(1).optional(),
});

const uploadSchema = z.object({
  documentType: z.enum(KNOWN_DOC_TYPES),
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1).max(100),
  fileData: z.string().min(1), // base64-encoded file content
});

const shiftLocationSchema = z.object({
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

// Account hub: profile fields live on Worker; payFloor/commute live on the
// worker's GuardrailPolicy. A single PATCH updates both.
const workerProfileSchema = z
  .object({
    firstName: z.string().min(1).max(100).optional(),
    lastName: z.string().min(1).max(100).optional(),
    phone: z.string().max(40).nullable().optional(),
    homeLatitude: z.number().min(-90).max(90).nullable().optional(),
    homeLongitude: z.number().min(-180).max(180).nullable().optional(),
    workRadiusKm: z.number().min(0).max(500).nullable().optional(),
    roleTypes: z.array(z.string().min(1).max(60)).max(20).optional(),
    payFloor: z.number().min(0).max(10000).nullable().optional(),
    maxCommuteMinutes: z.number().int().min(0).max(600).nullable().optional(),
  })
  .strict();

const WORKER_GUARDRAIL_SELECT = {
  autonomyLevel: true,
  payFloor: true,
  maxCommuteMinutes: true,
  approvedRoleTypes: true,
} as const;

const WORKER_PROFILE_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  homeLatitude: true,
  homeLongitude: true,
  workRadiusKm: true,
  roleTypes: true,
  passport: { select: { reliabilityScore: true } },
} as const;

type WorkerProfileRow = {
  passport: { reliabilityScore: number | null } | null;
  [key: string]: unknown;
};

/** Flatten the passport's reliability score onto the profile DTO. */
function toProfileDto({ passport, ...rest }: WorkerProfileRow) {
  return { ...rest, reliabilityScore: passport?.reliabilityScore ?? null };
}

export const workerRoutes: FastifyPluginAsync = async (app) => {
  /** GET /v1/workers/:id/offer — next ranked opportunity (swipe deck), flattened for the UI */
  app.get("/:id/offer", async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await app.agents.worker.surfaceNextOffer(id);
    const offer = result?.data as any;

    if (!offer) {
      return reply.send({ offer: null, message: result?.explanation ?? "No pending offers." });
    }

    const worker = await app.db.worker.findUnique({
      where: { id },
      select: { homeLatitude: true, homeLongitude: true },
    });

    const br = offer.bookingRequest;
    const site = br?.site;
    const negotiation = br?.rateMode === "dynamic"
      ? await app.db.negotiationRecord.findFirst({
          where: { bookingRequestId: offer.bookingRequestId, workerId: id },
          orderBy: { createdAt: "desc" },
        })
      : null;

    let travelMinutes: number | undefined;
    if (
      worker?.homeLatitude != null && worker?.homeLongitude != null &&
      site?.latitude != null && site?.longitude != null
    ) {
      const km = haversineKm(worker.homeLatitude, worker.homeLongitude, site.latitude, site.longitude);
      travelMinutes = Math.max(1, Math.round(km / AVG_URBAN_KM_PER_MIN));
    }

    const dto = {
      id: offer.id,
      role: br?.roleType ? roleLabel(br.roleType) : "Shift",
      site: site?.name ?? "",
      payPerDay: offer.payRate,
      rateMode: br?.rateMode ?? "standard",
      rateExplanation: negotiation?.explanation,
      travelMinutes,
      fitReason: offer.fitExplanation,
      shiftDate: br?.startAt ? offerDateFmt.format(new Date(br.startAt)) : undefined,
      shiftStart: br?.startAt ? offerTimeFmt.format(new Date(br.startAt)) : undefined,
      shiftEnd: br?.endAt ? offerTimeFmt.format(new Date(br.endAt)) : undefined,
      hasBriefing: Boolean(site?.siteInstructions),
      expiresAt: offer.expiresAt,
    };

    return reply.send({ offer: dto });
  });

  /** GET /v1/workers/:id — profile + guardrail policy (account hub) */
  app.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const worker = await app.db.worker.findUnique({
      where: { id },
      select: {
        ...WORKER_PROFILE_SELECT,
        guardrailPolicy: { select: WORKER_GUARDRAIL_SELECT },
      },
    });
    if (!worker) return reply.code(404).send({ error: "Worker not found." });

    const { guardrailPolicy, ...profile } = worker;
    return reply.send({ worker: toProfileDto(profile), guardrail: guardrailPolicy ?? null });
  });

  /** PATCH /v1/workers/:id — update profile fields and/or worker guardrail (payFloor, commute) */
  app.patch("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = workerProfileSchema.parse(request.body);

    const existing = await app.db.worker.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return reply.code(404).send({ error: "Worker not found." });

    const { payFloor, maxCommuteMinutes, ...workerFields } = body;
    const workerData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(workerFields)) {
      if (value !== undefined) workerData[key] = value;
    }
    const touchesGuardrail = payFloor !== undefined || maxCommuteMinutes !== undefined;

    const result = await app.db.$transaction(async (tx) => {
      const worker = Object.keys(workerData).length
        ? await tx.worker.update({
            where: { id },
            data: workerData as Prisma.WorkerUpdateInput,
            select: WORKER_PROFILE_SELECT,
          })
        : await tx.worker.findUniqueOrThrow({ where: { id }, select: WORKER_PROFILE_SELECT });

      let guardrail;
      if (touchesGuardrail) {
        const gData: Record<string, unknown> = {};
        if (payFloor !== undefined) gData.payFloor = payFloor;
        if (maxCommuteMinutes !== undefined) gData.maxCommuteMinutes = maxCommuteMinutes;
        guardrail = await tx.guardrailPolicy.upsert({
          where: { workerId: id },
          update: gData,
          create: { workerId: id, ...gData },
          select: WORKER_GUARDRAIL_SELECT,
        });
      } else {
        guardrail = await tx.guardrailPolicy.findUnique({
          where: { workerId: id },
          select: WORKER_GUARDRAIL_SELECT,
        });
      }

      await writeAuditEvent(tx, {
        actorType: "user",
        actorId: id,
        action: "worker.profile.update",
        entityType: "Worker",
        entityId: id,
        inputs: body as Prisma.InputJsonValue,
        outputs: { updatedFields: Object.keys(body) } as Prisma.InputJsonValue,
        outcome: "updated",
      });

      return { worker, guardrail: guardrail ?? null };
    });

    await app.agents.memory.rememberFromEvent({
      ownerType: "worker",
      ownerId: id,
      subjectType: "worker",
      subjectId: id,
      sourceRefType: "Worker",
      sourceRefId: id,
      text: `Worker profile or preference update: ${JSON.stringify(body)}`,
      data: { updatedFields: Object.keys(body) },
    }).catch((err) => request.log.warn({ err }, "memory inference failed after worker profile update"));

    return reply.send({ worker: toProfileDto(result.worker), guardrail: result.guardrail });
  });

  app.post("/:id/compliance/documents", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = complianceDocumentSchema.parse(request.body);

    const worker = await app.db.worker.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!worker) {
      return reply.code(404).send({ error: "Worker not found." });
    }

    const { document } = await app.db.$transaction(async (tx) => {
      const passport = await tx.passport.upsert({
        where: { workerId: id },
        update: {},
        create: {
          workerId: id,
          sectorEligibility: [],
        },
      });

      const document = await tx.complianceDocument.create({
        data: {
          passportId: passport.id,
          documentType: body.documentType,
          status: body.status,
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
          storageKey: body.storageKey,
          verifiedBy: body.verifiedBy,
          verifiedAt: body.status === "verified" ? new Date() : undefined,
        },
      });

      await writeAuditEvent(tx, {
        actorType: body.verifiedBy ? "admin" : "system",
        actorId: body.verifiedBy ?? "compliance-document-upload",
        action: "compliance.document.upload",
        entityType: "ComplianceDocument",
        entityId: document.id,
        inputs: {
          workerId: id,
          documentType: body.documentType,
          status: body.status,
          expiresAt: body.expiresAt ?? null,
          storageKey: body.storageKey ?? null,
          verifiedBy: body.verifiedBy ?? null,
          bookingRequestId: body.bookingRequestId ?? null,
        } as Prisma.InputJsonValue,
        outputs: {
          documentId: document.id,
          passportId: passport.id,
          eligibilityChecked: Boolean(body.bookingRequestId),
        } as Prisma.InputJsonValue,
        outcome: body.status,
      });

      return { document };
    });

    const eligibility = body.bookingRequestId
      ? await app.agents.compliance.checkEligibility(id, body.bookingRequestId)
      : undefined;

    return reply.code(201).send({ document, eligibility });
  });

  /** POST /v1/workers/:id/compliance/upload — base64 file upload, creates ComplianceDocument */
  app.post("/:id/compliance/upload", { bodyLimit: 15 * 1024 * 1024 }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = uploadSchema.parse(request.body);

    const worker = await app.db.worker.findUnique({ where: { id }, select: { id: true } });
    if (!worker) return reply.code(404).send({ error: "Worker not found." });

    const storageKey = makeStorageKey(body.fileName);
    try {
      await saveFile(storageKey, body.fileData);
    } catch {
      return reply.code(500).send({ error: "Failed to save file." });
    }

    const { document } = await app.db.$transaction(async (tx) => {
      const passport = await tx.passport.upsert({
        where: { workerId: id },
        update: {},
        create: { workerId: id, sectorEligibility: [] },
      });

      const document = await tx.complianceDocument.create({
        data: {
          passportId: passport.id,
          documentType: body.documentType,
          fileName: body.fileName,
          contentType: body.contentType,
          storageKey,
          status: "pending",
        },
      });

      await writeAuditEvent(tx, {
        actorType: "user",
        actorId: id,
        action: "compliance.document.upload",
        entityType: "ComplianceDocument",
        entityId: document.id,
        inputs: {
          workerId: id,
          documentType: body.documentType,
          fileName: body.fileName,
          contentType: body.contentType,
          storageKey,
        } as Prisma.InputJsonValue,
        outputs: { documentId: document.id, passportId: passport.id } as Prisma.InputJsonValue,
        outcome: "pending",
      });

      return { document };
    });

    return reply.code(201).send({ document });
  });

  /** GET /v1/workers/:id/compliance/documents — list documents with passport summary */
  app.get("/:id/compliance/documents", async (request, reply) => {
    const { id } = request.params as { id: string };

    const worker = await app.db.worker.findUnique({
      where: { id },
      select: {
        passport: {
          include: {
            documents: { orderBy: { createdAt: "desc" } },
          },
        },
      },
    });

    if (!worker) return reply.code(404).send({ error: "Worker not found." });

    const docs = worker.passport?.documents ?? [];
    const documents = docs.map((doc) => ({
      ...doc,
      downloadUrl: doc.storageKey
        ? `/v1/workers/${id}/compliance/documents/${doc.id}/file`
        : null,
    }));

    const p = worker.passport;
    const passport = p
      ? {
          identityVerified: p.identityVerified,
          dbsStatus: p.dbsStatus,
          rightToWorkStatus: p.rightToWorkStatus,
          safeguardingStatus: p.safeguardingStatus,
          qtsStatus: p.qtsStatus,
          siaStatus: p.siaStatus,
          reliabilityScore: p.reliabilityScore,
        }
      : null;

    return reply.send({ documents, passport });
  });

  /** GET /v1/workers/:id/compliance/documents/:docId/file — serve uploaded file */
  app.get("/:id/compliance/documents/:docId/file", async (request, reply) => {
    const { id, docId } = request.params as { id: string; docId: string };

    const doc = await app.db.complianceDocument.findUnique({
      where: { id: docId },
      include: { passport: { select: { workerId: true } } },
    });

    if (!doc || doc.passport.workerId !== id) {
      return reply.code(404).send({ error: "Not found." });
    }
    if (!doc.storageKey) {
      return reply.code(404).send({ error: "No file attached." });
    }

    let data: Buffer;
    try {
      data = await readFile(doc.storageKey);
    } catch {
      return reply.code(404).send({ error: "File not found on disk." });
    }

    const ct = doc.contentType ?? mimeFromKey(doc.storageKey);
    const name = doc.fileName ?? doc.storageKey;
    reply.header("Content-Type", ct);
    reply.header("Content-Disposition", `inline; filename="${name}"`);
    return reply.send(data);
  });

  app.post("/:id/offers/:offerId/accept", async (request, reply) => {
    const { id: workerId, offerId } = request.params as { id: string; offerId: string };

    const existing = await app.db.offer.findUnique({
      where: { id: offerId },
      select: { workerId: true, bookingRequestId: true },
    });

    if (!existing || existing.workerId !== workerId) {
      return reply.code(404).send({ error: "Offer not found." });
    }

    const result = await app.agents.employer.processRequest(
      existing.bookingRequestId,
      offerId,
      workerId,
    );

    if (!result.success) {
      if (
        result.requiresHumanApproval &&
        result.auditPayload.queueAction === "booking.create" &&
        typeof result.auditPayload.organisationId === "string"
      ) {
        const approval = await queuePendingApproval(app.db, {
          organisationId: result.auditPayload.organisationId,
          actorType: "user",
          actorId: workerId,
          action: "booking.create",
          entityType: "Offer",
          entityId: offerId,
          inputs: {
            bookingRequestId: existing.bookingRequestId,
            offerId,
            workerId,
            guardrail: result.auditPayload.guardrail ?? null,
          } as Prisma.InputJsonValue,
          explanation: result.explanation,
        });
        return reply.code(202).send({
          requiresHumanApproval: true,
          approval,
          explanation: result.explanation,
        });
      }
      return reply.code(409).send(result);
    }

    return reply.send({ booking: result.data, message: result.explanation });
  });

  app.post("/:id/offers/:offerId/decline", async (request, reply) => {
    const { id, offerId } = request.params as { id: string; offerId: string };

    const existing = await app.db.offer.findUnique({
      where: { id: offerId },
      select: { workerId: true, status: true },
    });

    if (!existing || existing.workerId !== id) {
      return reply.code(404).send({ error: "Offer not found." });
    }

    if (existing.status !== "pending") {
      return reply.code(409).send({ error: `Offer already ${existing.status}.` });
    }

    const offer = await app.db.offer.update({
      where: { id: offerId },
      data: { status: "declined" },
    });
    await writeAuditEvent(app.db, {
      actorType: "user",
      actorId: id,
      action: "offer.decline",
      entityType: "Offer",
      entityId: offer.id,
      inputs: { workerId: id, offerId } as Prisma.InputJsonValue,
      outputs: { status: offer.status } as Prisma.InputJsonValue,
      outcome: "declined",
    });
    await app.agents.memory.recordOfferOutcome(offer.id, "declined")
      .catch((err) => request.log.warn({ err }, "memory edge update failed after offer decline"));
    return reply.send({ offer, message: "Shift declined." });
  });

  app.post("/:id/shifts/:shiftId/check-in", async (request, reply) => {
    const { id: workerId, shiftId } = request.params as { id: string; shiftId: string };
    const body = shiftLocationSchema.parse(request.body ?? {});

    const existing = await app.db.shift.findUnique({
      where: { id: shiftId },
      include: { booking: { include: { site: true } } },
    });

    if (!existing) return reply.code(404).send({ error: "Shift not found." });
    if (existing.booking.workerId !== workerId) return reply.code(403).send({ error: "Forbidden." });
    if (existing.status !== "scheduled") {
      return reply.code(409).send({ error: `Shift already ${existing.status}.` });
    }

    // GPS validation — only if worker sends coords and site has coordinates
    if (body.latitude != null && body.longitude != null) {
      const { latitude: siteLat, longitude: siteLon } = existing.booking.site;
      if (siteLat != null && siteLon != null) {
        const distanceKm = haversineKm(body.latitude, body.longitude, siteLat, siteLon);
        if (distanceKm > CHECK_IN_RADIUS_KM) {
          await writeAuditEvent(app.db, {
            actorType: "user",
            actorId: workerId,
            action: "shift.check_in",
            entityType: "Shift",
            entityId: shiftId,
            inputs: { workerId, shiftId, latitude: body.latitude, longitude: body.longitude } as Prisma.InputJsonValue,
            outputs: { distanceKm, thresholdKm: CHECK_IN_RADIUS_KM } as Prisma.InputJsonValue,
            outcome: "rejected_too_far",
          });
          await app.agents.memory.recordShiftEvent(shiftId, "rejected_too_far")
            .catch((err) => request.log.warn({ err }, "memory edge update failed after check-in rejection"));
          return reply.code(422).send({
            error: "Too far from site.",
            distanceKm: Number(distanceKm.toFixed(3)),
            thresholdKm: CHECK_IN_RADIUS_KM,
          });
        }
      }
    }

    const shift = await app.db.shift.update({
      where: { id: shiftId },
      data: {
        status: "checked_in",
        checkedInAt: new Date(),
        checkInLatitude: body.latitude,
        checkInLongitude: body.longitude,
      },
    });

    await writeAuditEvent(app.db, {
      actorType: "user",
      actorId: workerId,
      action: "shift.check_in",
      entityType: "Shift",
      entityId: shift.id,
      inputs: { workerId, shiftId, latitude: body.latitude ?? null, longitude: body.longitude ?? null } as Prisma.InputJsonValue,
      outputs: { status: shift.status, checkedInAt: shift.checkedInAt?.toISOString() ?? null } as Prisma.InputJsonValue,
      outcome: "checked_in",
    });
    await app.agents.memory.recordShiftEvent(shift.id, "checked_in")
      .catch((err) => request.log.warn({ err }, "memory edge update failed after check-in"));

    return reply.send({ shift });
  });

  app.post("/:id/shifts/:shiftId/check-out", async (request, reply) => {
    const { id: workerId, shiftId } = request.params as { id: string; shiftId: string };

    const existing = await app.db.shift.findUnique({
      where: { id: shiftId },
      include: { booking: true },
    });

    if (!existing) return reply.code(404).send({ error: "Shift not found." });
    if (existing.booking.workerId !== workerId) return reply.code(403).send({ error: "Forbidden." });
    if (existing.status !== "checked_in") {
      return reply.code(409).send({ error: `Cannot check out from status ${existing.status}.` });
    }

    const checkedOutAt = new Date();
    const hoursWorked = Number(
      ((checkedOutAt.getTime() - existing.checkedInAt!.getTime()) / 3_600_000).toFixed(2),
    );

    const { shift, timesheet } = await app.db.$transaction(async (tx) => {
      const shift = await tx.shift.update({
        where: { id: shiftId },
        data: { status: "checked_out", checkedOutAt },
      });

      const timesheet = await tx.timesheet.create({
        data: {
          shiftId,
          bookingId: existing.bookingId,
          workerId,
          organisationId: existing.booking.organisationId,
          hoursWorked,
        },
      });

      await writeAuditEvent(tx, {
        actorType: "user",
        actorId: workerId,
        action: "shift.check_out",
        entityType: "Shift",
        entityId: shiftId,
        inputs: { workerId, shiftId } as Prisma.InputJsonValue,
        outputs: {
          status: shift.status,
          checkedOutAt: checkedOutAt.toISOString(),
          hoursWorked,
          timesheetId: timesheet.id,
        } as Prisma.InputJsonValue,
        outcome: "checked_out",
      });

      return { shift, timesheet };
    });

    await app.agents.memory.recordShiftEvent(shift.id, "checked_out")
      .catch((err) => request.log.warn({ err }, "memory edge update failed after check-out"));

    return reply.send({ shift, timesheet });
  });
};
