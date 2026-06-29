import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import process from "node:process";
import { PrismaClient } from "@prisma/client";

const ROOT = process.cwd();
const DEFAULT_BASE_URL = "postgresql://viora:viora@localhost:5432/viora";
const BASELINE_SCRIPT = resolve(ROOT, "scripts/smoke-phase0.mjs");
const PRISMA_SCHEMA = resolve(ROOT, "packages/database/prisma/schema.prisma");
const AVATAR_MODES = new Set(["deterministic", "llm"]);

class SandboxHttpError extends Error {
  constructor(method, url, statusCode, body) {
    super(`${method} ${url} failed with ${statusCode}: ${body}`);
    this.name = "SandboxHttpError";
    this.method = method;
    this.url = url;
    this.statusCode = statusCode;
    this.body = body;
  }
}

class SandboxLoopError extends Error {
  constructor(message, details, cause) {
    super(message);
    this.name = "SandboxLoopError";
    this.details = details;
    this.cause = cause;
  }
}

function loadDotEnv() {
  const envPath = resolve(ROOT, ".env");
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

function parseArgs(argv) {
  const args = {
    loops: 25,
    seed: Date.now(),
    keepDb: false,
    skipBaseline: false,
    report: null,
    avatarMode: "deterministic",
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--keep-db") args.keepDb = true;
    else if (arg === "--skip-baseline") args.skipBaseline = true;
    else if (arg === "--loops") args.loops = Number(argv[++i]);
    else if (arg.startsWith("--loops=")) args.loops = Number(arg.slice("--loops=".length));
    else if (arg === "--seed") args.seed = Number(argv[++i]);
    else if (arg.startsWith("--seed=")) args.seed = Number(arg.slice("--seed=".length));
    else if (arg === "--report") args.report = argv[++i] ?? null;
    else if (arg.startsWith("--report=")) args.report = arg.slice("--report=".length);
    else if (arg === "--avatar-mode") args.avatarMode = argv[++i] ?? "";
    else if (arg.startsWith("--avatar-mode=")) args.avatarMode = arg.slice("--avatar-mode=".length);
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(args.loops) || args.loops < 0) {
    throw new Error("--loops must be a non-negative integer.");
  }
  if (!Number.isFinite(args.seed)) {
    throw new Error("--seed must be a number.");
  }
  if (!AVATAR_MODES.has(args.avatarMode)) {
    throw new Error("--avatar-mode must be deterministic or llm.");
  }
  return args;
}

function printHelp() {
  console.log(`Usage: npm run test:sandbox -- [options]

Options:
  --loops <n>          Generated employer/V/worker loops to run. Default: 25
  --seed <number>     Reproducible pseudo-random seed. Default: current time
  --skip-baseline     Skip scripts/smoke-phase0.mjs in the sandbox DB
  --keep-db           Keep the ephemeral database for inspection
  --report <path>     Write the structured run report to a JSON file
  --avatar-mode <m>   deterministic or llm. Default: deterministic
`);
}

function bin(name) {
  const ext = process.platform === "win32" ? ".cmd" : "";
  return resolve(ROOT, "node_modules", ".bin", `${name}${ext}`);
}

function run(command, args, env) {
  return new Promise((resolveRun, reject) => {
    const spawnCommand = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : command;
    const spawnArgs =
      process.platform === "win32"
        ? ["/d", "/c", command, ...args]
        : args;
    const child = spawn(spawnCommand, spawnArgs, {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${basename(command)} ${args.join(" ")} failed with exit code ${code}`));
    });
  });
}

function runCapture(command, args) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.on("error", () => resolveRun(""));
    child.on("exit", (code) => resolveRun(code === 0 ? stdout.trim() : ""));
  });
}

function quoteIdent(value) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe database identifier: ${value}`);
  }
  return `"${value}"`;
}

function targetDatabaseUrl(baseUrl, databaseName) {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function maintenanceDatabaseUrl(baseUrl) {
  const url = new URL(baseUrl);
  if (!url.pathname || url.pathname === "/") url.pathname = "/postgres";
  return url.toString();
}

async function withMaintenanceClient(baseUrl, fn) {
  const db = new PrismaClient({
    datasources: {
      db: { url: maintenanceDatabaseUrl(baseUrl) },
    },
  });
  try {
    await fn(db);
  } finally {
    await db.$disconnect();
  }
}

async function createDatabase(baseUrl, databaseName) {
  await withMaintenanceClient(baseUrl, async (db) => {
    const ident = quoteIdent(databaseName);
    await db.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${ident} WITH (FORCE)`);
    await db.$executeRawUnsafe(`CREATE DATABASE ${ident}`);
  });
}

async function dropDatabase(baseUrl, databaseName) {
  await withMaintenanceClient(baseUrl, async (db) => {
    await db.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${quoteIdent(databaseName)} WITH (FORCE)`);
  });
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, items) {
  return items[Math.floor(rng() * items.length)];
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function serializeError(err) {
  if (err instanceof SandboxHttpError) {
    return {
      name: err.name,
      message: err.message,
      method: err.method,
      url: err.url,
      statusCode: err.statusCode,
      body: err.body,
    };
  }
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
      ...(err.cause ? { cause: serializeError(err.cause) } : {}),
    };
  }
  return { message: String(err) };
}

function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value, (_key, item) => {
    if (typeof item === "bigint") return item.toString();
    return item;
  }));
}

function writeJsonReport(path, report) {
  const absolute = resolve(ROOT, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(report, null, 2)}\n`);
  return absolute;
}

function defaultFailureReportPath(seed) {
  return `sandbox-regression-failure-${Math.abs(Math.trunc(seed))}-${process.pid}.json`;
}

async function injectJson(app, method, url, payload) {
  const res = await app.inject({
    method,
    url,
    payload,
    headers: payload ? { "content-type": "application/json" } : undefined,
  });
  let body;
  try {
    body = res.json();
  } catch {
    body = res.body;
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new SandboxHttpError(method, url, res.statusCode, res.body);
  }
  return body;
}

async function injectJsonRecorded(app, details, key, method, url, payload) {
  try {
    const body = await injectJson(app, method, url, payload);
    details.responses[key] = { ok: true, method, url, body: jsonSafe(body) };
    return body;
  } catch (err) {
    details.responses[key] = { ok: false, method, url, error: serializeError(err) };
    throw err;
  }
}

const REQUEST_PROFILES = [
  {
    organisationId: "demo-org",
    roleType: "supply_teacher",
    roleText: "supply teacher",
    payRate: 150,
    notes: ["KS2 cover", "Year 5 calm classroom", "phonics support helpful"],
  },
  {
    organisationId: "demo-org-primary",
    roleType: "supply_teacher",
    roleText: "supply teacher",
    payRate: 165,
    notes: ["upper key stage two", "strong behaviour routines", "PE cover in the afternoon"],
  },
  {
    organisationId: "demo-org-secondary",
    roleType: "cover_supervisor",
    roleText: "cover supervisor",
    payRate: 130,
    notes: ["secondary cover", "GCSE science worksheet supervision", "registration included"],
  },
  {
    organisationId: "demo-org-daycare",
    roleType: "teaching_assistant",
    roleText: "teaching assistant",
    payRate: 95,
    notes: ["early-years room", "under-2 support", "nursery lunch cover"],
  },
  {
    organisationId: "demo-org-nursery",
    roleType: "learning_support_assistant",
    roleText: "learning support assistant",
    payRate: 96,
    notes: ["one-to-one SEND support", "reception transition", "quiet sensory profile"],
  },
  {
    organisationId: "demo-org-university",
    roleType: "invigilator",
    roleText: "invigilator",
    payRate: 120,
    notes: ["exam hall", "morning assessment", "candidate check-in support"],
  },
];

const AVATAR_REQUEST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    rawInput: {
      type: "string",
      description: "A concise employer message containing the exact site id, date, start/end time, role and GBP day rate.",
    },
  },
  required: ["rawInput"],
};

function deterministicRequestText(profile, org, start, end, rng) {
  const note = pick(rng, profile.notes);
  return (
    `Please book a ${profile.roleText} at ${org.sites[0].id} on ${formatDate(start)} ` +
    `from ${start.toISOString().slice(11, 16)} to ${end.toISOString().slice(11, 16)} ` +
    `at GBP ${profile.payRate}/day. ${note}.`
  );
}

async function llmRequestText(profile, org, start, end) {
  const { createLLMClient } = await import("../packages/agents/src/llm.ts");
  const llm = await createLLMClient();
  const date = formatDate(start);
  const startTime = start.toISOString().slice(11, 16);
  const endTime = end.toISOString().slice(11, 16);
  const result = await llm.structured({
    toolName: "generate_employer_sandbox_request",
    toolDescription: "Generate one employer booking request for sandbox regression testing.",
    schema: AVATAR_REQUEST_SCHEMA,
    maxTokens: 500,
    system:
      "You generate realistic but test-safe UK education staffing requests for Viora. " +
      "Do not mention policy, testing, JSON, or implementation details. Return only the structured tool output.",
    prompt:
      `Generate one natural employer message. It must include these exact facts:\n` +
      `site id: ${org.sites[0].id}\n` +
      `role: ${profile.roleText}\n` +
      `date: ${date}\n` +
      `start time: ${startTime}\n` +
      `end time: ${endTime}\n` +
      `pay: GBP ${profile.payRate}/day\n` +
      `Context notes to optionally weave in: ${profile.notes.join(", ")}.`,
  });
  const rawInput = String(result.rawInput ?? "").trim();
  if (!rawInput.includes(org.sites[0].id) || !rawInput.includes(String(profile.payRate))) {
    throw new Error("LLM avatar request omitted required site id or pay rate.");
  }
  return rawInput;
}

async function buildGeneratedRequest(db, rng, index, avatarMode) {
  const profile = pick(rng, REQUEST_PROFILES);
  const org = await db.organisation.findUnique({
    where: { id: profile.organisationId },
    include: { sites: { take: 1, orderBy: { name: "asc" } } },
  });
  assert(org?.sites[0], `Missing seeded organisation/site: ${profile.organisationId}`);

  const start = addDays(new Date(), 3 + index);
  start.setUTCHours(8 + Math.floor(rng() * 2), rng() > 0.5 ? 15 : 30, 0, 0);
  const end = new Date(start);
  end.setUTCHours(15 + Math.floor(rng() * 2), rng() > 0.5 ? 0 : 30, 0, 0);
  const rawInput =
    avatarMode === "llm"
      ? await llmRequestText(profile, org, start, end)
      : deterministicRequestText(profile, org, start, end, rng);

  return {
    organisationId: profile.organisationId,
    roleType: profile.roleType,
    siteId: org.sites[0].id,
    avatarMode,
    rawInput,
  };
}

async function attachLoopDiagnostics(app, details) {
  const or = [];
  if (details.bookingRequestId) or.push({ entityType: "BookingRequest", entityId: details.bookingRequestId });
  if (details.conversationId) or.push({ entityType: "Conversation", entityId: details.conversationId });
  if (details.selected?.offerId) or.push({ entityType: "Offer", entityId: details.selected.offerId });
  if (details.selected?.workerId) or.push({ entityType: "Worker", entityId: details.selected.workerId });

  if (or.length > 0) {
    details.auditEvents = await app.db.auditEvent.findMany({
      where: { OR: or },
      orderBy: { createdAt: "asc" },
      take: 100,
    }).then(jsonSafe).catch((err) => [{ diagnosticError: serializeError(err) }]);
  }

  if (details.selected?.offerId) {
    const offerId = details.selected.offerId;
    const [memoryEdges, memoryEpisodes] = await Promise.all([
      app.db.memoryEdge.count({ where: { sourceRefType: "Offer", sourceRefId: offerId } }).catch(() => null),
      app.db.memoryEpisode.count({ where: { sourceRefType: "Offer", sourceRefId: offerId } }).catch(() => null),
    ]);
    details.counts = { ...details.counts, memoryEdges, memoryEpisodes };
  }

  if (details.bookingRequestId) {
    const [offers, bookings] = await Promise.all([
      app.db.offer.count({ where: { bookingRequestId: details.bookingRequestId } }).catch(() => null),
      app.db.booking.count({ where: { bookingRequestId: details.bookingRequestId } }).catch(() => null),
    ]);
    details.counts = { ...details.counts, offers, bookings };
  }
}

async function runGeneratedLoop(app, rng, index, avatarMode) {
  const details = {
    index,
    avatarMode,
    generated: null,
    bookingRequestId: null,
    selected: null,
    responses: {},
    counts: {},
    auditEvents: [],
    conversationId: null,
  };

  try {
    const generated = await buildGeneratedRequest(app.db, rng, index, avatarMode);
    details.generated = generated;
    const intake = await injectJsonRecorded(app, details, "intake", "POST", "/v1/intake/parse", {
      organisationId: generated.organisationId,
      rawInput: generated.rawInput,
      channel: "web",
      inboundMetadata: { sandboxRegression: true, loop: index, avatarMode },
    });
    details.conversationId = intake.conversationId ?? null;

    assert(!intake.fallbackUsed, `loop ${index}: V intake fell back instead of parsing live`);
    assert(intake.bookingRequestId, `loop ${index}: V intake did not create a booking request`);

    const bookingRequestId = intake.bookingRequestId;
    details.bookingRequestId = bookingRequestId;
    let pendingOffers = await app.db.offer.findMany({
      where: { bookingRequestId, status: "pending" },
      orderBy: { createdAt: "asc" },
    });
    if (pendingOffers.length === 0) {
      await injectJsonRecorded(app, details, "broadcast", "POST", `/v1/bookings/${bookingRequestId}/broadcast`, {});
      pendingOffers = await app.db.offer.findMany({
        where: { bookingRequestId, status: "pending" },
        orderBy: { createdAt: "asc" },
      });
    }
    assert(pendingOffers.length > 0, `loop ${index}: no pending offers available after broadcast`);

    const selected = pick(rng, pendingOffers);
    const outcome = index % 3 === 1 ? "declined" : "accepted";
    details.selected = { workerId: selected.workerId, offerId: selected.id, outcome };
    await injectJsonRecorded(app, details, "workerOffer", "GET", `/v1/workers/${selected.workerId}/offer`);
    const actionPath = outcome === "accepted" ? "accept" : "decline";
    await injectJsonRecorded(
      app,
      details,
      "workerAction",
      "POST",
      `/v1/workers/${selected.workerId}/offers/${selected.id}/${actionPath}`,
      {},
    );

    const [auditEvents, memoryEdges, episodes, booking] = await Promise.all([
      app.db.auditEvent.findMany({
        where: {
          OR: [
            { entityType: "BookingRequest", entityId: bookingRequestId },
            { entityType: "Offer", entityId: selected.id },
            { entityType: "Worker", entityId: selected.workerId },
          ],
        },
        orderBy: { createdAt: "asc" },
      }),
      app.db.memoryEdge.count({ where: { sourceRefType: "Offer", sourceRefId: selected.id } }),
      app.db.memoryEpisode.count({ where: { sourceRefType: "Offer", sourceRefId: selected.id } }),
      app.db.booking.findUnique({ where: { bookingRequestId } }).catch(() => null),
    ]);

    details.auditEvents = jsonSafe(auditEvents);
    details.counts = { ...details.counts, memoryEdges, memoryEpisodes: episodes };

    const actions = new Set(auditEvents.map((event) => event.action));
    assert(actions.has("intake.parse"), `loop ${index}: missing intake.parse audit`);
    assert(actions.has("ranking.complete"), `loop ${index}: missing ranking.complete audit`);
    assert(actions.has("offers.broadcast"), `loop ${index}: missing offers.broadcast audit`);
    assert(actions.has("memory.edge.update"), `loop ${index}: missing memory.edge.update audit`);
    assert(memoryEdges >= 1, `loop ${index}: offer outcome did not create memory edges`);
    assert(episodes >= 1, `loop ${index}: offer outcome did not create memory episodes`);
    if (outcome === "accepted") {
      assert(actions.has("booking.create"), `loop ${index}: missing booking.create audit`);
      assert(booking, `loop ${index}: accepted offer did not create booking`);
    } else {
      assert(actions.has("offer.decline"), `loop ${index}: missing offer.decline audit`);
    }

    const privateInfluence = await app.db.auditEvent.count({
      where: {
        action: "memory.influence",
        entityType: "BookingRequest",
        entityId: bookingRequestId,
        outputs: {
          path: ["audience"],
          equals: "employer",
        },
        inputs: {
          path: ["metadata", "visibility"],
          equals: "private",
        },
      },
    }).catch(() => 0);

    details.counts.privateInfluence = privateInfluence;
    assert(privateInfluence === 0, `loop ${index}: employer-facing private memory influence detected`);

    return {
      index,
      avatarMode,
      organisationId: generated.organisationId,
      bookingRequestId,
      selectedWorkerId: selected.workerId,
      offerId: selected.id,
      outcome,
      offerCount: pendingOffers.length,
      auditEvents: auditEvents.length,
      memoryEdges,
      memoryEpisodes: episodes,
      rawInput: generated.rawInput,
    };
  } catch (err) {
    details.error = serializeError(err);
    await attachLoopDiagnostics(app, details);
    throw new SandboxLoopError(`Generated sandbox loop ${index} failed.`, details, err);
  }
}

async function runGeneratedLoops(app, loops, seed, avatarMode) {
  const rng = mulberry32(seed);
  const results = [];
  for (let index = 0; index < loops; index++) {
    const result = await runGeneratedLoop(app, rng, index, avatarMode);
    results.push(result);
    console.log(
      `[sandbox] loop ${index + 1}/${loops}: ${result.outcome} offer ${result.offerId} for ${result.bookingRequestId}`,
    );
  }
  return results;
}

async function gitMetadata() {
  const git = process.platform === "win32" ? "git.exe" : "git";
  const [commit, status] = await Promise.all([
    runCapture(git, ["rev-parse", "--short", "HEAD"]),
    runCapture(git, ["status", "--short"]),
  ]);
  return {
    commit: commit || null,
    dirty: status.length > 0,
    status: status ? status.split(/\r?\n/) : [],
  };
}

async function collectTotals(app) {
  if (!app) return null;
  try {
    const [auditEvents, bookingRequests, offers, bookings, memoryEdges, memoryEpisodes] = await Promise.all([
      app.db.auditEvent.count(),
      app.db.bookingRequest.count(),
      app.db.offer.count(),
      app.db.booking.count(),
      app.db.memoryEdge.count(),
      app.db.memoryEpisode.count(),
    ]);
    return { auditEvents, bookingRequests, offers, bookings, memoryEdges, memoryEpisodes };
  } catch (err) {
    return { error: serializeError(err) };
  }
}

function ensureAiEnvForStartup(loops) {
  const provider = process.env.AI_PROVIDER ?? "anthropic";
  const keyName = provider === "google" ? "GOOGLE_API_KEY" : "ANTHROPIC_API_KEY";
  if (!process.env[keyName]) {
    if (loops > 0) {
      throw new Error(`${keyName} is required for generated V intake loops. Use --loops 0 to run only baseline coverage.`);
    }
    process.env[keyName] = "sandbox-regression-no-live-llm";
  }
}

async function main() {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));
  ensureAiEnvForStartup(args.loops);

  const baseUrl = process.env.SANDBOX_BASE_DATABASE_URL ?? process.env.DATABASE_URL ?? DEFAULT_BASE_URL;
  const databaseName = `viora_sandbox_${Math.abs(Math.trunc(args.seed))}_${process.pid}`.toLowerCase();
  const databaseUrl = targetDatabaseUrl(baseUrl, databaseName);
  const startedAt = new Date().toISOString();
  const metadata = await gitMetadata();
  const cleanup = {
    appClosed: false,
    databaseDropped: false,
    databaseKept: false,
    dropError: null,
  };

  console.log(`[sandbox] creating ephemeral database ${databaseName}`);
  let databaseCreated = false;

  const env = {
    DATABASE_URL: databaseUrl,
    AI_PROVIDER: process.env.AI_PROVIDER ?? "anthropic",
  };
  if (process.env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (process.env.GOOGLE_API_KEY) env.GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

  let app;
  let generatedLoops = [];
  let report = null;
  let pendingError = null;
  try {
    await createDatabase(baseUrl, databaseName);
    databaseCreated = true;

    console.log("[sandbox] applying migrations");
    await run(bin("prisma"), ["migrate", "deploy", "--schema", PRISMA_SCHEMA], env);

    console.log("[sandbox] seeding demo avatars");
    await run(bin("tsx"), [resolve(ROOT, "packages/database/prisma/seed.ts")], env);

    if (!args.skipBaseline) {
      console.log("[sandbox] running baseline Phase 0 smoke scenarios");
      await run(bin("tsx"), [BASELINE_SCRIPT], env);
    }

    process.env.DATABASE_URL = databaseUrl;
    const { buildServer } = await import("../apps/api/src/index.ts");
    app = await buildServer();
    await app.ready();

    if (args.loops > 0) {
      console.log(`[sandbox] running ${args.loops} generated employer/V/worker loops`);
      generatedLoops = await runGeneratedLoops(app, args.loops, args.seed, args.avatarMode);
    }

    report = {
      status: "passed",
      startedAt,
      completedAt: new Date().toISOString(),
      git: metadata,
      database: args.keepDb ? databaseName : null,
      seed: args.seed,
      avatarMode: args.avatarMode,
      baseline: { skipped: args.skipBaseline },
      generatedLoops,
      totals: await collectTotals(app),
    };
  } catch (err) {
    pendingError = err;
    report = {
      status: "failed",
      startedAt,
      completedAt: new Date().toISOString(),
      git: metadata,
      database: args.keepDb ? databaseName : null,
      seed: args.seed,
      avatarMode: args.avatarMode,
      baseline: { skipped: args.skipBaseline },
      generatedLoops,
      failure: err instanceof SandboxLoopError
        ? { error: serializeError(err), loop: err.details }
        : { error: serializeError(err) },
      totals: await collectTotals(app),
    };
  } finally {
    if (app) {
      await app.close().catch((err) => {
        cleanup.appCloseError = serializeError(err);
      });
      await app.db.$disconnect().catch((err) => {
        cleanup.dbDisconnectError = serializeError(err);
      });
      cleanup.appClosed = true;
    }
    if (args.keepDb) {
      console.log(`[sandbox] kept database ${databaseName}`);
      cleanup.databaseKept = true;
    } else {
      console.log(`[sandbox] dropping ephemeral database ${databaseName}`);
      if (databaseCreated) {
        await dropDatabase(baseUrl, databaseName)
          .then(() => {
            cleanup.databaseDropped = true;
          })
          .catch((err) => {
            cleanup.dropError = serializeError(err);
            console.error(`[sandbox] failed to drop ${databaseName}:`, err);
          });
      }
    }

    if (report) {
      report.cleanup = cleanup;
      if (report.status === "failed") {
        const reportPath = args.report ?? defaultFailureReportPath(args.seed);
        const written = writeJsonReport(reportPath, report);
        console.error(`[sandbox] failure report written to ${written}`);
      } else if (args.report) {
        writeJsonReport(args.report, report);
      }
      console.log(JSON.stringify(report, null, 2));
    }
  }

  if (pendingError) throw pendingError;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
