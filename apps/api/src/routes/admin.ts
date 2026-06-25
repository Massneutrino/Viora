import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { Prisma } from "@viora/database";
import { createLLMClient } from "@viora/agents";
import { executePendingApproval, queuePendingApproval } from "../approvals.js";
import { writeAuditEvent } from "../audit.js";

const askSchema = z.object({
  question: z.string().min(1).max(2000),
  adminId: z.string().min(1).optional(),
});

const approveTimesheetSchema = z.object({
  approvedBy: z.string().min(1),
});

const generateInvoiceSchema = z.object({
  organisationId: z.string().min(1),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
});

const assignBookingSchema = z.object({
  workerId: z.string().min(1),
  adminId: z.string().min(1),
});

const cancelBookingSchema = z.object({
  adminId: z.string().min(1),
  reason: z.string().min(1).optional(),
});

const approveLeadSchema = z.object({
  adminId: z.string().min(1).optional(),
});

const approvalResolveSchema = z.object({
  adminId: z.string().min(1).default("admin"),
});

const approvalRejectSchema = z.object({
  adminId: z.string().min(1).default("admin"),
  reason: z.string().min(1).optional(),
});

/** Stable, URL-safe id fragment so approving the same lead twice is idempotent. */
function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "x"
  );
}

const reopenBookingSchema = z.object({
  adminId: z.string().min(1),
  strategy: z
    .enum([
      "simultaneous_top_n",
      "sequential",
      "preferred_first",
      "known_worker_only",
      "auto_book",
      "manual_approval",
    ])
    .optional(),
});

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.get("/ops/unfilled", async () => {
    const unfilled = await app.agents.ops.getUnfilledShifts();
    return { unfilled };
  });

  app.get("/ops/market-health", async () => {
    return app.agents.ops.getMarketHealthSummary();
  });

  app.get("/ops/stats", async () => {
    return app.agents.ops.getOpsStats();
  });

  /** POST /v1/admin/ops/ask — data-aware Q&A console for the ops team. */
  app.post("/ops/ask", async (request, reply) => {
    const body = askSchema.parse(request.body);
    const adminId = body.adminId ?? "admin";

    const [stats, marketHealth] = await Promise.all([
      app.agents.ops.getOpsStats(),
      app.agents.ops.getMarketHealthSummary(),
    ]);

    const context = JSON.stringify({ marketHealth, stats });
    const system =
      "You are V, the internal operations analyst for Viora, an AI-native staffing platform for " +
      "schools. Answer the operator's question using ONLY the live metrics provided in the " +
      "CONTEXT JSON. Be concise and direct — a sentence or two, with the relevant numbers. If the " +
      "answer is not in the data, say so plainly. Do not invent figures.";
    const prompt = `CONTEXT:\n${context}\n\nQUESTION: ${body.question}`;

    let answer: string;
    let degraded = false;
    try {
      const llm = await createLLMClient();
      answer = await llm.complete({ system, prompt, maxTokens: 512 });
    } catch (err) {
      request.log.error(err, "ops.ask LLM call failed");
      degraded = true;
      answer =
        "V is temporarily unavailable, so I can't answer that right now. The live metrics are " +
        "still shown in the dashboard panels.";
    }

    await writeAuditEvent(app.db, {
      actorType: "admin",
      actorId: adminId,
      action: "ops.ask",
      entityType: "OpsConsole",
      entityId: "ask",
      inputs: { question: body.question } as Prisma.InputJsonValue,
      outputs: { answerPreview: answer.slice(0, 280) } as Prisma.InputJsonValue,
      outcome: degraded ? "degraded_llm_unavailable" : "success",
    });

    return reply.send({ answer, degraded });
  });

  app.get("/audit", async () => {
    const events = await app.db.auditEvent.findMany({
      take: 100,
      orderBy: { createdAt: "desc" },
    });
    return { events };
  });

  app.get("/approvals", async () => {
    const approvals = await app.db.pendingApproval.findMany({
      where: { status: "pending" },
      include: { organisation: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return { approvals };
  });

  app.post("/approvals/:id/approve", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = approvalResolveSchema.parse(request.body ?? {});

    const approval = await app.db.pendingApproval.findUnique({ where: { id } });
    if (!approval) return reply.code(404).send({ error: "PendingApproval not found." });
    if (approval.status !== "pending") {
      return reply.code(409).send({ error: `Approval is already ${approval.status}.` });
    }

    const execution = await executePendingApproval(app, approval, body.adminId);
    if (!execution.success) {
      await writeAuditEvent(app.db, {
        actorType: "admin",
        actorId: body.adminId,
        action: "approval.approve",
        entityType: "PendingApproval",
        entityId: id,
        inputs: { approvalId: id, action: approval.action } as Prisma.InputJsonValue,
        outputs: execution.outputs,
        outcome: "execution_failed",
      });
      return reply.code(409).send({
        success: false,
        explanation: execution.explanation,
      });
    }

    const updated = await app.db.$transaction(async (tx) => {
      const resolved = await tx.pendingApproval.update({
        where: { id },
        data: {
          status: "approved",
          resolvedAt: new Date(),
          resolvedBy: body.adminId,
        },
      });

      await writeAuditEvent(tx, {
        actorType: "admin",
        actorId: body.adminId,
        action: "approval.approve",
        entityType: "PendingApproval",
        entityId: id,
        inputs: {
          approvalId: id,
          action: approval.action,
          entityType: approval.entityType,
          entityId: approval.entityId,
        } as Prisma.InputJsonValue,
        outputs: execution.outputs,
        outcome: "approved",
      });

      return resolved;
    });

    return reply.send({ approval: updated, execution });
  });

  app.post("/approvals/:id/reject", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = approvalRejectSchema.parse(request.body ?? {});

    const approval = await app.db.pendingApproval.findUnique({ where: { id } });
    if (!approval) return reply.code(404).send({ error: "PendingApproval not found." });
    if (approval.status !== "pending") {
      return reply.code(409).send({ error: `Approval is already ${approval.status}.` });
    }

    const updated = await app.db.$transaction(async (tx) => {
      const resolved = await tx.pendingApproval.update({
        where: { id },
        data: {
          status: "rejected",
          resolvedAt: new Date(),
          resolvedBy: body.adminId,
        },
      });

      await writeAuditEvent(tx, {
        actorType: "admin",
        actorId: body.adminId,
        action: "approval.reject",
        entityType: "PendingApproval",
        entityId: id,
        inputs: {
          approvalId: id,
          action: approval.action,
          reason: body.reason ?? null,
        } as Prisma.InputJsonValue,
        outputs: { status: "rejected" } as Prisma.InputJsonValue,
        outcome: "rejected",
      });

      return resolved;
    });

    return reply.send({ approval: updated });
  });

  app.get("/negotiations", async () => {
    const negotiations = await app.db.negotiationRecord.findMany({
      take: 50,
      orderBy: { createdAt: "desc" },
    });
    const bookingRequestIds = [...new Set(negotiations.map((record) => record.bookingRequestId))];
    const bookingRequests = await app.db.bookingRequest.findMany({
      where: { id: { in: bookingRequestIds } },
      select: {
        id: true,
        roleType: true,
        rateMode: true,
        payRate: true,
        maxPayRate: true,
        site: { select: { name: true } },
        organisation: { select: { name: true } },
      },
    });
    const byId = new Map(bookingRequests.map((bookingRequest) => [bookingRequest.id, bookingRequest]));
    return {
      negotiations: negotiations.map((record) => ({
        ...record,
        bookingRequest: byId.get(record.bookingRequestId) ?? null,
      })),
    };
  });

  app.get("/pilot/leads", async () => {
    const leads = await app.db.pilotLead.findMany({
      take: 50,
      orderBy: { createdAt: "desc" },
    });
    return { leads };
  });

  /** POST /v1/admin/pilot/leads/:id/approve — mint the account + return an access link. Idempotent. */
  app.post("/pilot/leads/:id/approve", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { adminId = "admin" } = approveLeadSchema.parse(request.body ?? {});

    const lead = await app.db.pilotLead.findUnique({ where: { id } });
    if (!lead) return reply.code(404).send({ error: "Pilot lead not found." });

    const webUrl = process.env.WEB_URL ?? "http://localhost:6100";
    const workerWebUrl = process.env.WORKER_WEB_URL ?? "http://localhost:6102";

    const result = await app.db.$transaction(async (tx) => {
      let accountType: "organisation" | "worker";
      let accountId: string;
      let link: string;

      if (lead.leadType === "employer") {
        const orgName = lead.organisationName?.trim() || lead.name;
        const orgId = `org-${slugify(orgName)}`;
        const org = await tx.organisation.upsert({
          where: { id: orgId },
          update: { name: orgName },
          create: { id: orgId, name: orgName, type: "school", sector: "education" },
        });
        await tx.site.upsert({
          where: { id: `${orgId}-main` },
          update: {},
          create: {
            id: `${orgId}-main`,
            organisationId: org.id,
            name: `${orgName} — main site`,
            address: lead.postcode?.trim() || "To be confirmed",
          },
        });
        await tx.guardrailPolicy.upsert({
          where: { organisationId: org.id },
          update: {},
          create: {
            organisationId: org.id,
            autonomyLevel: "L2",
            approvedRoleTypes: lead.roleTitle ? [lead.roleTitle] : [],
            workerWhitelist: [],
            workerBlocklist: [],
            escalationContacts: lead.email ? [lead.email] : [],
          },
        });
        await tx.employerUser.upsert({
          where: { email: lead.email },
          update: { name: lead.name, organisationId: org.id },
          create: { email: lead.email, name: lead.name, organisationId: org.id, role: "organisation_admin" },
        });
        accountType = "organisation";
        accountId = org.id;
        link = `${webUrl}/?orgId=${encodeURIComponent(org.id)}`;
      } else {
        const parts = lead.name.trim().split(/\s+/);
        const firstName = parts[0] || lead.name;
        const lastName = parts.slice(1).join(" ") || "—";
        const workerId = `wkr-${slugify(lead.email)}`;
        const worker = await tx.worker.upsert({
          where: { email: lead.email },
          update: { firstName, lastName, phone: lead.phone ?? undefined, roleTypes: lead.workerRoleTypes },
          create: {
            id: workerId,
            email: lead.email,
            firstName,
            lastName,
            phone: lead.phone ?? undefined,
            roleTypes: lead.workerRoleTypes,
          },
        });
        await tx.passport.upsert({
          where: { workerId: worker.id },
          update: {},
          create: { workerId: worker.id, sectorEligibility: ["education"] },
        });
        await tx.guardrailPolicy.upsert({
          where: { workerId: worker.id },
          update: {},
          create: {
            workerId: worker.id,
            autonomyLevel: "L2",
            approvedRoleTypes: lead.workerRoleTypes,
            workerWhitelist: [],
            workerBlocklist: [],
            escalationContacts: [],
          },
        });
        accountType = "worker";
        accountId = worker.id;
        link = `${workerWebUrl}/?workerId=${encodeURIComponent(worker.id)}`;
      }

      const updatedLead = await tx.pilotLead.update({
        where: { id },
        data: { status: "approved" },
      });

      await writeAuditEvent(tx, {
        actorType: "admin",
        actorId: adminId,
        action: "pilot.lead.approve",
        entityType: "PilotLead",
        entityId: id,
        inputs: { leadType: lead.leadType, email: lead.email } as Prisma.InputJsonValue,
        outputs: { accountType, accountId, link } as Prisma.InputJsonValue,
        outcome: "approved",
      });

      return { lead: updatedLead, accountType, accountId, link };
    });

    return reply.send(result);
  });

  app.get("/compliance/queue", async () => {
    const pending = await app.db.complianceDocument.findMany({
      where: { status: "pending" },
      include: { passport: { include: { worker: true } } },
      take: 50,
    });
    return { pending };
  });

  /** POST /v1/admin/bookings/:id/assign */
  app.post("/bookings/:id/assign", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = assignBookingSchema.parse(request.body);

    let bookingRequest = await app.db.bookingRequest.findUnique({
      where: { id },
      include: { booking: true },
    });

    if (!bookingRequest) {
      const booking = await app.db.booking.findUnique({
        where: { id },
        include: { bookingRequest: { include: { booking: true } } },
      });
      bookingRequest = booking?.bookingRequest ?? null;
    }

    if (!bookingRequest) {
      return reply.code(404).send({ error: "BookingRequest or Booking not found." });
    }

    const existingBooking = bookingRequest.booking;
    const canAssignOpenRequest = ["pending_confirmation", "confirmed", "broadcasting"].includes(
      bookingRequest.status,
    );
    const canReassignBooking =
      existingBooking && ["cancelled", "at_risk"].includes(existingBooking.status);

    if (!canAssignOpenRequest && !canReassignBooking) {
      return reply.code(409).send({
        error: `Cannot assign worker while booking request is ${bookingRequest.status}.`,
      });
    }

    const worker = await app.db.worker.findUnique({
      where: { id: body.workerId },
      select: { id: true },
    });
    if (!worker) return reply.code(404).send({ error: "Worker not found." });

    const eligibility = await app.agents.compliance.checkEligibility(
      body.workerId,
      bookingRequest.id,
    );
    if (!eligibility.eligible) {
      await writeAuditEvent(app.db, {
        actorType: "admin",
        actorId: body.adminId,
        action: "booking.assign",
        entityType: "BookingRequest",
        entityId: bookingRequest.id,
        inputs: {
          bookingRequestId: bookingRequest.id,
          workerId: body.workerId,
        } as Prisma.InputJsonValue,
        outputs: { eligibility } as Prisma.InputJsonValue,
        outcome: "compliance_failed",
      });
      return reply.code(409).send({
        success: false,
        explanation: eligibility.reason ?? "Worker is not eligible for this booking.",
        requiresHumanApproval: true,
        auditPayload: { bookingRequestId: bookingRequest.id, workerId: body.workerId, eligibility },
      });
    }

    const offer = await app.db.$transaction(async (tx) => {
      if (canReassignBooking && bookingRequest.status === "cancelled") {
        await tx.bookingRequest.update({
          where: { id: bookingRequest.id },
          data: { status: "broadcasting" },
        });
      }

      const created = await tx.offer.create({
        data: {
          bookingRequestId: bookingRequest.id,
          workerId: body.workerId,
          status: "pending",
          payRate: bookingRequest.payRate,
          fitExplanation: "Manual admin assignment.",
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });

      await writeAuditEvent(tx, {
        actorType: "admin",
        actorId: body.adminId,
        action: "booking.assign",
        entityType: "BookingRequest",
        entityId: bookingRequest.id,
        inputs: {
          bookingRequestId: bookingRequest.id,
          workerId: body.workerId,
        } as Prisma.InputJsonValue,
        outputs: { offerId: created.id } as Prisma.InputJsonValue,
        outcome: "manual_offer_created",
      });

      return created;
    });

    const result = await app.agents.employer.processRequest(
      bookingRequest.id,
      offer.id,
      body.workerId,
      { approvedBy: body.adminId },
    );

    if (!result.success) return reply.code(409).send(result);
    return reply.send({ booking: result.data, message: result.explanation });
  });

  /** POST /v1/admin/bookings/:id/cancel */
  app.post("/bookings/:id/cancel", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = cancelBookingSchema.parse(request.body);

    const existing = await app.db.booking.findUnique({
      where: { id },
      include: { shift: true, bookingRequest: true },
    });

    if (!existing) return reply.code(404).send({ error: "Booking not found." });
    if (existing.status === "completed") {
      return reply.code(409).send({ error: "Completed bookings cannot be cancelled." });
    }
    if (existing.status === "cancelled") {
      return reply.code(409).send({ error: "Booking already cancelled." });
    }

    const result = await app.db.$transaction(async (tx) => {
      const booking = await tx.booking.update({
        where: { id },
        data: { status: "cancelled" },
      });

      const shift = existing.shift
        ? await tx.shift.update({
            where: { id: existing.shift.id },
            data: { status: "cancelled" },
          })
        : null;

      const bookingRequest = await tx.bookingRequest.update({
        where: { id: existing.bookingRequestId },
        data: { status: "cancelled" },
      });

      await tx.offer.updateMany({
        where: {
          bookingRequestId: existing.bookingRequestId,
          status: "pending",
        },
        data: { status: "declined" },
      });

      await writeAuditEvent(tx, {
        actorType: "admin",
        actorId: body.adminId,
        action: "booking.cancel",
        entityType: "Booking",
        entityId: id,
        inputs: {
          bookingId: id,
          reason: body.reason ?? null,
        } as Prisma.InputJsonValue,
        outputs: {
          bookingStatus: booking.status,
          bookingRequestStatus: bookingRequest.status,
          shiftStatus: shift?.status ?? null,
        } as Prisma.InputJsonValue,
        outcome: "cancelled",
      });

      return { booking, shift, bookingRequest };
    });

    const replacement = await app.agents.employer.triggerReplacement(id);
    const approval = replacement.requiresHumanApproval &&
      replacement.auditPayload.queueAction === "replacement.trigger"
      ? await queuePendingApproval(app.db, {
          organisationId: result.booking.organisationId,
          actorType: "agent",
          actorId: "employer_context",
          action: "replacement.trigger",
          entityType: "Booking",
          entityId: id,
          inputs: {
            bookingId: id,
            bookingRequestId: existing.bookingRequestId,
            triggeredBy: { actorType: "admin", actorId: body.adminId },
            guardrail: replacement.auditPayload.guardrail ?? null,
          } as Prisma.InputJsonValue,
          explanation: replacement.explanation,
        })
      : null;

    return reply.send({
      ...result,
      replacement,
      approval,
      message: replacement.success
        ? "Booking cancelled and replacement flow started."
        : approval
          ? "Booking cancelled; replacement queued for approval."
        : "Booking cancelled; replacement requires manual follow-up.",
    });
  });

  /** POST /v1/admin/bookings/:id/reopen */
  app.post("/bookings/:id/reopen", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = reopenBookingSchema.parse(request.body);

    const booking = await app.db.booking.findUnique({
      where: { id },
      include: { bookingRequest: true },
    });

    if (!booking) return reply.code(404).send({ error: "Booking not found." });
    if (!["cancelled", "at_risk"].includes(booking.status)) {
      return reply.code(409).send({
        error: `Booking is ${booking.status}, so it cannot be reopened for replacement.`,
      });
    }

    await app.db.$transaction(async (tx) => {
      if (body.strategy) {
        await tx.bookingRequest.update({
          where: { id: booking.bookingRequestId },
          data: { broadcastStrategy: body.strategy },
        });
      }

      await writeAuditEvent(tx, {
        actorType: "admin",
        actorId: body.adminId,
        action: "booking.reopen",
        entityType: "Booking",
        entityId: id,
        inputs: {
          bookingId: id,
          strategy: body.strategy ?? null,
        } as Prisma.InputJsonValue,
        outputs: {
          bookingRequestId: booking.bookingRequestId,
        } as Prisma.InputJsonValue,
        outcome: "replacement_requested",
      });
    });

    const replacement = await app.agents.employer.triggerReplacement(id);
    const approval = replacement.requiresHumanApproval &&
      replacement.auditPayload.queueAction === "replacement.trigger"
      ? await queuePendingApproval(app.db, {
          organisationId: booking.organisationId,
          actorType: "agent",
          actorId: "employer_context",
          action: "replacement.trigger",
          entityType: "Booking",
          entityId: id,
          inputs: {
            bookingId: id,
            bookingRequestId: booking.bookingRequestId,
            triggeredBy: { actorType: "admin", actorId: body.adminId },
            guardrail: replacement.auditPayload.guardrail ?? null,
          } as Prisma.InputJsonValue,
          explanation: replacement.explanation,
        })
      : null;
    const bookingRequest = await app.db.bookingRequest.findUnique({
      where: { id: booking.bookingRequestId },
    });

    return reply.send({
      bookingRequest,
      replacement,
      approval,
      message: replacement.success
        ? "Booking reopened and replacement flow started."
        : approval
          ? "Booking reopened; replacement queued for approval."
        : "Booking reopened; replacement requires manual follow-up.",
    });
  });

  /** POST /v1/admin/timesheets/:id/approve */
  app.post("/timesheets/:id/approve", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = approveTimesheetSchema.parse(request.body);

    const existing = await app.db.timesheet.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "Timesheet not found." });
    if (existing.approved) return reply.code(409).send({ error: "Timesheet already approved." });

    const timesheet = await app.db.$transaction(async (tx) => {
      const updated = await tx.timesheet.update({
        where: { id },
        data: { approved: true, approvedAt: new Date(), approvedBy: body.approvedBy },
      });

      await writeAuditEvent(tx, {
        actorType: "admin",
        actorId: body.approvedBy,
        action: "timesheet.approve",
        entityType: "Timesheet",
        entityId: id,
        inputs: { timesheetId: id, approvedBy: body.approvedBy } as Prisma.InputJsonValue,
        outputs: {
          hoursWorked: updated.hoursWorked,
          workerId: updated.workerId,
        } as Prisma.InputJsonValue,
        outcome: "approved",
      });

      return updated;
    });

    return reply.send({ timesheet });
  });

  /** POST /v1/admin/invoices/generate */
  app.post("/invoices/generate", async (request, reply) => {
    const body = generateInvoiceSchema.parse(request.body);
    const periodStart = new Date(body.periodStart);
    const periodEnd = new Date(body.periodEnd);

    const timesheets = await app.db.timesheet.findMany({
      where: {
        organisationId: body.organisationId,
        approved: true,
        booking: {
          startAt: { gte: periodStart },
          endAt: { lte: periodEnd },
        },
      },
      include: { booking: true },
    });

    if (timesheets.length === 0) {
      return reply.code(409).send({
        error: "No approved timesheets found for this organisation and period.",
      });
    }

    const workerPayTotal = timesheets.reduce(
      (sum, t) => sum + t.booking.payRate * t.hoursWorked,
      0,
    );
    const vioraFeeTotal = timesheets.reduce(
      (sum, t) => sum + t.booking.vioraFee * t.hoursWorked,
      0,
    );
    const totalAmount = workerPayTotal + vioraFeeTotal;

    const invoice = await app.db.$transaction(async (tx) => {
      const created = await tx.invoice.create({
        data: {
          organisationId: body.organisationId,
          periodStart,
          periodEnd,
          workerPayTotal: Number(workerPayTotal.toFixed(2)),
          vioraFeeTotal: Number(vioraFeeTotal.toFixed(2)),
          totalAmount: Number(totalAmount.toFixed(2)),
          status: "draft",
        },
      });

      await writeAuditEvent(tx, {
        actorType: "admin",
        actorId: "system",
        action: "invoice.generate",
        entityType: "Invoice",
        entityId: created.id,
        inputs: {
          organisationId: body.organisationId,
          periodStart: body.periodStart,
          periodEnd: body.periodEnd,
          timesheetCount: timesheets.length,
        } as Prisma.InputJsonValue,
        outputs: {
          workerPayTotal: created.workerPayTotal,
          vioraFeeTotal: created.vioraFeeTotal,
          totalAmount: created.totalAmount,
        } as Prisma.InputJsonValue,
        outcome: "draft",
      });

      return created;
    });

    return reply.send({ invoice });
  });

  /** GET /v1/admin/invoices/:id/export — CSV download */
  app.get("/invoices/:id/export", async (request, reply) => {
    const { id } = request.params as { id: string };

    const invoice = await app.db.invoice.findUnique({ where: { id } });
    if (!invoice) return reply.code(404).send({ error: "Invoice not found." });

    const timesheets = await app.db.timesheet.findMany({
      where: {
        organisationId: invoice.organisationId,
        approved: true,
        booking: {
          startAt: { gte: invoice.periodStart },
          endAt: { lte: invoice.periodEnd },
        },
      },
      include: { booking: { include: { worker: true } } },
      orderBy: { createdAt: "asc" },
    });

    const header = "WorkerName,ShiftDate,Role,HoursWorked,PayRate,WorkerTotal,VioraFee,LineTotal";
    const rows = timesheets.map((t) => {
      const workerName = `${t.booking.worker.firstName} ${t.booking.worker.lastName}`;
      const shiftDate = t.booking.startAt.toISOString().slice(0, 10);
      const workerTotal = Number((t.booking.payRate * t.hoursWorked).toFixed(2));
      const vioraFee = Number((t.booking.vioraFee * t.hoursWorked).toFixed(2));
      const lineTotal = Number((workerTotal + vioraFee).toFixed(2));
      return [
        `"${workerName}"`,
        shiftDate,
        t.booking.roleType,
        t.hoursWorked,
        t.booking.payRate,
        workerTotal,
        vioraFee,
        lineTotal,
      ].join(",");
    });

    const csv = [header, ...rows].join("\n");

    await writeAuditEvent(app.db, {
      actorType: "admin",
      actorId: "system",
      action: "invoice.export",
      entityType: "Invoice",
      entityId: id,
      inputs: {
        invoiceId: id,
        organisationId: invoice.organisationId,
        periodStart: invoice.periodStart.toISOString(),
        periodEnd: invoice.periodEnd.toISOString(),
      } as Prisma.InputJsonValue,
      outputs: {
        rowCount: timesheets.length,
        filename: `invoice-${id}.csv`,
      } as Prisma.InputJsonValue,
      outcome: "exported",
    });

    reply.header("Content-Type", "text/csv");
    reply.header("Content-Disposition", `attachment; filename="invoice-${id}.csv"`);
    return reply.send(csv);
  });
};
