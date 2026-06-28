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
const USE_HTTP = process.env.MEMORY_TEST_USE_HTTP === "1";
const ORG_ID = process.env.MEMORY_TEST_ORG_ID ?? "demo-org";
const WORKER_ID = process.env.MEMORY_TEST_WORKER_ID ?? "demo-worker";
const INELIGIBLE_WORKER_ID = process.env.MEMORY_TEST_INELIGIBLE_WORKER_ID ?? "demo-worker-5";
const BOOKING_REQUEST_ID = process.env.MEMORY_TEST_BOOKING_REQUEST_ID ?? "demo-booking-request";
const OFFER_ID = process.env.MEMORY_TEST_OFFER_ID ?? "demo-offer";
const runId = `smoke_${Date.now()}`;

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
let app = null;

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
  if (app) {
    const res = await app.inject({
      method: options.method ?? "GET",
      url: path,
      payload: options.body,
      headers,
    });
    const text = res.body;
    let body = {};
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: text };
      }
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`${options.method ?? "GET"} ${path} failed (${res.statusCode}): ${text}`);
    }
    return body;
  }
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
  if (!USE_HTTP) {
    const { buildServer } = await import("../apps/api/src/index.ts");
    app = await buildServer();
    await app.ready();
    return;
  }
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
  log(app ? "API ready in-process" : `API ready at ${API_URL}`);

  const orgMemory = await createMemory(`/v1/organisations/${ORG_ID}/memory`, {
    kind: "preference",
    key: `memory_smoke_org_${runId}`,
    title: `Memory smoke org ${runId}`,
    content: "Use repeat workers first for KS2 cover when available.",
    visibility: "operational",
  });
  assert(orgMemory.ownerType === "organisation", "Organisation memory has wrong owner type.");
  assert(orgMemory.useScopes.includes("intake_default"), "Organisation memory did not get intake scope.");
  assert(orgMemory.useScopes.includes("connector_export"), "Organisation memory did not get export scope.");
  log("organisation memory created");

  const connectors = await request(`/v1/organisations/${ORG_ID}/memory/connectors`);
  assert(
    connectors.connectors.some((connector) => connector.type === "institutional_kb" && connector.reviewGated),
    "Connector foundation did not expose review-gated institutional memory.",
  );
  log("memory connectors listed");

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
  assert(workerMemory.useScopes.length === 1 && workerMemory.useScopes[0] === "profile", "Private worker memory was not profile-scoped.");
  log("private worker memory created");

  const orgListAfterWorkerCreate = await request(`/v1/organisations/${ORG_ID}/memory`);
  assert(
    !orgListAfterWorkerCreate.memories.some((memory) => memory.id === workerMemory.id),
    "Worker memory leaked into organisation memory list.",
  );
  log("worker/organisation ownership isolation verified");

  const workerRankingListBefore = await request(`/v1/workers/${WORKER_ID}/memory?scope=ranking_signal`);
  assert(
    !workerRankingListBefore.memories.some((memory) => memory.id === workerMemory.id),
    "Private profile-only memory appeared in ranking scope.",
  );
  log("private worker memory excluded from ranking scope");

  const workerOperational = await patchMemory(`/v1/workers/${WORKER_ID}/memory/${workerMemory.id}`, {
    visibility: "operational",
    useScopes: ["profile", "ranking_signal", "briefing", "explanation"],
  });
  assert(workerOperational.visibility === "operational", "Worker memory visibility did not update.");
  assert(workerOperational.useScopes.includes("ranking_signal"), "Worker memory did not get explicit ranking scope.");
  log("worker memory visibility toggled");

  const importResult = await request(`/v1/workers/${WORKER_ID}/memory/import`, {
    method: "POST",
    body: JSON.stringify({
      connectorType: "personal_ai_memory",
      sourceLabel: "Smoke personal AI memory",
      items: [
        {
          connectorType: "personal_ai_memory",
          connectorRef: `smoke-connector-${runId}`,
          kind: "preference",
          title: `Memory smoke imported ${runId}`,
          content: "Imported preference should wait for worker confirmation.",
          visibility: "private",
          confidence: 0.82,
          useScopes: ["profile"],
        },
      ],
    }),
  });
  const imported = importResult.memories[0];
  assert(importResult.reviewRequired === true, "Connector import was not review-gated.");
  assert(imported.status === "pending_confirmation", "Imported memory was not pending confirmation.");
  assert(imported.sourceType === "connector_import", "Imported memory did not record connector source.");
  log("review-gated connector import verified");

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
  assert(
    pending.memories.some((memory) => memory.id === imported.id),
    "Pending imported memory did not appear in admin review.",
  );
  await patchMemory(`/v1/admin/memory/${inferred.id}`, { status: "active", adminId: "smoke-test" });
  log("admin pending memory review verified");

  const exportResult = await request(`/v1/organisations/${ORG_ID}/memory/export`);
  assert(
    exportResult.memories.some((memory) => memory.id === orgMemory.id),
    "Export endpoint did not include connector-export-scoped organisation memory.",
  );
  log("connector export verified");

  const consolidationMemoryId = `${runId}_consolidation_stale`;
  await prisma.memoryEntry.create({
    data: {
      id: consolidationMemoryId,
      ownerType: "organisation",
      ownerId: ORG_ID,
      subjectType: "organisation",
      subjectId: ORG_ID,
      kind: "briefing_note",
      key: `memory_smoke_consolidation_${runId}`,
      title: `Memory smoke consolidation ${runId}`,
      content: "Old briefing note used to verify admin consolidation review.",
      sourceType: "user_entered",
      visibility: "operational",
      status: "active",
      useScopes: ["briefing"],
      sensitivity: "standard",
      confidence: 0.7,
      updatedAt: new Date(Date.now() - 150 * 24 * 60 * 60 * 1000),
    },
  });
  const consolidation = await request("/v1/admin/memory/consolidation");
  const archiveSuggestion = consolidation.suggestions.find(
    (suggestion) =>
      suggestion.action === "archive" && suggestion.affectedMemoryIds?.includes(consolidationMemoryId),
  );
  assert(archiveSuggestion, "Memory consolidation did not suggest archiving stale active memory.");
  await request(`/v1/admin/memory/consolidation/${archiveSuggestion.id}/apply`, {
    method: "POST",
    body: JSON.stringify({ adminId: "smoke-test" }),
  });
  const archivedConsolidationMemory = await prisma.memoryEntry.findUnique({
    where: { id: consolidationMemoryId },
  });
  assert(
    archivedConsolidationMemory?.status === "archived",
    "Applying memory consolidation archive suggestion did not archive the memory.",
  );
  log("memory consolidation review verified");

  const offer = await request(`/v1/workers/${WORKER_ID}/offer`);
  if (offer.offer?.id === OFFER_ID) {
    await request(`/v1/workers/${WORKER_ID}/offers/${OFFER_ID}/decline`, { method: "POST" });
    const edgeCount = await prisma.memoryEdge.count({
      where: { sourceRefType: "Offer", sourceRefId: OFFER_ID },
    });
    assert(edgeCount > 0, "Offer decline did not create/update MemoryEdge rows.");
    const episodeCount = await prisma.memoryEpisode.count({
      where: { sourceRefType: "Offer", sourceRefId: OFFER_ID },
    });
    assert(episodeCount > 0, "Offer decline did not create MemoryEpisode rows.");
    const temporalEdge = await prisma.memoryEdge.findFirst({
      where: { sourceRefType: "Offer", sourceRefId: OFFER_ID },
      orderBy: { updatedAt: "desc" },
    });
    assert(temporalEdge?.lastEvidenceAt, "Offer decline did not stamp MemoryEdge.lastEvidenceAt.");
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

  const influenceAudit = await request("/v1/admin/audit");
  assert(
    influenceAudit.events.some((event) => event.action === "memory.influence" && event.entityId === BOOKING_REQUEST_ID),
    "Ranking did not write memory.influence audit event.",
  );
  log("memory influence audit verified");

  const linkedEdge = await prisma.memoryEdge.create({
    data: {
      ownerType: "organisation",
      ownerId: ORG_ID,
      fromType: "organisation",
      fromId: ORG_ID,
      toType: "role",
      toId: `ks2_supply_teacher_${runId}`,
      kind: "pattern",
      label: "Synthetic edge linked to a memory entry for deletion cleanup.",
      weight: 0.2,
      confidence: 0.7,
      sourceType: "system_event",
      sourceRefType: "MemoryEntry",
      sourceRefId: orgMemory.id,
      visibility: "operational",
      status: "active",
    },
  });

  await deleteMemory(`/v1/organisations/${ORG_ID}/memory/${orgMemory.id}`);
  await deleteMemory(`/v1/workers/${WORKER_ID}/memory/${workerMemory.id}`);
  await deleteMemory(`/v1/workers/${WORKER_ID}/memory/${imported.id}`);
  const archivedLinkedEdge = await prisma.memoryEdge.findUnique({ where: { id: linkedEdge.id } });
  assert(archivedLinkedEdge?.status === "archived", "Deleting a memory did not archive linked MemoryEdge rows.");
  await prisma.memoryEntry.update({
    where: { id: inferred.id },
    data: { status: "deleted", content: "[deleted]", deletedAt: new Date() },
  });
  await prisma.memoryReviewSuggestion.deleteMany({
    where: { affectedMemoryIds: { has: consolidationMemoryId } },
  });
  await prisma.memoryEntry.deleteMany({ where: { id: consolidationMemoryId } });
  log("memory cleanup completed");

  const audit = await request("/v1/admin/audit");
  assert(
    audit.events.some((event) => ["memory.create", "memory.update", "memory.delete"].includes(event.action)),
    "Memory mutation audit events were not visible in latest audit log.",
  );
  log("memory mutation audit events verified");

  console.log("\nViora Memory smoke test passed.");
} finally {
  if (app) await app.close();
  await prisma.$disconnect();
}
