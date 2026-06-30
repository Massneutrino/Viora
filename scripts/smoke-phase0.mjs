import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadDotEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === "") {
      process.env[key] = value;
    }
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertAtLeast(actual, minimum, label) {
  assert(
    typeof actual === "number" && actual >= minimum,
    `${label}: expected >= ${minimum}, got ${actual}`,
  );
}

function actions(result) {
  return new Set((result.timeline ?? []).map((item) => item.action));
}

function coverageStatus(result, id) {
  return result.coverage?.find((item) => item.id === id)?.status;
}

async function injectJson(app, method, url, payload) {
  const response = await app.inject({
    method,
    url,
    payload,
    headers: payload ? { "content-type": "application/json" } : undefined,
  });
  let body;
  try {
    body = response.json();
  } catch {
    body = response.body;
  }
  assert(
    response.statusCode >= 200 && response.statusCode < 300,
    `${method} ${url} failed with ${response.statusCode}: ${response.body}`,
  );
  return body;
}

async function injectExpect(app, method, url, payload, expectedStatus) {
  const response = await app.inject({
    method,
    url,
    payload,
    headers: payload ? { "content-type": "application/json" } : undefined,
  });
  let body;
  try {
    body = response.json();
  } catch {
    body = response.body;
  }
  assert(
    response.statusCode === expectedStatus,
    `${method} ${url} expected ${expectedStatus}, got ${response.statusCode}: ${response.body}`,
  );
  return body;
}

function assertTimeline(result, requiredActions) {
  const seen = actions(result);
  for (const action of requiredActions) {
    assert(seen.has(action), `${result.scenarioId}: missing timeline action ${action}`);
  }
}

function assertScenario(result, expected) {
  assert(result.runId, `${expected.id}: missing runId`);
  assert(result.scenarioId === expected.id, `expected ${expected.id}, got ${result.scenarioId}`);
  assertAtLeast(result.timeline?.length ?? 0, expected.minTimeline, `${expected.id} timeline`);
  assertAtLeast(result.summary?.auditEvents ?? 0, expected.minAuditEvents, `${expected.id} audit events`);
  for (const [key, minimum] of Object.entries(expected.summaryAtLeast ?? {})) {
    assertAtLeast(result.summary?.[key], minimum, `${expected.id} ${key}`);
  }
  assertTimeline(result, expected.actions);
  for (const [id, status] of Object.entries(expected.coverage ?? {})) {
    assert(
      coverageStatus(result, id) === status,
      `${expected.id}: expected ${id} coverage ${status}, got ${coverageStatus(result, id)}`,
    );
  }
}

loadDotEnv();

const { buildServer } = await import("../apps/api/src/index.ts");
const app = await buildServer();

try {
  await app.ready();

  const health = await injectJson(app, "GET", "/health/ready");
  assert(health.status === "ready", `health status not ready: ${JSON.stringify(health)}`);
  assert(health.database === "connected", `database not connected: ${JSON.stringify(health)}`);

  const root = await injectJson(app, "GET", "/");
  assert(root.name === "Viora API", "root route did not return API identity");

  const directory = await injectJson(app, "GET", "/v1/admin/demo/directory");
  assertAtLeast(directory.organisations?.length ?? 0, 6, "demo organisations");
  assertAtLeast(directory.workers?.length ?? 0, 15, "demo workers");

  const scenarios = await injectJson(app, "GET", "/v1/admin/sandbox/scenarios");
  const scenarioIds = new Set((scenarios.scenarios ?? []).map((scenario) => scenario.id));
  for (const id of [
    "single-cover-loop",
    "all-avatars-market-day",
    "compliance-block-unlock",
    "replacement-recovery",
    "dynamic-rate-clearing",
  ]) {
    assert(scenarioIds.has(id), `missing sandbox scenario ${id}`);
  }

  await injectJson(app, "POST", "/v1/admin/sandbox/reset", {});

  const guardrailBeforeApprovals = await app.db.guardrailPolicy.findUnique({
    where: { organisationId: "demo-org" },
    select: { autonomyLevel: true },
  });
  await app.db.guardrailPolicy.update({
    where: { organisationId: "demo-org" },
    data: { autonomyLevel: "L1" },
  });

  const queuedBroadcast = await injectExpect(
    app,
    "POST",
    "/v1/bookings/demo-booking-request/broadcast",
    {},
    202,
  );
  assert(queuedBroadcast.requiresHumanApproval, "L1 broadcast should require human approval");
  assert(queuedBroadcast.approval?.id, "L1 broadcast should return pending approval id");

  const approvalsList = await injectJson(app, "GET", "/v1/admin/approvals");
  assert(
    approvalsList.approvals?.some((row) => row.id === queuedBroadcast.approval.id),
    "queued approval missing from admin approvals list",
  );

  const approved = await injectJson(
    app,
    "POST",
    `/v1/admin/approvals/${queuedBroadcast.approval.id}/approve`,
    { adminId: "admin" },
  );
  assert(approved.execution?.success, `approval execution failed: ${approved.execution?.explanation ?? "unknown"}`);

  const approvalOfferCount = await app.db.offer.count({
    where: { bookingRequestId: "demo-booking-request" },
  });
  assertAtLeast(approvalOfferCount, 1, "approval broadcast offer count");

  await app.db.guardrailPolicy.update({
    where: { organisationId: "demo-org" },
    data: { autonomyLevel: guardrailBeforeApprovals?.autonomyLevel ?? "L2" },
  });
  console.log("✓ approvals: L1 broadcast queued and approved");

  const expectations = [
    {
      id: "single-cover-loop",
      minTimeline: 8,
      minAuditEvents: 8,
      summaryAtLeast: {
        conversations: 1,
        bookingRequests: 1,
        matches: 1,
        offers: 1,
        bookings: 1,
        shifts: 1,
        timesheets: 1,
        invoices: 1,
      },
      actions: [
        "sandbox.employer.request",
        "sandbox.market.broadcast",
        "sandbox.worker.accept",
        "sandbox.shift.complete",
        "sandbox.invoice.generate",
        "sandbox.run.complete",
      ],
      coverage: { "demo-worker": "accepted", "demo-worker-5": "compliance-blocked" },
    },
    {
      id: "all-avatars-market-day",
      minTimeline: 36,
      minAuditEvents: 36,
      summaryAtLeast: {
        conversations: 6,
        bookingRequests: 6,
        matches: 6,
        offers: 6,
        bookings: 6,
        shifts: 6,
        timesheets: 6,
        invoices: 1,
      },
      actions: [
        "sandbox.employer.request",
        "sandbox.market.broadcast",
        "sandbox.worker.accept",
        "sandbox.invoice.generate",
        "sandbox.run.complete",
      ],
      coverage: {
        "demo-worker": "accepted",
        "demo-worker-6": "accepted",
        "demo-worker-10": "accepted",
        "demo-worker-14": "compliance-blocked",
      },
    },
    {
      id: "compliance-block-unlock",
      minTimeline: 11,
      minAuditEvents: 11,
      summaryAtLeast: {
        conversations: 1,
        bookingRequests: 1,
        matches: 1,
        offers: 1,
        bookings: 1,
        shifts: 1,
        timesheets: 1,
        invoices: 1,
      },
      actions: [
        "sandbox.compliance.block",
        "sandbox.compliance.verify",
        "sandbox.market.rebroadcast",
        "sandbox.worker.accept",
        "sandbox.run.complete",
      ],
      coverage: { "demo-worker-5": "accepted", "demo-worker-11": "compliance-blocked" },
    },
    {
      id: "replacement-recovery",
      minTimeline: 7,
      minAuditEvents: 7,
      summaryAtLeast: {
        conversations: 1,
        bookingRequests: 1,
        matches: 1,
        offers: 1,
        bookings: 1,
        shifts: 1,
      },
      actions: [
        "sandbox.worker.accept",
        "sandbox.booking.cancel",
        "sandbox.replacement.trigger",
        "sandbox.run.complete",
      ],
      coverage: { "demo-worker": "accepted", "demo-worker-2": "backup" },
    },
    {
      id: "dynamic-rate-clearing",
      minTimeline: 5,
      minAuditEvents: 5,
      summaryAtLeast: {
        conversations: 1,
        bookingRequests: 1,
        matches: 1,
        offers: 1,
      },
      actions: [
        "sandbox.employer.request",
        "sandbox.market.broadcast",
        "sandbox.market.dynamic_rate_clear",
        "sandbox.run.complete",
      ],
      coverage: { "demo-worker": "backup", "demo-worker-9": "backup" },
    },
  ];

  const results = [];
  for (const expected of expectations) {
    const result = await injectJson(app, "POST", `/v1/admin/sandbox/scenarios/${expected.id}/run`, {});
    assertScenario(result, expected);
    results.push(result);
    console.log(`✓ ${expected.id}: ${result.summary.auditEvents} audit events`);
  }

  const guardrail = await app.db.guardrailPolicy.findUnique({
    where: { organisationId: "demo-org" },
    select: { autonomyLevel: true, budgetCeiling: true },
  });
  assert(guardrail?.autonomyLevel === "L2", "dynamic-rate scenario did not restore demo-org autonomy to L2");
  assert(guardrail?.budgetCeiling === 200, "dynamic-rate scenario did not restore demo-org budget ceiling");

  const latestDynamic = results.find((result) => result.scenarioId === "dynamic-rate-clearing");
  const dynamicRequestId = latestDynamic.timeline.find(
    (item) => item.action === "sandbox.market.dynamic_rate_clear",
  )?.entityIds?.bookingRequestId;
  const negotiations = dynamicRequestId
    ? await app.db.negotiationRecord.count({ where: { bookingRequestId: dynamicRequestId } })
    : 0;
  assertAtLeast(negotiations, 1, "dynamic-rate negotiations");

  const workerOffer = await injectJson(app, "GET", "/v1/workers/demo-worker/offer");
  assert(workerOffer.offer, "worker offer endpoint did not return a pending seeded/sandbox offer");
  assert(workerOffer.offer.id, "worker offer DTO missing id");
  assert(workerOffer.offer.role, "worker offer DTO missing role");
  assert(typeof workerOffer.offer.payPerDay === "number", "worker offer DTO missing numeric payPerDay");

  const scheduleFrom = new Date();
  scheduleFrom.setDate(scheduleFrom.getDate() - 30);
  const scheduleTo = new Date();
  scheduleTo.setDate(scheduleTo.getDate() + 30);
  const scheduleQuery = `from=${encodeURIComponent(scheduleFrom.toISOString())}&to=${encodeURIComponent(scheduleTo.toISOString())}`;
  const workerSchedule = await injectJson(app, "GET", `/v1/workers/demo-worker/schedule?${scheduleQuery}&granularity=hour`);
  assert(workerSchedule.events?.length > 0, "worker schedule returned no events");
  assert(workerSchedule.events.some((event) => event.kind === "unavailable_block"), "worker schedule missing availability block");
  assert(workerSchedule.hours?.length > 0, "worker hourly schedule missing hour buckets");

  const orgSchedule = await injectJson(app, "GET", `/v1/organisations/demo-org/schedule?${scheduleQuery}&granularity=hour`);
  assert(orgSchedule.events?.length > 0, "organisation schedule returned no events");
  assert(
    !orgSchedule.events.some((event) => event.kind === "unavailable_block"),
    "organisation schedule leaked worker availability blocks",
  );
  assert(orgSchedule.hours?.length > 0, "organisation hourly schedule missing hour buckets");

  const blockStart = new Date();
  blockStart.setDate(blockStart.getDate() + 20);
  blockStart.setUTCHours(10, 0, 0, 0);
  const blockEnd = new Date(blockStart);
  blockEnd.setUTCHours(12, 0, 0, 0);
  const createdAvailability = await injectJson(app, "POST", "/v1/workers/demo-worker/availability/blocks", {
    startAt: blockStart.toISOString(),
    endAt: blockEnd.toISOString(),
    note: "Smoke test unavailable block",
  });
  assert(createdAvailability.block?.id, "availability block create did not return an id");
  await injectJson(app, "DELETE", `/v1/workers/demo-worker/availability/blocks/${createdAvailability.block.id}`);
  const availabilityAuditEvents = await app.db.auditEvent.count({
    where: {
      entityType: "WorkerAvailabilityBlock",
      action: { in: ["schedule.availability.block.create", "schedule.availability.block.delete"] },
    },
  });
  assertAtLeast(availabilityAuditEvents, 2, "availability audit events");

  const monitorTarget = await app.db.booking.findFirst({
    where: { status: { in: ["confirmed", "in_progress", "at_risk"] } },
    include: { shift: true },
    orderBy: { createdAt: "desc" },
  });
  assert(monitorTarget?.shift, "monitor smoke: no booking with shift found");

  const soonStart = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const soonEnd = new Date(soonStart.getTime() + 6 * 60 * 60 * 1000);
  await app.db.booking.update({
    where: { id: monitorTarget.id },
    data: { startAt: soonStart, endAt: soonEnd, status: "confirmed" },
  });
  await app.db.shift.update({
    where: { id: monitorTarget.shift.id },
    data: {
      status: "scheduled",
      checkedInAt: null,
      checkedOutAt: null,
    },
  });

  const monitorResult = await injectJson(app, "POST", `/v1/admin/bookings/${monitorTarget.id}/monitor`);
  assert(monitorResult.success, `monitor booking failed: ${monitorResult.explanation ?? "unknown"}`);

  const monitoredBooking = await app.db.booking.findUnique({ where: { id: monitorTarget.id } });
  assert(monitoredBooking?.status === "at_risk", "monitor did not mark booking at_risk");

  const monitorAuditEvents = await app.db.auditEvent.count({
    where: { action: "booking.monitor", entityId: monitorTarget.id },
  });
  assertAtLeast(monitorAuditEvents, 1, "booking.monitor audit events");
  console.log("✓ monitor: booking marked at_risk with audit trail");

  const audit = await injectJson(app, "GET", "/v1/admin/audit");
  assertAtLeast(audit.events?.length ?? 0, 1, "admin audit events");

  console.log("\nPhase 0 smoke test passed.");
} finally {
  await app.close();
  await app.db.$disconnect();
}
