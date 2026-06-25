import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadDotEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const idx = trimmed.indexOf("=");
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadDotEnv();

const API_URL = process.env.API_URL ?? "http://localhost:6200";
const ORG_ID = process.env.MEMORY_TEST_ORG_ID ?? "demo-org";
const WORKER_ID = process.env.MEMORY_TEST_WORKER_ID ?? "demo-worker";
const INELIGIBLE_WORKER_ID = process.env.MEMORY_TEST_INELIGIBLE_WORKER_ID ?? "demo-worker-5";
const BOOKING_REQUEST_ID = process.env.MEMORY_TEST_BOOKING_REQUEST_ID ?? "demo-booking-request";
const OFFER_ID = process.env.MEMORY_TEST_OFFER_ID ?? "demo-offer";
const runId = `smoke_${Date.now()}`;

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

function log(message) {
  console.log(`✓ ${message}`);
}

function warn(message) {
  console.warn(`! ${message}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });
  const text = await res.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }
  if (!res.ok) {
    throw new Error(`${options.method ?? "GET"} ${path} failed (${res.status}): ${text}`);
  }
  return body;
}

async function waitForApi() {
  for (let i = 0; i < 20; i++) {
    try {
      await request("/health/ready");
      return;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
    }
  }
  throw new Error(`API is not ready at ${API_URL}. Start it with: npm.cmd run dev:api`);
}

async function createMemory(path, payload) {
  const result = await request(path, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return result.memory;
}

async function patchMemory(path, payload) {
  const result = await request(path, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return result.memory;
}

async function deleteMemory(path) {
  const result = await request(path, { method: "DELETE" });
  return result.memory;
}

try {
  await waitForApi();
  log(`API ready at ${API_URL}`);

  const orgMemory = await createMemory(`/v1/organisations/${ORG_ID}/memory`, {
    kind: "preference",
    key: `memory_smoke_org_${runId}`,
    title: `Memory smoke org ${runId}`,
    content: "Use repeat workers first for KS2 cover when available.",
    visibility: "operational",
  });
  assert(orgMemory.ownerType === "organisation", "Organisation memory has wrong owner type.");
  log("organisation memory created");

  const orgUpdated = await patchMemory(`/v1/organisations/${ORG_ID}/memory/${orgMemory.id}`, {
    content: "Use familiar, compliant repeat workers first for KS2 cover when available.",
  });
  assert(orgUpdated.content.includes("familiar"), "Organisation memory did not update.");
  log("organisation memory updated");

  const orgList = await request(`/v1/organisations/${ORG_ID}/memory`);
  assert(
    orgList.memories.some((memory) => memory.id === orgMemory.id),
    "Organisation memory was not returned by list endpoint.",
  );
  log("organisation memory listed");

  const workerMemory = await createMemory(`/v1/workers/${WORKER_ID}/memory`, {
    kind: "preference",
    key: `memory_smoke_worker_${runId}`,
    title: `Memory smoke worker ${runId}`,
    content: "Prefer shifts under 25 minutes unless pay is unusually strong.",
    visibility: "private",
  });
  assert(workerMemory.ownerType === "worker", "Worker memory has wrong owner type.");
  assert(workerMemory.visibility === "private", "Worker memory was not private.");
  log("private worker memory created");

  const orgListAfterWorkerCreate = await request(`/v1/organisations/${ORG_ID}/memory`);
  assert(
    !orgListAfterWorkerCreate.memories.some((memory) => memory.id === workerMemory.id),
    "Worker memory leaked into organisation memory list.",
  );
  log("worker/organisation ownership isolation verified");

  const workerOperational = await patchMemory(`/v1/workers/${WORKER_ID}/memory/${workerMemory.id}`, {
    visibility: "operational",
  });
  assert(workerOperational.visibility === "operational", "Worker memory visibility did not update.");
  log("worker memory visibility toggled");

  const inferred = await prisma.memoryEntry.create({
    data: {
      ownerType: "worker",
      ownerId: WORKER_ID,
      subjectType: "worker",
      subjectId: WORKER_ID,
      kind: "preference",
      key: `memory_smoke_inferred_${runId}`,
      title: `Memory smoke inferred ${runId}`,
      content: "Synthetic inferred memory for admin review smoke test.",
      sourceType: "agent_inferred",
      sourceRefType: "SmokeTest",
      sourceRefId: runId,
      visibility: "operational",
      status: "pending_confirmation",
      confidence: 0.91,
    },
  });

  const pending = await request("/v1/admin/memory/pending");
  assert(
    pending.memories.some((memory) => memory.id === inferred.id),
    "Pending inferred memory did not appear in admin review.",
  );
  await patchMemory(`/v1/admin/memory/${inferred.id}`, { status: "active", adminId: "smoke-test" });
  log("admin pending memory review verified");

  const offer = await request(`/v1/workers/${WORKER_ID}/offer`);
  if (offer.offer?.id === OFFER_ID) {
    await request(`/v1/workers/${WORKER_ID}/offers/${OFFER_ID}/decline`, { method: "POST" });
    const edgeCount = await prisma.memoryEdge.count({
      where: { sourceRefType: "Offer", sourceRefId: OFFER_ID },
    });
    assert(edgeCount > 0, "Offer decline did not create/update MemoryEdge rows.");
    const audit = await request("/v1/admin/audit");
    assert(
      audit.events.some((event) => event.action === "memory.edge.update" && event.entityId === OFFER_ID),
      "Offer decline did not write memory.edge.update audit event.",
    );
    log("offer decline reinforced memory graph and audit log");
  } else {
    warn(
      `No pending ${OFFER_ID} available for ${WORKER_ID}; run npm.cmd run db:seed before smoke to test lifecycle learning.`,
    );
  }

  await prisma.memoryEdge.upsert({
    where: {
      ownerType_ownerId_fromType_fromId_toType_toId_kind: {
        ownerType: "worker",
        ownerId: INELIGIBLE_WORKER_ID,
        fromType: "worker",
        fromId: INELIGIBLE_WORKER_ID,
        toType: "site",
        toId: "demo-site",
        kind: "fit_signal",
      },
    },
    update: {
      weight: 1,
      confidence: 1,
      status: "active",
      sourceType: "system_event",
      sourceRefType: "SmokeTest",
      sourceRefId: runId,
    },
    create: {
      ownerType: "worker",
      ownerId: INELIGIBLE_WORKER_ID,
      fromType: "worker",
      fromId: INELIGIBLE_WORKER_ID,
      toType: "site",
      toId: "demo-site",
      kind: "fit_signal",
      label: "Synthetic strong memory signal for ineligible worker.",
      weight: 1,
      confidence: 1,
      sourceType: "system_event",
      sourceRefType: "SmokeTest",
      sourceRefId: runId,
      visibility: "operational",
      status: "active",
    },
  });
  const matches = await request(`/v1/bookings/${BOOKING_REQUEST_ID}/matches`);
  const matchWorkerIds = (matches.data ?? []).map((match) => match.workerId);
  assert(
    !matchWorkerIds.includes(INELIGIBLE_WORKER_ID),
    "Memory signal allowed an ineligible worker into ranking.",
  );
  log("compliance boundary verified after strong memory signal");

  await deleteMemory(`/v1/organisations/${ORG_ID}/memory/${orgMemory.id}`);
  await deleteMemory(`/v1/workers/${WORKER_ID}/memory/${workerMemory.id}`);
  await prisma.memoryEntry.update({
    where: { id: inferred.id },
    data: { status: "deleted", content: "[deleted]" },
  });
  log("memory cleanup completed");

  const audit = await request("/v1/admin/audit");
  assert(
    audit.events.some((event) => ["memory.create", "memory.update", "memory.delete"].includes(event.action)),
    "Memory mutation audit events were not visible in latest audit log.",
  );
  log("memory mutation audit events verified");

  console.log("\nViora Memory smoke test passed.");
} finally {
  await prisma.$disconnect();
}
