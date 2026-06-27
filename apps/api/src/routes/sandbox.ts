import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type { Prisma, PrismaClient } from "@viora/database";
import { z } from "zod";

const SANDBOX_PREFIX = "[sandbox:";
const ADMIN_ID = "sandbox-admin";
const MEMORY_LAB_SOURCE = "MemoryLab";

type SandboxActor = "employer" | "v" | "market" | "worker" | "compliance" | "ops";
type CoverageStatus =
  | "requested"
  | "accepted"
  | "declined"
  | "backup"
  | "compliance-blocked"
  | "role-excluded";

type TimelineItem = {
  id: string;
  at: string;
  actor: SandboxActor;
  action: string;
  summary: string;
  outcome: string;
  entityIds: Record<string, string | string[] | null>;
};

type ScenarioSummary = {
  conversations: number;
  bookingRequests: number;
  matches: number;
  offers: number;
  bookings: number;
  shifts: number;
  timesheets: number;
  invoices: number;
  auditEvents: number;
};

type AvatarCoverage = {
  id: string;
  name: string;
  kind: "employer" | "worker";
  status: CoverageStatus;
  note: string;
};

type ScenarioRunResult = {
  runId: string;
  scenarioId: string;
  title: string;
  summary: ScenarioSummary;
  timeline: TimelineItem[];
  coverage: AvatarCoverage[];
};

type BookingSeed = {
  orgId: string;
  roleType: string;
  rawRequest: string;
  payRate: number;
  maxPayRate?: number;
  rateMode?: Prisma.BookingRequestCreateInput["rateMode"];
  startOffsetHours: number;
  durationHours: number;
  strategy?: Prisma.BookingRequestCreateInput["broadcastStrategy"];
};

const SCENARIOS = [
  {
    id: "single-cover-loop",
    title: "Single Cover Loop",
    description:
      "Greenfield requests KS2 cover, V confirms, Market broadcasts, Alex accepts, then shift, timesheet and invoice complete.",
  },
  {
    id: "all-avatars-market-day",
    title: "All Avatars Market Day",
    description:
      "All six employer avatars create requests and the worker pool appears across accepted, declined, backup and blocked states.",
  },
  {
    id: "compliance-block-unlock",
    title: "Compliance Block + Unlock",
    description:
      "Tom is blocked by DBS, the admin verifies the document, then rebroadcast makes him eligible.",
  },
  {
    id: "replacement-recovery",
    title: "Replacement Recovery",
    description:
      "A confirmed booking is cancelled and the employer context agent reopens the request for backup workers.",
  },
  {
    id: "dynamic-rate-clearing",
    title: "Dynamic Rate Clearing",
    description:
      "Greenfield posts a dynamic-rate request, Market clears worker floors under the cap, and workers receive rate-specific offers.",
  },
] as const;

type ScenarioId = (typeof SCENARIOS)[number]["id"];

const memoryOwnerSchema = z.enum(["organisation", "worker"]);
const memorySubjectSchema = z.enum([
  "organisation",
  "site",
  "worker",
  "role",
  "booking_request",
  "booking",
  "shift",
  "relationship",
]);
const memoryKindSchema = z.enum([
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
const memoryVisibilitySchema = z.enum(["private", "operational", "shared"]);
const memoryStatusSchema = z.enum(["pending_confirmation", "active", "archived", "deleted"]);

const memoryLabMemorySchema = z
  .object({
    ownerType: memoryOwnerSchema.default("organisation"),
    ownerId: z.string().min(1).default("demo-org"),
    subjectType: memorySubjectSchema.optional(),
    subjectId: z.string().min(1).optional(),
    kind: memoryKindSchema.default("preference"),
    title: z.string().min(1).max(180),
    content: z.string().min(1).max(2000),
    visibility: memoryVisibilitySchema.default("operational"),
    status: memoryStatusSchema.default("active"),
    confidence: z.number().min(0).max(1).default(0.9),
  })
  .strict();

const memoryLabScenarioSchema = z
  .object({
    scenario: z.enum([
      "worker_accepts_offer",
      "worker_declines_offer",
      "ineligible_memory_boundary",
      "infer_from_note",
    ]),
    organisationId: z.string().min(1).default("demo-org"),
    workerId: z.string().min(1).default("demo-worker"),
    bookingRequestId: z.string().min(1).default("demo-booking-request"),
    note: z.string().min(1).max(2000).optional(),
  })
  .strict();

function sandboxRawIntent(runId: string, rawRequest: string) {
  return `${SANDBOX_PREFIX}${runId}] ${rawRequest}`;
}

function futureDate(offsetHours: number) {
  return new Date(Date.now() + offsetHours * 60 * 60 * 1000);
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function writeSandboxEvent(
  db: PrismaClient,
  runId: string,
  actor: SandboxActor,
  action: string,
  summary: string,
  outcome: string,
  entityIds: Record<string, string | string[] | null> = {},
) {
  await db.auditEvent.create({
    data: {
      actorType: actor === "employer" || actor === "worker" ? "user" : actor === "ops" ? "admin" : "agent",
      actorId: actor === "ops" ? ADMIN_ID : actor,
      action,
      entityType: "SandboxRun",
      entityId: runId,
      inputs: toJson({ runId, actor }),
      outputs: toJson({ summary, entityIds }),
      outcome,
    },
  });
}

function eventToTimeline(event: {
  id: string;
  action: string;
  actorId: string;
  outcome: string;
  outputs: Prisma.JsonValue;
  createdAt: Date;
}): TimelineItem {
  const outputs =
    event.outputs && typeof event.outputs === "object" && !Array.isArray(event.outputs)
      ? (event.outputs as Record<string, unknown>)
      : {};
  const entityIds =
    outputs.entityIds && typeof outputs.entityIds === "object" && !Array.isArray(outputs.entityIds)
      ? (outputs.entityIds as Record<string, string | string[] | null>)
      : {};

  return {
    id: event.id,
    at: event.createdAt.toISOString(),
    actor: (event.actorId === ADMIN_ID ? "ops" : event.actorId) as SandboxActor,
    action: event.action,
    summary: typeof outputs.summary === "string" ? outputs.summary : event.action,
    outcome: event.outcome,
    entityIds,
  };
}

async function getTimeline(db: PrismaClient, runId: string): Promise<TimelineItem[]> {
  const events = await db.auditEvent.findMany({
    where: { entityType: "SandboxRun", entityId: runId },
    orderBy: { createdAt: "asc" },
  });
  return events.map(eventToTimeline);
}

async function getDemoDirectory(db: PrismaClient): Promise<AvatarCoverage[]> {
  const [orgs, workers] = await Promise.all([
    db.organisation.findMany({
      where: { sector: "education" },
      orderBy: { name: "asc" },
      include: { users: { take: 1, orderBy: { name: "asc" } } },
    }),
    db.worker.findMany({
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      include: { passport: true },
    }),
  ]);

  return [
    ...orgs.map((org) => ({
      id: org.id,
      name: org.users[0]?.name ? `${org.users[0].name} / ${org.name}` : org.name,
      kind: "employer" as const,
      status: "requested" as const,
      note: `${org.type} setting`,
    })),
    ...workers.map((worker) => ({
      id: worker.id,
      name: `${worker.firstName} ${worker.lastName}`,
      kind: "worker" as const,
      status: "role-excluded" as const,
      note: worker.roleTypes.join(", "),
    })),
  ];
}

async function restoreDemoComplianceFixtures(db: PrismaClient) {
  const fixtureUpdates = [
    { workerId: "demo-worker-3", passport: { safeguardingStatus: "pending" as const }, doc: "safeguarding" },
    { workerId: "demo-worker-5", passport: { dbsStatus: "pending" as const }, doc: "enhanced_dbs" },
    { workerId: "demo-worker-11", passport: { rightToWorkStatus: "pending" as const }, doc: "right_to_work" },
    { workerId: "demo-worker-14", passport: { qtsStatus: "pending" as const }, doc: "qts" },
  ];

  for (const fixture of fixtureUpdates) {
    const passport = await db.passport.findUnique({ where: { workerId: fixture.workerId } });
    if (!passport) continue;
    await db.passport.update({ where: { id: passport.id }, data: fixture.passport });
    await db.complianceDocument.updateMany({
      where: { passportId: passport.id, documentType: fixture.doc },
      data: { status: "pending", verifiedAt: null, verifiedBy: null },
    });
  }
}

async function restoreDemoGuardrailFixtures(db: PrismaClient) {
  await db.guardrailPolicy.updateMany({
    where: { organisationId: "demo-org" },
    data: {
      autonomyLevel: "L2",
      budgetCeiling: 200,
      approvedRoleTypes: ["supply_teacher", "cover_supervisor", "teaching_assistant", "learning_support_assistant", "invigilator"],
      workerWhitelist: [],
      workerBlocklist: [],
      escalationContacts: ["cover@greenfieldmat.org"],
    },
  });
}

async function ensureDynamicRateWorkerFloors(db: PrismaClient) {
  const floors = [
    { workerId: "demo-worker", payFloor: 150, approvedRoleTypes: ["supply_teacher"] },
    { workerId: "demo-worker-2", payFloor: 155, approvedRoleTypes: ["supply_teacher"] },
    { workerId: "demo-worker-8", payFloor: 165, approvedRoleTypes: ["supply_teacher", "cover_supervisor"] },
    { workerId: "demo-worker-9", payFloor: 145, approvedRoleTypes: ["supply_teacher"] },
  ];

  for (const floor of floors) {
    await db.guardrailPolicy.upsert({
      where: { workerId: floor.workerId },
      update: {
        payFloor: floor.payFloor,
        maxCommuteMinutes: null,
        approvedRoleTypes: floor.approvedRoleTypes,
      },
      create: {
        workerId: floor.workerId,
        autonomyLevel: "L2",
        payFloor: floor.payFloor,
        approvedRoleTypes: floor.approvedRoleTypes,
        workerWhitelist: [],
        workerBlocklist: [],
        escalationContacts: [],
      },
    });
  }
}

async function resetSandboxData(db: PrismaClient) {
  const sandboxRuns = await db.auditEvent.findMany({
    where: { entityType: "SandboxRun" },
    select: { outputs: true },
  });
  const invoiceIds = sandboxRuns.flatMap((event) => {
    const outputs =
      event.outputs && typeof event.outputs === "object" && !Array.isArray(event.outputs)
        ? (event.outputs as Record<string, unknown>)
        : {};
    const entityIds =
      outputs.entityIds && typeof outputs.entityIds === "object" && !Array.isArray(outputs.entityIds)
        ? (outputs.entityIds as Record<string, unknown>)
        : {};
    const invoiceId = entityIds.invoiceId;
    const invoiceIdsValue = entityIds.invoiceIds;
    return [
      ...(typeof invoiceId === "string" ? [invoiceId] : []),
      ...(Array.isArray(invoiceIdsValue) ? invoiceIdsValue.filter((id): id is string => typeof id === "string") : []),
    ];
  });

  const bookingRequests = await db.bookingRequest.findMany({
    where: { rawIntent: { startsWith: SANDBOX_PREFIX } },
    select: { id: true },
  });
  const bookingRequestIds = bookingRequests.map((row) => row.id);

  const [matches, offers, bookings, conversations] =
    bookingRequestIds.length > 0
      ? await Promise.all([
          db.match.findMany({ where: { bookingRequestId: { in: bookingRequestIds } }, select: { id: true } }),
          db.offer.findMany({ where: { bookingRequestId: { in: bookingRequestIds } }, select: { id: true } }),
          db.booking.findMany({
            where: { bookingRequestId: { in: bookingRequestIds } },
            select: { id: true, shift: { select: { id: true } }, timesheet: { select: { id: true } } },
          }),
          db.conversation.findMany({ where: { bookingRequestId: { in: bookingRequestIds } }, select: { id: true } }),
        ])
      : [[], [], [], []];

  const bookingIds = bookings.map((row) => row.id);
  const shiftIds = bookings.flatMap((row) => (row.shift ? [row.shift.id] : []));
  const timesheetIds = bookings.flatMap((row) => (row.timesheet ? [row.timesheet.id] : []));
  const matchIds = matches.map((row) => row.id);
  const offerIds = offers.map((row) => row.id);
  const conversationIds = conversations.map((row) => row.id);

  await db.$transaction(async (tx) => {
    if (shiftIds.length > 0) await tx.feedback.deleteMany({ where: { shiftId: { in: shiftIds } } });
    if (timesheetIds.length > 0) await tx.timesheet.deleteMany({ where: { id: { in: timesheetIds } } });
    if (shiftIds.length > 0) await tx.shift.deleteMany({ where: { id: { in: shiftIds } } });
    if (bookingIds.length > 0) await tx.booking.deleteMany({ where: { id: { in: bookingIds } } });
    if (offerIds.length > 0) await tx.offer.deleteMany({ where: { id: { in: offerIds } } });
    if (matchIds.length > 0) await tx.match.deleteMany({ where: { id: { in: matchIds } } });
    if (bookingRequestIds.length > 0) {
      await tx.negotiationRecord.deleteMany({ where: { bookingRequestId: { in: bookingRequestIds } } });
    }
    if (conversationIds.length > 0) {
      await tx.conversationMessage.deleteMany({ where: { conversationId: { in: conversationIds } } });
      await tx.conversation.deleteMany({ where: { id: { in: conversationIds } } });
    }
    if (bookingRequestIds.length > 0) {
      await tx.bookingRequest.deleteMany({ where: { id: { in: bookingRequestIds } } });
    }
    if (invoiceIds.length > 0) await tx.invoice.deleteMany({ where: { id: { in: invoiceIds } } });

    const auditOr: Prisma.AuditEventWhereInput[] = [{ entityType: "SandboxRun" }];
    if (bookingRequestIds.length > 0) auditOr.push({ entityType: "BookingRequest", entityId: { in: bookingRequestIds } });
    if (offerIds.length > 0) auditOr.push({ entityType: "Offer", entityId: { in: offerIds } });
    if (bookingIds.length > 0) auditOr.push({ entityType: "Booking", entityId: { in: bookingIds } });
    if (shiftIds.length > 0) auditOr.push({ entityType: "Shift", entityId: { in: shiftIds } });
    if (timesheetIds.length > 0) auditOr.push({ entityType: "Timesheet", entityId: { in: timesheetIds } });
    if (invoiceIds.length > 0) auditOr.push({ entityType: "Invoice", entityId: { in: invoiceIds } });
    if (conversationIds.length > 0) auditOr.push({ entityType: "Conversation", entityId: { in: conversationIds } });
    await tx.auditEvent.deleteMany({ where: { OR: auditOr } });
  });

  await restoreDemoComplianceFixtures(db);
  await restoreDemoGuardrailFixtures(db);

  return {
    bookingRequests: bookingRequestIds.length,
    bookings: bookingIds.length,
    offers: offerIds.length,
    invoices: invoiceIds.length,
  };
}

async function createSandboxRequest(
  db: PrismaClient,
  runId: string,
  scenarioId: string,
  seed: BookingSeed,
) {
  const org = await db.organisation.findUnique({
    where: { id: seed.orgId },
    include: { sites: { take: 1, orderBy: { name: "asc" } }, users: { take: 1, orderBy: { name: "asc" } } },
  });
  if (!org || !org.sites[0]) throw new Error(`Missing seeded organisation/site: ${seed.orgId}`);
  const site = org.sites[0];

  const startAt = futureDate(seed.startOffsetHours);
  const endAt = new Date(startAt.getTime() + seed.durationHours * 60 * 60 * 1000);

  const result = await db.$transaction(async (tx) => {
    const bookingRequest = await tx.bookingRequest.create({
      data: {
        organisationId: org.id,
        siteId: site.id,
        status: "pending_confirmation",
        roleType: seed.roleType,
        startAt,
        endAt,
        rateMode: seed.rateMode ?? "standard",
        payRate: seed.payRate,
        maxPayRate: seed.maxPayRate,
        rawIntent: sandboxRawIntent(runId, seed.rawRequest),
        channel: "web",
        broadcastStrategy: seed.strategy ?? "simultaneous_top_n",
      },
    });

    const conversation = await tx.conversation.create({
      data: {
        participantType: "employer",
        participantId: org.id,
        channel: "web",
        intent: seed.roleType,
        bookingRequestId: bookingRequest.id,
        extractedEntities: toJson({
          scenarioId,
          roleType: seed.roleType,
          siteId: site.id,
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
          rateMode: seed.rateMode ?? "standard",
          payRate: seed.payRate,
          maxPayRate: seed.maxPayRate ?? null,
          confidence: 1,
        }),
        messages: {
          create: [
            { role: "employer", content: seed.rawRequest, metadata: toJson({ runId, scenarioId }) },
            {
              role: "agent",
              content: `Confirmed: ${seed.roleType} at ${site.name}.`,
              metadata: toJson({ runId, scenarioId, bookingRequestId: bookingRequest.id }),
            },
          ],
        },
      },
    });

    return { bookingRequest, conversation, orgName: org.name, siteName: site.name };
  });

  await writeSandboxEvent(
    db,
    runId,
    "employer",
    "sandbox.employer.request",
    `${result.orgName} requested ${seed.roleType} cover.`,
    "requested",
    { bookingRequestId: result.bookingRequest.id, conversationId: result.conversation.id },
  );
  await writeSandboxEvent(
    db,
    runId,
    "v",
    "sandbox.v.confirm",
    `V structured and confirmed ${result.siteName} from the deterministic avatar message.`,
    "pending_confirmation",
    { bookingRequestId: result.bookingRequest.id, conversationId: result.conversation.id },
  );

  return result.bookingRequest;
}

async function rankAndBroadcast(db: PrismaClient, app: Parameters<FastifyPluginAsync>[0], runId: string, bookingRequestId: string) {
  const bookingRequest = await db.bookingRequest.findUniqueOrThrow({
    where: { id: bookingRequestId },
    include: { organisation: { include: { guardrailPolicy: true } } },
  });
  const matches = await app.agents.market.rankCandidates(bookingRequestId);
  await app.agents.market.estimateFillProbability(bookingRequestId);
  const offers = await app.agents.market.broadcastOffers(
    bookingRequestId,
    bookingRequest.broadcastStrategy,
    bookingRequest.organisation.guardrailPolicy?.autonomyLevel ?? "L2",
  );

  await writeSandboxEvent(
    db,
    runId,
    "market",
    "sandbox.market.broadcast",
    `${matches.data?.length ?? 0} candidates ranked; ${offers.data?.length ?? 0} offers broadcast.`,
    offers.success ? "offers_sent" : "blocked",
    {
      bookingRequestId,
      matchIds: (matches.data ?? []).map((match) => match.id),
      offerIds: (offers.data ?? []).map((offer) => offer.id),
    },
  );

  return { matches: matches.data ?? [], offers: offers.data ?? [] };
}

async function acceptOfferForWorker(
  db: PrismaClient,
  app: Parameters<FastifyPluginAsync>[0],
  runId: string,
  bookingRequestId: string,
  workerId: string,
) {
  const worker = await db.worker.findUniqueOrThrow({ where: { id: workerId } });
  const offer = await db.offer.findFirst({
    where: { bookingRequestId, workerId, status: "pending" },
    orderBy: { createdAt: "asc" },
  });
  if (!offer) throw new Error(`No pending offer for ${workerId} on ${bookingRequestId}`);

  await writeSandboxEvent(
    db,
    runId,
    "worker",
    "sandbox.worker.offer_viewed",
    `${worker.firstName} ${worker.lastName} viewed the shift offer.`,
    "offer_found",
    { bookingRequestId, offerId: offer.id, workerId },
  );

  const result = await app.agents.employer.processRequest(bookingRequestId, offer.id, workerId);
  if (!result.success || !result.data) throw new Error(result.explanation);

  await writeSandboxEvent(
    db,
    runId,
    "worker",
    "sandbox.worker.accept",
    `${worker.firstName} ${worker.lastName} accepted; booking confirmed.`,
    "accepted",
    { bookingRequestId, offerId: offer.id, workerId, bookingId: result.data.id },
  );

  return result.data;
}

async function completeShift(db: PrismaClient, runId: string, bookingId: string) {
  const booking = await db.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: { shift: true, worker: true },
  });
  if (!booking.shift) throw new Error(`Booking ${bookingId} has no shift`);

  const hoursWorked = Number(((booking.endAt.getTime() - booking.startAt.getTime()) / 3_600_000).toFixed(2));
  const { shift, timesheet } = await db.$transaction(async (tx) => {
    const checkedIn = await tx.shift.update({
      where: { id: booking.shift!.id },
      data: { status: "checked_in", checkedInAt: booking.startAt },
    });
    await tx.auditEvent.create({
      data: {
        actorType: "user",
        actorId: booking.workerId,
        action: "shift.check_in",
        entityType: "Shift",
        entityId: checkedIn.id,
        inputs: toJson({ workerId: booking.workerId, shiftId: checkedIn.id, source: "sandbox" }),
        outputs: toJson({ status: checkedIn.status, checkedInAt: booking.startAt.toISOString() }),
        outcome: "checked_in",
      },
    });

    const checkedOut = await tx.shift.update({
      where: { id: booking.shift!.id },
      data: { status: "checked_out", checkedOutAt: booking.endAt },
    });
    const createdTimesheet = await tx.timesheet.create({
      data: {
        shiftId: checkedOut.id,
        bookingId,
        workerId: booking.workerId,
        organisationId: booking.organisationId,
        hoursWorked,
      },
    });
    await tx.auditEvent.create({
      data: {
        actorType: "user",
        actorId: booking.workerId,
        action: "shift.check_out",
        entityType: "Shift",
        entityId: checkedOut.id,
        inputs: toJson({ workerId: booking.workerId, shiftId: checkedOut.id, source: "sandbox" }),
        outputs: toJson({ status: checkedOut.status, hoursWorked, timesheetId: createdTimesheet.id }),
        outcome: "checked_out",
      },
    });
    return { shift: checkedOut, timesheet: createdTimesheet };
  });

  await writeSandboxEvent(
    db,
    runId,
    "worker",
    "sandbox.shift.complete",
    `${booking.worker.firstName} ${booking.worker.lastName} checked in and out; ${hoursWorked} hours captured.`,
    "checked_out",
    { bookingId, shiftId: shift.id, timesheetId: timesheet.id, workerId: booking.workerId },
  );

  return { shift, timesheet };
}

async function approveTimesheetAndInvoice(db: PrismaClient, runId: string, timesheetIds: string[]) {
  const timesheets = await db.timesheet.findMany({
    where: { id: { in: timesheetIds } },
    include: { booking: true },
  });
  if (timesheets.length === 0) throw new Error("No sandbox timesheets to invoice");

  await db.$transaction(async (tx) => {
    for (const timesheet of timesheets) {
      await tx.timesheet.update({
        where: { id: timesheet.id },
        data: { approved: true, approvedAt: new Date(), approvedBy: ADMIN_ID },
      });
      await tx.auditEvent.create({
        data: {
          actorType: "admin",
          actorId: ADMIN_ID,
          action: "timesheet.approve",
          entityType: "Timesheet",
          entityId: timesheet.id,
          inputs: toJson({ timesheetId: timesheet.id, approvedBy: ADMIN_ID, source: "sandbox" }),
          outputs: toJson({ hoursWorked: timesheet.hoursWorked, workerId: timesheet.workerId }),
          outcome: "approved",
        },
      });
    }
  });

  const first = timesheets[0];
  if (!first) throw new Error("No sandbox timesheets to invoice");
  const workerPayTotal = timesheets.reduce((sum, item) => sum + item.booking.payRate * item.hoursWorked, 0);
  const vioraFeeTotal = timesheets.reduce((sum, item) => sum + item.booking.vioraFee * item.hoursWorked, 0);
  const totalAmount = workerPayTotal + vioraFeeTotal;
  const periodStart = new Date(Math.min(...timesheets.map((item) => item.booking.startAt.getTime())));
  const periodEnd = new Date(Math.max(...timesheets.map((item) => item.booking.endAt.getTime())));

  const invoice = await db.invoice.create({
    data: {
      organisationId: first.organisationId,
      periodStart,
      periodEnd,
      workerPayTotal: Number(workerPayTotal.toFixed(2)),
      vioraFeeTotal: Number(vioraFeeTotal.toFixed(2)),
      totalAmount: Number(totalAmount.toFixed(2)),
      status: "draft",
    },
  });
  await db.auditEvent.create({
    data: {
      actorType: "admin",
      actorId: ADMIN_ID,
      action: "invoice.generate",
      entityType: "Invoice",
      entityId: invoice.id,
      inputs: toJson({ timesheetIds, source: "sandbox" }),
      outputs: toJson({ workerPayTotal, vioraFeeTotal, totalAmount }),
      outcome: "draft",
    },
  });

  await writeSandboxEvent(
    db,
    runId,
    "ops",
    "sandbox.invoice.generate",
    `${timesheets.length} approved timesheet(s) rolled into a draft invoice.`,
    "draft",
    { invoiceId: invoice.id, timesheetIds },
  );

  return invoice;
}

async function summarizeRun(db: PrismaClient, runId: string): Promise<ScenarioSummary> {
  const bookingRequests = await db.bookingRequest.findMany({
    where: { rawIntent: { startsWith: `${SANDBOX_PREFIX}${runId}]` } },
    select: { id: true },
  });
  const bookingRequestIds = bookingRequests.map((row) => row.id);
  const [conversations, matches, offers, bookingRows, auditEvents] = await Promise.all([
    db.conversation.count({ where: { bookingRequestId: { in: bookingRequestIds } } }),
    db.match.count({ where: { bookingRequestId: { in: bookingRequestIds } } }),
    db.offer.count({ where: { bookingRequestId: { in: bookingRequestIds } } }),
    db.booking.findMany({
      where: { bookingRequestId: { in: bookingRequestIds } },
      select: { id: true, shift: { select: { id: true } }, timesheet: { select: { id: true } } },
    }),
    db.auditEvent.count({ where: { entityId: runId } }),
  ]);
  const invoiceEvents = await db.auditEvent.findMany({
    where: { entityType: "SandboxRun", entityId: runId, action: "sandbox.invoice.generate" },
    select: { outputs: true },
  });
  const invoiceCount = invoiceEvents.length;
  const shiftCount = bookingRows.filter((row) => row.shift).length;
  const timesheetCount = bookingRows.filter((row) => row.timesheet).length;

  return {
    conversations,
    bookingRequests: bookingRequestIds.length,
    matches,
    offers,
    bookings: bookingRows.length,
    shifts: shiftCount,
    timesheets: timesheetCount,
    invoices: invoiceCount,
    auditEvents,
  };
}

function coverage(overrides: Record<string, { status: CoverageStatus; note: string }>, directory: AvatarCoverage[]) {
  return directory.map((item) => ({
    ...item,
    ...(overrides[item.id] ?? {}),
  }));
}

async function runSingleCoverLoop(db: PrismaClient, app: Parameters<FastifyPluginAsync>[0], runId: string) {
  const bookingRequest = await createSandboxRequest(db, runId, "single-cover-loop", {
    orgId: "demo-org",
    roleType: "supply_teacher",
    rawRequest: "Need Year 5 KS2 cover tomorrow, 8:15 to 3:30, up to GBP 170.",
    payRate: 150,
    maxPayRate: 170,
    startOffsetHours: 28,
    durationHours: 7.25,
  });
  await rankAndBroadcast(db, app, runId, bookingRequest.id);
  const booking = await acceptOfferForWorker(db, app, runId, bookingRequest.id, "demo-worker");
  const { timesheet } = await completeShift(db, runId, booking.id);
  await approveTimesheetAndInvoice(db, runId, [timesheet.id]);
}

async function runDynamicRateClearing(db: PrismaClient, app: Parameters<FastifyPluginAsync>[0], runId: string) {
  await restoreDemoComplianceFixtures(db);
  await restoreDemoGuardrailFixtures(db);
  await ensureDynamicRateWorkerFloors(db);

  await db.guardrailPolicy.updateMany({
    where: { organisationId: "demo-org" },
    data: { autonomyLevel: "L3" },
  });

  try {
    const bookingRequest = await createSandboxRequest(db, runId, "dynamic-rate-clearing", {
      orgId: "demo-org",
      roleType: "supply_teacher",
      rawRequest: "Greenfield needs Year 5 supply cover tomorrow. Start at GBP 145, clear dynamically up to GBP 170.",
      rateMode: "dynamic",
      payRate: 145,
      maxPayRate: 170,
      startOffsetHours: 28,
      durationHours: 7,
    });

    const { offers } = await rankAndBroadcast(db, app, runId, bookingRequest.id);
    const negotiations = await db.negotiationRecord.findMany({
      where: { bookingRequestId: bookingRequest.id },
      orderBy: { workerId: "asc" },
    });

    await writeSandboxEvent(
      db,
      runId,
      "market",
      "sandbox.market.dynamic_rate_clear",
      `Dynamic Rate cleared ${negotiations.length} worker floor(s) under the GBP 170 cap.`,
      negotiations.length > 0 ? "cleared" : "blocked",
      {
        bookingRequestId: bookingRequest.id,
        offerIds: offers.map((offer) => offer.id),
        negotiationIds: negotiations.map((negotiation) => negotiation.id),
      },
    );
  } finally {
    await restoreDemoGuardrailFixtures(db);
  }
}

async function runAllAvatarsMarketDay(db: PrismaClient, app: Parameters<FastifyPluginAsync>[0], runId: string) {
  const requests: Array<BookingSeed & { acceptWorkerId: string }> = [
    {
      orgId: "demo-org",
      roleType: "supply_teacher",
      rawRequest: "Greenfield needs a KS2 supply teacher for tomorrow morning.",
      payRate: 150,
      maxPayRate: 170,
      startOffsetHours: 30,
      durationHours: 7,
      acceptWorkerId: "demo-worker",
    },
    {
      orgId: "demo-org-daycare",
      roleType: "teaching_assistant",
      rawRequest: "Little Sprouts needs an early-years TA for under-2s cover.",
      payRate: 95,
      startOffsetHours: 32,
      durationHours: 6,
      acceptWorkerId: "demo-worker-6",
    },
    {
      orgId: "demo-org-nursery",
      roleType: "learning_support_assistant",
      rawRequest: "Rainbow needs learning support in the toddler room.",
      payRate: 92,
      startOffsetHours: 34,
      durationHours: 6,
      acceptWorkerId: "demo-worker-7",
    },
    {
      orgId: "demo-org-primary",
      roleType: "supply_teacher",
      rawRequest: "Oakwood needs Year 3 supply cover for a full day.",
      payRate: 145,
      startOffsetHours: 36,
      durationHours: 7,
      acceptWorkerId: "demo-worker-8",
    },
    {
      orgId: "demo-org-secondary",
      roleType: "cover_supervisor",
      rawRequest: "Riverside needs a cover supervisor across KS3 lessons.",
      payRate: 130,
      startOffsetHours: 38,
      durationHours: 7,
      acceptWorkerId: "demo-worker-13",
    },
    {
      orgId: "demo-org-university",
      roleType: "invigilator",
      rawRequest: "Kingsbridge needs invigilation support for afternoon exams.",
      payRate: 120,
      startOffsetHours: 40,
      durationHours: 5,
      acceptWorkerId: "demo-worker-10",
    },
  ];

  const timesheetIds: string[] = [];
  for (const seed of requests) {
    const { acceptWorkerId, ...requestSeed } = seed;
    const bookingRequest = await createSandboxRequest(db, runId, "all-avatars-market-day", requestSeed);
    await rankAndBroadcast(db, app, runId, bookingRequest.id);
    const booking = await acceptOfferForWorker(db, app, runId, bookingRequest.id, acceptWorkerId);
    const { timesheet } = await completeShift(db, runId, booking.id);
    timesheetIds.push(timesheet.id);
  }
  await approveTimesheetAndInvoice(db, runId, timesheetIds);
}

async function runComplianceBlockUnlock(db: PrismaClient, app: Parameters<FastifyPluginAsync>[0], runId: string) {
  await restoreDemoComplianceFixtures(db);
  const bookingRequest = await createSandboxRequest(db, runId, "compliance-block-unlock", {
    orgId: "demo-org",
    roleType: "supply_teacher",
    rawRequest: "Can you find a supply teacher and show me why Tom is blocked until DBS clears?",
    payRate: 150,
    maxPayRate: 175,
    startOffsetHours: 42,
    durationHours: 7,
  });

  const before = await app.agents.compliance.checkEligibility("demo-worker-5", bookingRequest.id);
  await writeSandboxEvent(
    db,
    runId,
    "compliance",
    "sandbox.compliance.block",
    before.reason ?? "Tom is blocked by a compliance gate.",
    "blocked",
    { bookingRequestId: bookingRequest.id, workerId: "demo-worker-5" },
  );

  await rankAndBroadcast(db, app, runId, bookingRequest.id);

  const tomPassport = await db.passport.findUniqueOrThrow({ where: { workerId: "demo-worker-5" } });
  const tomDoc = await db.complianceDocument.findFirst({
    where: { passportId: tomPassport.id, documentType: "enhanced_dbs" },
  });
  await db.$transaction(async (tx) => {
    if (tomDoc) {
      await tx.complianceDocument.update({
        where: { id: tomDoc.id },
        data: { status: "verified", verifiedAt: new Date(), verifiedBy: ADMIN_ID },
      });
    }
    await tx.passport.update({ where: { id: tomPassport.id }, data: { dbsStatus: "verified" } });
    await tx.auditEvent.create({
      data: {
        actorType: "admin",
        actorId: ADMIN_ID,
        action: "compliance.document.verify",
        entityType: "ComplianceDocument",
        entityId: tomDoc?.id ?? tomPassport.id,
        inputs: toJson({ workerId: "demo-worker-5", documentType: "enhanced_dbs", source: "sandbox" }),
        outputs: toJson({ passportId: tomPassport.id, passportUpdated: true }),
        outcome: "verified",
      },
    });
  });

  await writeSandboxEvent(
    db,
    runId,
    "ops",
    "sandbox.compliance.verify",
    "Admin verified Tom's enhanced DBS document.",
    "verified",
    { workerId: "demo-worker-5", documentId: tomDoc?.id ?? null },
  );

  await app.agents.market.rankCandidates(bookingRequest.id);
  const match = await db.match.findFirst({ where: { bookingRequestId: bookingRequest.id, workerId: "demo-worker-5" } });
  const offer = await db.offer.create({
    data: {
      bookingRequestId: bookingRequest.id,
      workerId: "demo-worker-5",
      matchId: match?.id,
      status: "pending",
      payRate: bookingRequest.payRate,
      fitExplanation: "Compliance unlocked; Tom is now eligible for this supply booking.",
      expiresAt: futureDate(24),
    },
  });
  await writeSandboxEvent(
    db,
    runId,
    "market",
    "sandbox.market.rebroadcast",
    "Market rebroadcast included Tom after the compliance unlock.",
    "offers_sent",
    { bookingRequestId: bookingRequest.id, offerId: offer.id, workerId: "demo-worker-5" },
  );

  const booking = await acceptOfferForWorker(db, app, runId, bookingRequest.id, "demo-worker-5");
  const { timesheet } = await completeShift(db, runId, booking.id);
  await approveTimesheetAndInvoice(db, runId, [timesheet.id]);
}

async function runReplacementRecovery(db: PrismaClient, app: Parameters<FastifyPluginAsync>[0], runId: string) {
  const bookingRequest = await createSandboxRequest(db, runId, "replacement-recovery", {
    orgId: "demo-org",
    roleType: "supply_teacher",
    rawRequest: "Need KS2 cover with a backup plan if the first worker drops.",
    payRate: 150,
    maxPayRate: 170,
    startOffsetHours: 44,
    durationHours: 7,
  });
  await rankAndBroadcast(db, app, runId, bookingRequest.id);
  const booking = await acceptOfferForWorker(db, app, runId, bookingRequest.id, "demo-worker");

  await db.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: booking.id },
      data: { status: "cancelled", backupWorkerIds: ["demo-worker-2", "demo-worker-8"] },
    });
    await tx.bookingRequest.update({ where: { id: bookingRequest.id }, data: { status: "cancelled" } });
    await tx.shift.updateMany({ where: { bookingId: booking.id }, data: { status: "cancelled" } });
    await tx.auditEvent.create({
      data: {
        actorType: "admin",
        actorId: ADMIN_ID,
        action: "booking.cancel",
        entityType: "Booking",
        entityId: booking.id,
        inputs: toJson({ bookingId: booking.id, reason: "Sandbox recovery drill" }),
        outputs: toJson({ bookingRequestStatus: "cancelled", backupWorkerIds: ["demo-worker-2", "demo-worker-8"] }),
        outcome: "cancelled",
      },
    });
  });
  await writeSandboxEvent(
    db,
    runId,
    "ops",
    "sandbox.booking.cancel",
    "Admin cancelled the confirmed booking to trigger recovery.",
    "cancelled",
    { bookingId: booking.id, bookingRequestId: bookingRequest.id },
  );

  const replacement = await app.agents.employer.triggerReplacement(booking.id);
  await writeSandboxEvent(
    db,
    runId,
    "v",
    "sandbox.replacement.trigger",
    replacement.explanation,
    replacement.success ? "replacement_started" : "manual_follow_up",
    { bookingId: booking.id, bookingRequestId: bookingRequest.id },
  );
}

function coverageForScenario(scenarioId: ScenarioId, directory: AvatarCoverage[]): AvatarCoverage[] {
  const commonWorkerCoverage: Record<string, { status: CoverageStatus; note: string }> = {
    "demo-worker": { status: "accepted", note: "Alex accepts Greenfield supply cover." },
    "demo-worker-2": { status: "backup", note: "Priya is a ranked backup candidate." },
    "demo-worker-3": { status: "compliance-blocked", note: "Safeguarding pending blocks James." },
    "demo-worker-4": { status: "declined", note: "Maria receives/loses TA opportunities after accepted bookings." },
    "demo-worker-5": { status: "compliance-blocked", note: "Tom is blocked until DBS is verified." },
    "demo-worker-6": { status: "accepted", note: "Amina accepts early-years cover." },
    "demo-worker-7": { status: "accepted", note: "Oliver accepts nursery LSA cover." },
    "demo-worker-8": { status: "accepted", note: "Sophie accepts primary supply cover." },
    "demo-worker-9": { status: "backup", note: "Daniel remains available as a lower-ranked supply backup." },
    "demo-worker-10": { status: "accepted", note: "Elena accepts university invigilation." },
    "demo-worker-11": { status: "compliance-blocked", note: "Right-to-work pending blocks Raj." },
    "demo-worker-12": { status: "declined", note: "Grace is in the early-years pool but not selected." },
    "demo-worker-13": { status: "accepted", note: "Kwame accepts secondary cover supervision." },
    "demo-worker-14": { status: "compliance-blocked", note: "QTS pending blocks Yuki from supply teaching." },
    "demo-worker-15": { status: "declined", note: "Fatima is eligible but not selected in this run." },
  };

  if (scenarioId === "all-avatars-market-day") {
    return coverage(commonWorkerCoverage, directory);
  }
  if (scenarioId === "dynamic-rate-clearing") {
    return coverage(
      {
        "demo-org": { status: "requested", note: "Greenfield creates the dynamic-rate request." },
        "demo-worker": { status: "backup", note: "Alex clears at GBP 150." },
        "demo-worker-2": { status: "backup", note: "Priya clears at GBP 155." },
        "demo-worker-8": { status: "backup", note: "Sophie clears at GBP 165." },
        "demo-worker-9": { status: "backup", note: "Daniel clears at GBP 145." },
        "demo-worker-5": { status: "compliance-blocked", note: "Tom remains blocked by DBS." },
        "demo-worker-11": { status: "compliance-blocked", note: "Raj remains blocked by right-to-work." },
        "demo-worker-14": { status: "compliance-blocked", note: "Yuki remains blocked by QTS." },
      },
      directory,
    );
  }
  if (scenarioId === "compliance-block-unlock") {
    return coverage(
      {
        "demo-org": { status: "requested", note: "Greenfield creates the compliance unlock request." },
        "demo-worker-5": { status: "accepted", note: "Tom is blocked, then DBS unlocks and he accepts." },
        "demo-worker": { status: "declined", note: "Alex's pending offer is superseded by Tom's acceptance." },
        "demo-worker-2": { status: "declined", note: "Priya's pending offer is superseded by Tom's acceptance." },
        "demo-worker-11": { status: "compliance-blocked", note: "Raj remains blocked by right-to-work." },
        "demo-worker-14": { status: "compliance-blocked", note: "Yuki remains blocked by QTS." },
      },
      directory,
    );
  }
  if (scenarioId === "replacement-recovery") {
    return coverage(
      {
        "demo-org": { status: "requested", note: "Greenfield runs a recovery drill." },
        "demo-worker": { status: "accepted", note: "Alex accepts the original booking, then it is cancelled." },
        "demo-worker-2": { status: "backup", note: "Priya receives the replacement offer." },
        "demo-worker-8": { status: "backup", note: "Sophie receives the replacement offer." },
      },
      directory,
    );
  }
  return coverage(
    {
      "demo-org": { status: "requested", note: "Greenfield creates the single-loop request." },
      "demo-worker": { status: "accepted", note: "Alex accepts and completes the shift." },
      "demo-worker-2": { status: "declined", note: "Priya's competing offer is declined after Alex accepts." },
      "demo-worker-5": { status: "compliance-blocked", note: "Tom remains blocked by DBS." },
      "demo-worker-8": { status: "declined", note: "Sophie is eligible but not selected." },
      "demo-worker-11": { status: "compliance-blocked", note: "Raj remains blocked by right-to-work." },
      "demo-worker-14": { status: "compliance-blocked", note: "Yuki remains blocked by QTS." },
    },
    directory,
  );
}

function memoryLabRunId() {
  return `memory-lab-${Date.now()}`;
}

function memoryLabKey(kind: string, title: string, runId: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 70);
  return `memory_lab_${kind}_${slug || "memory"}_${runId}`;
}

async function writeMemoryLabEvent(
  db: PrismaClient,
  runId: string,
  action: string,
  summary: string,
  outputs: Record<string, unknown> = {},
  outcome = "completed",
) {
  await db.auditEvent.create({
    data: {
      actorType: "admin",
      actorId: ADMIN_ID,
      action,
      entityType: "MemoryLab",
      entityId: runId,
      inputs: toJson({ runId }),
      outputs: toJson({ summary, ...outputs }),
      outcome,
    },
  });
}

async function getMemoryLabState(db: PrismaClient) {
  const [
    organisations,
    workers,
    bookingRequests,
    memories,
    edges,
    pending,
    audit,
  ] = await Promise.all([
    db.organisation.findMany({
      take: 20,
      orderBy: { name: "asc" },
      include: { sites: { orderBy: { name: "asc" } } },
    }),
    db.worker.findMany({
      take: 40,
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      include: { passport: true },
    }),
    db.bookingRequest.findMany({
      take: 20,
      orderBy: { createdAt: "desc" },
      include: { organisation: true, site: true },
    }),
    db.memoryEntry.findMany({
      where: {
        OR: [{ sourceRefType: MEMORY_LAB_SOURCE }, { key: { startsWith: "memory_lab_" } }],
        status: { not: "deleted" },
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
    db.memoryEdge.findMany({
      where: { sourceRefType: MEMORY_LAB_SOURCE },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
    db.memoryEntry.findMany({
      where: { sourceRefType: MEMORY_LAB_SOURCE, status: "pending_confirmation" },
      orderBy: { confidence: "desc" },
      take: 25,
    }),
    db.auditEvent.findMany({
      where: {
        OR: [
          { entityType: "MemoryLab" },
          { action: { startsWith: "memory." } },
          { action: { startsWith: "memory_lab." } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  return {
    organisations: organisations.map((org) => ({
      id: org.id,
      name: org.name,
      sites: org.sites.map((site) => ({ id: site.id, name: site.name })),
    })),
    workers: workers.map((worker) => ({
      id: worker.id,
      name: `${worker.firstName} ${worker.lastName}`,
      roleTypes: worker.roleTypes,
      compliance: {
        identityVerified: worker.passport?.identityVerified ?? false,
        rightToWorkStatus: worker.passport?.rightToWorkStatus ?? "missing",
        dbsStatus: worker.passport?.dbsStatus ?? "missing",
        qtsStatus: worker.passport?.qtsStatus ?? null,
        safeguardingStatus: worker.passport?.safeguardingStatus ?? "missing",
      },
    })),
    bookingRequests: bookingRequests.map((bookingRequest) => ({
      id: bookingRequest.id,
      organisationId: bookingRequest.organisationId,
      organisationName: bookingRequest.organisation.name,
      siteId: bookingRequest.siteId,
      siteName: bookingRequest.site.name,
      roleType: bookingRequest.roleType,
      status: bookingRequest.status,
    })),
    memories,
    edges,
    pending,
    audit,
  };
}

async function resetMemoryLab(db: PrismaClient) {
  const bookingRequests = await db.bookingRequest.findMany({
    where: { rawIntent: { startsWith: `${SANDBOX_PREFIX}memory-lab-` } },
    select: { id: true },
  });
  const bookingRequestIds = bookingRequests.map((row) => row.id);
  const offers =
    bookingRequestIds.length > 0
      ? await db.offer.findMany({
          where: { bookingRequestId: { in: bookingRequestIds } },
          select: { id: true },
        })
      : [];
  const offerIds = offers.map((row) => row.id);
  const matches =
    bookingRequestIds.length > 0
      ? await db.match.findMany({
          where: { bookingRequestId: { in: bookingRequestIds } },
          select: { id: true },
        })
      : [];
  const matchIds = matches.map((row) => row.id);

  const edgeWhere: Prisma.MemoryEdgeWhereInput = {
    OR: [
      { sourceRefType: MEMORY_LAB_SOURCE },
      ...(offerIds.length > 0 ? [{ sourceRefType: "Offer", sourceRefId: { in: offerIds } }] : []),
    ],
  };
  const auditOr: Prisma.AuditEventWhereInput[] = [
    { entityType: "MemoryLab" },
    { action: { startsWith: "memory_lab." } },
  ];
  if (offerIds.length > 0) auditOr.push({ entityType: "Offer", entityId: { in: offerIds } });
  if (bookingRequestIds.length > 0) auditOr.push({ entityType: "BookingRequest", entityId: { in: bookingRequestIds } });

  const [entries, edges, audit] = await db.$transaction([
    db.memoryEntry.deleteMany({
      where: { OR: [{ sourceRefType: MEMORY_LAB_SOURCE }, { key: { startsWith: "memory_lab_" } }] },
    }),
    db.memoryEdge.deleteMany({ where: edgeWhere }),
    db.auditEvent.deleteMany({ where: { OR: auditOr } }),
    ...(offerIds.length > 0 ? [db.offer.deleteMany({ where: { id: { in: offerIds } } })] : []),
    ...(matchIds.length > 0 ? [db.match.deleteMany({ where: { id: { in: matchIds } } })] : []),
    ...(bookingRequestIds.length > 0
      ? [db.bookingRequest.deleteMany({ where: { id: { in: bookingRequestIds } } })]
      : []),
  ]);
  return {
    memories: entries.count,
    edges: edges.count,
    auditEvents: audit.count,
    bookingRequests: bookingRequestIds.length,
    offers: offerIds.length,
  };
}

async function createMemoryLabEntry(
  db: PrismaClient,
  body: z.infer<typeof memoryLabMemorySchema>,
) {
  const runId = memoryLabRunId();
  const subjectType = body.subjectType ?? body.ownerType;
  const subjectId = body.subjectId ?? body.ownerId;
  const memory = await db.memoryEntry.create({
    data: {
      ownerType: body.ownerType,
      ownerId: body.ownerId,
      subjectType,
      subjectId,
      kind: body.kind,
      key: memoryLabKey(body.kind, body.title, runId),
      title: body.title,
      content: body.content,
      sourceType: "user_entered",
      sourceRefType: MEMORY_LAB_SOURCE,
      sourceRefId: runId,
      visibility: body.visibility,
      status: body.status,
      confidence: body.confidence,
      confirmedAt: body.status === "active" ? new Date() : undefined,
      confirmedBy: body.status === "active" ? ADMIN_ID : undefined,
    },
  });
  await writeMemoryLabEvent(db, runId, "memory_lab.memory.create", `Created ${body.ownerType} memory.`, {
    memoryId: memory.id,
    ownerId: body.ownerId,
  });
  return { runId, memory };
}

async function createMemoryLabOffer(
  db: PrismaClient,
  runId: string,
  workerId: string,
  organisationId: string,
) {
  const [worker, org] = await Promise.all([
    db.worker.findUnique({ where: { id: workerId } }),
    db.organisation.findUnique({
      where: { id: organisationId },
      include: { sites: { take: 1, orderBy: { name: "asc" } } },
    }),
  ]);
  if (!worker) throw new Error(`Worker ${workerId} not found.`);
  if (!org) throw new Error(`Organisation ${organisationId} not found.`);
  const site = org.sites[0];
  if (!site) throw new Error(`Organisation ${organisationId} has no site.`);
  const roleType = worker.roleTypes[0] ?? "teacher";
  const startAt = futureDate(72);
  const bookingRequest = await db.bookingRequest.create({
    data: {
      organisationId: org.id,
      siteId: site.id,
      status: "broadcasting",
      roleType,
      startAt,
      endAt: new Date(startAt.getTime() + 7 * 60 * 60 * 1000),
      payRate: 170,
      rawIntent: sandboxRawIntent(runId, `Memory Lab ${roleType} offer for ${worker.firstName}.`),
      requirements: toJson({ source: MEMORY_LAB_SOURCE, runId }),
      broadcastStrategy: "sequential",
    },
  });
  const offer = await db.offer.create({
    data: {
      bookingRequestId: bookingRequest.id,
      workerId,
      status: "pending",
      payRate: bookingRequest.payRate,
      fitExplanation: "Memory Lab synthetic offer.",
      expiresAt: futureDate(24),
    },
  });
  return { bookingRequest, offer, worker, site, roleType };
}

async function upsertMemoryLabEdge(
  db: PrismaClient,
  data: Prisma.MemoryEdgeUncheckedCreateInput,
) {
  const existing = await db.memoryEdge.findFirst({
    where: {
      ownerType: data.ownerType,
      ownerId: data.ownerId,
      fromType: data.fromType,
      fromId: data.fromId,
      toType: data.toType,
      toId: data.toId,
      kind: data.kind,
    },
  });
  if (existing) {
    return db.memoryEdge.update({
      where: { id: existing.id },
      data: {
        label: data.label,
        weight: data.weight,
        confidence: data.confidence,
        evidenceCount: { increment: 1 },
        sourceType: data.sourceType,
        sourceRefType: data.sourceRefType,
        sourceRefId: data.sourceRefId,
        visibility: data.visibility,
        status: data.status,
      },
    });
  }
  return db.memoryEdge.create({ data });
}

async function runMemoryLabScenario(
  app: FastifyInstance,
  body: z.infer<typeof memoryLabScenarioSchema>,
) {
  const runId = memoryLabRunId();

  if (body.scenario === "worker_accepts_offer" || body.scenario === "worker_declines_offer") {
    const outcome = body.scenario === "worker_accepts_offer" ? "accepted" : "declined";
    const { offer, bookingRequest, worker, site } = await createMemoryLabOffer(
      app.db,
      runId,
      body.workerId,
      body.organisationId,
    );
    await app.db.offer.update({ where: { id: offer.id }, data: { status: outcome } });
    const memoryResult = await app.agents.memory.recordOfferOutcome(offer.id, outcome);
    await writeMemoryLabEvent(
      app.db,
      runId,
      `memory_lab.offer.${outcome}`,
      `${worker.firstName} ${outcome} a synthetic offer at ${site.name}.`,
      { offerId: offer.id, bookingRequestId: bookingRequest.id, memoryResult },
    );
    return {
      runId,
      scenario: body.scenario,
      result: { offerId: offer.id, bookingRequestId: bookingRequest.id, memoryResult },
      state: await getMemoryLabState(app.db),
    };
  }

  if (body.scenario === "ineligible_memory_boundary") {
    const ineligibleWorkerId = body.workerId || "demo-worker-5";
    const bookingRequest = await app.db.bookingRequest.findUnique({
      where: { id: body.bookingRequestId },
      include: { site: true },
    });
    if (!bookingRequest) throw new Error(`BookingRequest ${body.bookingRequestId} not found.`);
    const edge = await upsertMemoryLabEdge(app.db, {
      ownerType: "worker",
      ownerId: ineligibleWorkerId,
      fromType: "worker",
      fromId: ineligibleWorkerId,
      toType: "site",
      toId: bookingRequest.siteId,
      kind: "fit_signal",
      label: "Memory Lab: deliberately strong fit signal for compliance boundary test.",
      weight: 1,
      confidence: 1,
      evidenceCount: 1,
      sourceType: "system_event",
      sourceRefType: MEMORY_LAB_SOURCE,
      sourceRefId: runId,
      visibility: "operational",
      status: "active",
    });
    const ranking = await app.agents.market.rankCandidates(body.bookingRequestId, 20);
    const rankedWorkerIds = (ranking.data ?? []).map((match) => match.workerId);
    const blockedByCompliance = !rankedWorkerIds.includes(ineligibleWorkerId);
    await writeMemoryLabEvent(
      app.db,
      runId,
      "memory_lab.compliance_boundary",
      blockedByCompliance
        ? "Strong memory signal did not bypass deterministic compliance."
        : "Compliance boundary failed: ineligible worker appeared in ranking.",
      { edgeId: edge.id, bookingRequestId: body.bookingRequestId, ineligibleWorkerId, rankedWorkerIds },
      blockedByCompliance ? "passed" : "failed",
    );
    return {
      runId,
      scenario: body.scenario,
      result: { blockedByCompliance, edgeId: edge.id, rankedWorkerIds },
      state: await getMemoryLabState(app.db),
    };
  }

  const note =
    body.note ??
    "Greenfield usually wants repeat KS2 workers and prefers a briefing note about the morning gate procedure.";
  const memoryResult = await app.agents.memory.rememberFromEvent({
    ownerType: "organisation",
    ownerId: body.organisationId,
    subjectType: "organisation",
    subjectId: body.organisationId,
    sourceRefType: MEMORY_LAB_SOURCE,
    sourceRefId: runId,
    text: note,
  });
  await writeMemoryLabEvent(app.db, runId, "memory_lab.infer", "Ran memory inference from a lab note.", {
    memoryResult,
  });
  return {
    runId,
    scenario: body.scenario,
    result: { memoryResult },
    state: await getMemoryLabState(app.db),
  };
}

export const sandboxRoutes: FastifyPluginAsync = async (app) => {
  app.get("/scenarios", async () => {
    const directory = await getDemoDirectory(app.db);
    return {
      scenarios: SCENARIOS.map((scenario) => ({
        ...scenario,
        coverage: coverageForScenario(scenario.id, directory),
      })),
    };
  });

  app.post("/reset", async () => {
    const deleted = await resetSandboxData(app.db);
    return { success: true, deleted };
  });

  app.get("/memory-lab/state", async () => {
    return getMemoryLabState(app.db);
  });

  app.post("/memory-lab/reset", async () => {
    const deleted = await resetMemoryLab(app.db);
    return { success: true, deleted, state: await getMemoryLabState(app.db) };
  });

  app.post("/memory-lab/memory", async (request, reply) => {
    const parsed = memoryLabMemorySchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const result = await createMemoryLabEntry(app.db, parsed.data);
    return reply.send({ ...result, state: await getMemoryLabState(app.db) });
  });

  app.post("/memory-lab/scenarios/run", async (request, reply) => {
    const parsed = memoryLabScenarioSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      return reply.send(await runMemoryLabScenario(app, parsed.data));
    } catch (err) {
      const runId = memoryLabRunId();
      await writeMemoryLabEvent(
        app.db,
        runId,
        "memory_lab.scenario.error",
        err instanceof Error ? err.message : "Memory Lab scenario failed.",
        {},
        "failed",
      );
      return reply.code(400).send({ error: err instanceof Error ? err.message : "Memory Lab scenario failed." });
    }
  });

  app.post("/scenarios/:id/run", async (request, reply) => {
    const { id } = request.params as { id: string };
    const scenario = SCENARIOS.find((item) => item.id === id);
    if (!scenario) return reply.code(404).send({ error: "Sandbox scenario not found." });
    const scenarioId = scenario.id;

    await resetSandboxData(app.db);
    const runId = `sandbox-${scenarioId}-${Date.now()}`;
    await writeSandboxEvent(
      app.db,
      runId,
      "ops",
      "sandbox.run.start",
      `${scenario.title} started from the admin sandbox.`,
      "started",
    );

    if (scenarioId === "single-cover-loop") await runSingleCoverLoop(app.db, app, runId);
    if (scenarioId === "all-avatars-market-day") await runAllAvatarsMarketDay(app.db, app, runId);
    if (scenarioId === "compliance-block-unlock") await runComplianceBlockUnlock(app.db, app, runId);
    if (scenarioId === "replacement-recovery") await runReplacementRecovery(app.db, app, runId);
    if (scenarioId === "dynamic-rate-clearing") await runDynamicRateClearing(app.db, app, runId);

    await writeSandboxEvent(
      app.db,
      runId,
      "ops",
      "sandbox.run.complete",
      `${scenario.title} completed.`,
      "completed",
    );

    const directory = await getDemoDirectory(app.db);
    const result: ScenarioRunResult = {
      runId,
      scenarioId,
      title: scenario.title,
      summary: await summarizeRun(app.db, runId),
      timeline: await getTimeline(app.db, runId),
      coverage: coverageForScenario(scenarioId, directory),
    };
    return reply.send(result);
  });

  app.get("/runs/:runId", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const start = await app.db.auditEvent.findFirst({
      where: { entityType: "SandboxRun", entityId: runId },
      orderBy: { createdAt: "asc" },
    });
    if (!start) return reply.code(404).send({ error: "Sandbox run not found." });

    const scenarioId = runId.split("sandbox-")[1]?.split("-").slice(0, -1).join("-") as ScenarioId;
    const scenario = SCENARIOS.find((item) => item.id === scenarioId);
    const directory = await getDemoDirectory(app.db);
    return reply.send({
      runId,
      scenarioId,
      title: scenario?.title ?? "Sandbox Run",
      summary: await summarizeRun(app.db, runId),
      timeline: await getTimeline(app.db, runId),
      coverage: scenario ? coverageForScenario(scenario.id, directory) : directory,
    });
  });
};
