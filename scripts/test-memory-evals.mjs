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

const RUN_LLM_EXTRACTION = process.env.MEMORY_EVAL_RUN_LLM === "1";
if (!RUN_LLM_EXTRACTION) {
  const provider = process.env.AI_PROVIDER ?? "anthropic";
  if (provider === "google" && !process.env.GOOGLE_API_KEY) {
    process.env.GOOGLE_API_KEY = "memory-eval-no-llm";
  }
  if (provider !== "google" && !process.env.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = "memory-eval-no-llm";
  }
}

const fixturePath = resolve(process.cwd(), "scripts/fixtures/memory-evals.json");
const fixtures = JSON.parse(readFileSync(fixturePath, "utf8"));
const runId = `memory-eval-${Date.now()}`;
const roleType = `${runId}-role`;

const MEMORY_KINDS = new Set([
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
const MEMORY_VISIBILITIES = new Set(["private", "operational", "shared"]);
const MEMORY_SCOPES = new Set([
  "profile",
  "intake_default",
  "ranking_signal",
  "briefing",
  "explanation",
  "connector_export",
]);

function log(message) {
  console.log(`[ok] ${message}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function injectJson(app, path) {
  const res = await app.inject({ method: "GET", url: path });
  assert(res.statusCode >= 200 && res.statusCode < 300, `${path} failed (${res.statusCode}): ${res.body}`);
  return JSON.parse(res.body);
}

function id(suffix) {
  return `${runId}-${suffix}`;
}

function validateExtractionFixtures() {
  assert(Array.isArray(fixtures.extractionCases), "Fixture file must include extractionCases.");
  for (const testCase of fixtures.extractionCases) {
    assert(typeof testCase.name === "string" && testCase.name, "Extraction case is missing a name.");
    assert(["organisation", "worker"].includes(testCase.ownerType), `${testCase.name}: invalid ownerType.`);
    assert(typeof testCase.event === "string" && testCase.event.length > 0, `${testCase.name}: missing event.`);
    const candidates = testCase.expected?.candidates;
    assert(Array.isArray(candidates) && candidates.length > 0, `${testCase.name}: missing expected candidates.`);
    for (const candidate of candidates) {
      assert(MEMORY_KINDS.has(candidate.kind), `${testCase.name}: invalid expected kind ${candidate.kind}.`);
      assert(
        MEMORY_VISIBILITIES.has(candidate.visibility),
        `${testCase.name}: invalid expected visibility ${candidate.visibility}.`,
      );
      assert(
        Array.isArray(candidate.useScopes) && candidate.useScopes.every((scope) => MEMORY_SCOPES.has(scope)),
        `${testCase.name}: invalid expected useScopes.`,
      );
      assert(
        Array.isArray(candidate.contentIncludes) && candidate.contentIncludes.length > 0,
        `${testCase.name}: contentIncludes must be non-empty.`,
      );
    }
  }
}

async function cleanup(prisma) {
  const passports = await prisma.passport.findMany({
    where: { workerId: { startsWith: runId } },
    select: { id: true },
  });
  const passportIds = passports.map((passport) => passport.id);

  await prisma.auditEvent.deleteMany({ where: { entityId: { startsWith: runId } } });
  await prisma.offer.deleteMany({ where: { bookingRequestId: { startsWith: runId } } });
  await prisma.match.deleteMany({ where: { bookingRequestId: { startsWith: runId } } });
  await prisma.bookingRequest.deleteMany({ where: { id: { startsWith: runId } } });
  await prisma.memoryEdge.deleteMany({
    where: {
      OR: [
        { id: { startsWith: runId } },
        { ownerId: { startsWith: runId } },
        { fromId: { startsWith: runId } },
        { toId: { startsWith: runId } },
        { sourceRefId: { startsWith: runId } },
      ],
    },
  });
  await prisma.memoryEntry.deleteMany({
    where: {
      OR: [
        { id: { startsWith: runId } },
        { ownerId: { startsWith: runId } },
        { subjectId: { startsWith: runId } },
        { sourceRefId: { startsWith: runId } },
        { key: { startsWith: runId } },
      ],
    },
  });
  if (passportIds.length > 0) {
    await prisma.complianceDocument.deleteMany({ where: { passportId: { in: passportIds } } });
  }
  await prisma.passport.deleteMany({ where: { workerId: { startsWith: runId } } });
  await prisma.guardrailPolicy.deleteMany({
    where: {
      OR: [
        { organisationId: { startsWith: runId } },
        { workerId: { startsWith: runId } },
      ],
    },
  });
  await prisma.worker.deleteMany({ where: { id: { startsWith: runId } } });
  await prisma.site.deleteMany({ where: { organisationId: { startsWith: runId } } });
  await prisma.employerUser.deleteMany({ where: { organisationId: { startsWith: runId } } });
  await prisma.organisation.deleteMany({ where: { id: { startsWith: runId } } });
}

async function createWorker(prisma, input) {
  const worker = await prisma.worker.create({
    data: {
      id: input.id,
      firstName: input.firstName,
      lastName: "MemoryEval",
      email: `${input.id}@example.test`,
      homeLatitude: 51.501,
      homeLongitude: -0.121,
      workRadiusKm: 25,
      roleTypes: [roleType],
    },
  });
  const passport = await prisma.passport.create({
    data: {
      workerId: worker.id,
      identityVerified: true,
      rightToWorkStatus: "verified",
      dbsStatus: input.dbsStatus,
      safeguardingStatus: "verified",
      sectorEligibility: input.dbsStatus === "verified" ? ["education"] : [],
      reliabilityScore: input.reliabilityScore,
    },
  });
  await prisma.complianceDocument.createMany({
    data: [
      { passportId: passport.id, documentType: "references", status: "verified" },
      { passportId: passport.id, documentType: "prohibition_check", status: "verified" },
    ],
  });
  return worker;
}

async function seedEvalData(prisma) {
  const refs = {
    organisation: id("org"),
    site: id("site"),
    bookingRequest: id("booking-request"),
    workers: {
      eligible_preferred: id("worker-eligible-preferred"),
      eligible_baseline: id("worker-eligible-baseline"),
      ineligible_strong_memory: id("worker-ineligible-strong-memory"),
    },
    memories: {},
    edges: {},
  };

  await prisma.organisation.create({
    data: {
      id: refs.organisation,
      name: "Memory Eval Organisation",
      sector: "education",
      type: "school",
    },
  });
  await prisma.site.create({
    data: {
      id: refs.site,
      organisationId: refs.organisation,
      name: "Memory Eval Site",
      address: "1 Eval Street, London",
      latitude: 51.5,
      longitude: -0.12,
    },
  });
  await prisma.guardrailPolicy.create({
    data: {
      organisationId: refs.organisation,
      autonomyLevel: "L2",
      budgetCeiling: 200,
      approvedRoleTypes: [roleType],
      workerWhitelist: [],
      workerBlocklist: [],
      escalationContacts: [],
    },
  });

  await createWorker(prisma, {
    id: refs.workers.eligible_preferred,
    firstName: "EligiblePreferred",
    dbsStatus: "verified",
    reliabilityScore: 0.62,
  });
  await createWorker(prisma, {
    id: refs.workers.eligible_baseline,
    firstName: "EligibleBaseline",
    dbsStatus: "verified",
    reliabilityScore: 0.76,
  });
  await createWorker(prisma, {
    id: refs.workers.ineligible_strong_memory,
    firstName: "IneligibleStrongMemory",
    dbsStatus: "pending",
    reliabilityScore: 0.99,
  });

  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const end = new Date(tomorrow.getTime() + 7 * 60 * 60 * 1000);
  await prisma.bookingRequest.create({
    data: {
      id: refs.bookingRequest,
      organisationId: refs.organisation,
      siteId: refs.site,
      status: "confirmed",
      roleType,
      startAt: tomorrow,
      endAt: end,
      rateMode: "standard",
      payRate: 150,
      rawIntent: "Memory eval booking request",
      channel: "web",
      broadcastStrategy: "simultaneous_top_n",
    },
  });

  const memorySeeds = [
    {
      ref: "org_active_instruction",
      ownerType: "organisation",
      ownerId: refs.organisation,
      subjectType: "site",
      subjectId: refs.site,
      kind: "instruction",
      title: "Use reception sign-in note",
      content: "Tell workers to sign in at reception and collect behaviour notes.",
      visibility: "operational",
      useScopes: ["intake_default", "briefing", "explanation"],
      expiresAt: null,
    },
    {
      ref: "org_expired_instruction",
      ownerType: "organisation",
      ownerId: refs.organisation,
      subjectType: "site",
      subjectId: refs.site,
      kind: "instruction",
      title: "Expired gate code",
      content: "Old gate code should not be used.",
      visibility: "operational",
      useScopes: ["intake_default"],
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    },
    {
      ref: "org_wrong_scope_note",
      ownerType: "organisation",
      ownerId: refs.organisation,
      subjectType: "site",
      subjectId: refs.site,
      kind: "briefing_note",
      title: "Briefing-only playground note",
      content: "This note is not an intake default.",
      visibility: "operational",
      useScopes: ["briefing"],
      expiresAt: null,
    },
    {
      ref: "worker_operational_fit",
      ownerType: "worker",
      ownerId: refs.workers.eligible_preferred,
      subjectType: "worker",
      subjectId: refs.workers.eligible_preferred,
      kind: "fit_signal",
      title: "Strong repeat fit",
      content: "Worker has a strong repeat fit for this site.",
      visibility: "operational",
      useScopes: ["ranking_signal", "explanation"],
      expiresAt: null,
    },
    {
      ref: "worker_private_preference",
      ownerType: "worker",
      ownerId: refs.workers.eligible_preferred,
      subjectType: "worker",
      subjectId: refs.workers.eligible_preferred,
      kind: "preference",
      title: "Private commute preference",
      content: "Private worker-only commute preference.",
      visibility: "private",
      useScopes: ["profile", "ranking_signal"],
      expiresAt: null,
    },
    {
      ref: "worker_profile_only_preference",
      ownerType: "worker",
      ownerId: refs.workers.eligible_preferred,
      subjectType: "worker",
      subjectId: refs.workers.eligible_preferred,
      kind: "preference",
      title: "Profile-only note",
      content: "Profile-only worker note should not rank.",
      visibility: "operational",
      useScopes: ["profile"],
      expiresAt: null,
    },
    {
      ref: "worker_expired_fit",
      ownerType: "worker",
      ownerId: refs.workers.eligible_preferred,
      subjectType: "worker",
      subjectId: refs.workers.eligible_preferred,
      kind: "fit_signal",
      title: "Expired fit note",
      content: "Expired fit signal should not rank.",
      visibility: "operational",
      useScopes: ["ranking_signal"],
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    },
  ];

  for (const seed of memorySeeds) {
    const memoryId = id(`memory-${seed.ref}`);
    refs.memories[seed.ref] = memoryId;
    await prisma.memoryEntry.create({
      data: {
        id: memoryId,
        ownerType: seed.ownerType,
        ownerId: seed.ownerId,
        subjectType: seed.subjectType,
        subjectId: seed.subjectId,
        kind: seed.kind,
        key: `${runId}_${seed.ref}`,
        title: seed.title,
        content: seed.content,
        value: { evalRef: seed.ref },
        sourceType: "system_event",
        sourceRefType: "MemoryEval",
        sourceRefId: runId,
        visibility: seed.visibility,
        status: "active",
        useScopes: seed.useScopes,
        sensitivity: seed.visibility === "private" ? "sensitive" : "standard",
        sourceLabel: "Memory eval fixture",
        expiresAt: seed.expiresAt,
        confidence: 0.9,
        confirmedAt: new Date(),
        confirmedBy: "memory-eval",
      },
    });
  }

  const edgeSeeds = [
    {
      ref: "eligible_preferred_site_fit",
      ownerId: refs.workers.eligible_preferred,
      fromId: refs.workers.eligible_preferred,
      toId: refs.site,
      weight: 1,
      confidence: 1,
      label: "Eligible worker has strong site fit.",
    },
    {
      ref: "ineligible_strong_site_fit",
      ownerId: refs.workers.ineligible_strong_memory,
      fromId: refs.workers.ineligible_strong_memory,
      toId: refs.site,
      weight: 1,
      confidence: 1,
      label: "Ineligible worker has strong site fit.",
    },
  ];
  for (const seed of edgeSeeds) {
    const edgeId = id(`edge-${seed.ref}`);
    refs.edges[seed.ref] = edgeId;
    await prisma.memoryEdge.create({
      data: {
        id: edgeId,
        ownerType: "worker",
        ownerId: seed.ownerId,
        fromType: "worker",
        fromId: seed.fromId,
        toType: "site",
        toId: seed.toId,
        kind: "fit_signal",
        label: seed.label,
        weight: seed.weight,
        confidence: seed.confidence,
        evidenceCount: 3,
        sourceType: "system_event",
        sourceRefType: "MemoryEval",
        sourceRefId: runId,
        visibility: "operational",
        status: "active",
      },
    });
  }

  return refs;
}

function assertRefsPresent(actualIds, expectedRefs, refMap, testName) {
  for (const ref of expectedRefs ?? []) {
    assert(actualIds.includes(refMap[ref]), `${testName}: expected ${ref} to be present.`);
  }
}

function assertRefsAbsent(actualIds, excludedRefs, refMap, testName) {
  for (const ref of excludedRefs ?? []) {
    assert(!actualIds.includes(refMap[ref]), `${testName}: expected ${ref} to be absent.`);
  }
}

async function runRetrievalEvals(app, refs) {
  for (const testCase of fixtures.retrievalCases ?? []) {
    if (testCase.context === "organisation") {
      const context = await app.agents.memory.getOrganisationContext(refs.organisation, {
        purpose: testCase.purpose,
        audience: testCase.audience,
        siteId: refs.site,
      });
      const actualIds = context.entries.map((memory) => memory.id);
      assertRefsPresent(actualIds, testCase.expectedMemoryRefs, refs.memories, testCase.name);
      assertRefsAbsent(actualIds, testCase.excludedMemoryRefs, refs.memories, testCase.name);
      assert(
        context.audit.purpose === testCase.purpose && context.audit.audience === testCase.audience,
        `${testCase.name}: context audit purpose/audience mismatch.`,
      );
    } else if (testCase.context === "workerRanking") {
      const context = await app.agents.memory.getWorkerRankingContext(Object.values(refs.workers), {
        siteId: refs.site,
        roleType,
      });
      const actualIds = context.entries.map((memory) => memory.id);
      assertRefsPresent(actualIds, testCase.expectedMemoryRefs, refs.memories, testCase.name);
      assertRefsAbsent(actualIds, testCase.excludedMemoryRefs, refs.memories, testCase.name);
      assert(
        context.audit.purpose === "ranking_signal" && context.audit.audience === "employer",
        `${testCase.name}: ranking context audit purpose/audience mismatch.`,
      );
    } else {
      throw new Error(`${testCase.name}: unsupported retrieval context ${testCase.context}.`);
    }
    log(testCase.name);
  }
}

async function runRankingEvals(app, prisma, refs) {
  const result = await app.agents.market.rankCandidates(refs.bookingRequest);
  assert(result.success, `ranking failed: ${result.explanation}`);

  const rankedWorkerIds = (result.data ?? []).map((match) => match.workerId);
  const boundaryCase = fixtures.complianceBoundaryCases?.[0];
  assert(
    rankedWorkerIds.includes(refs.workers[boundaryCase.expectedIncludedWorkerRef]),
    `${boundaryCase.name}: expected eligible worker to be ranked.`,
  );
  assert(
    !rankedWorkerIds.includes(refs.workers[boundaryCase.expectedExcludedWorkerRef]),
    `${boundaryCase.name}: ineligible worker was ranked despite compliance failure.`,
  );
  assert(
    rankedWorkerIds[0] === refs.workers.eligible_preferred,
    `${boundaryCase.name}: memory-supported eligible worker was not ranked first.`,
  );
  log(boundaryCase.name);

  const influenceCase = fixtures.influenceCases?.[0];
  const influence = await prisma.auditEvent.findFirst({
    where: {
      action: "memory.influence",
      entityType: influenceCase.entityType,
      entityId: refs.bookingRequest,
    },
    orderBy: { createdAt: "desc" },
  });
  assert(influence, `${influenceCase.name}: memory.influence audit row was not written.`);
  assert(influence.outcome === influenceCase.expectedOutcome, `${influenceCase.name}: unexpected audit outcome.`);
  assert(influence.inputs?.action === influenceCase.action, `${influenceCase.name}: unexpected influenced action.`);
  assertRefsPresent(
    influence.inputs?.memoryIds ?? [],
    influenceCase.expectedMemoryRefs,
    refs.memories,
    influenceCase.name,
  );
  assertRefsPresent(
    influence.inputs?.edgeIds ?? [],
    influenceCase.expectedEdgeRefs,
    refs.edges,
    influenceCase.name,
  );
  log(influenceCase.name);
}

function countFor(counts, key) {
  return counts.find((count) => count.key === key)?.count ?? 0;
}

async function runAnalyticsEvals(app, prisma, refs) {
  const analyticsCase = fixtures.analyticsCases?.[0];
  await prisma.offer.createMany({
    data: [
      {
        id: id("offer-accepted"),
        bookingRequestId: refs.bookingRequest,
        workerId: refs.workers.eligible_preferred,
        status: "accepted",
        payRate: 150,
        fitExplanation: "Accepted memory eval offer.",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
      {
        id: id("offer-declined"),
        bookingRequestId: refs.bookingRequest,
        workerId: refs.workers.eligible_baseline,
        status: "declined",
        payRate: 150,
        fitExplanation: "Declined memory eval offer.",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    ],
  });

  const impact = await injectJson(app, "/v1/admin/ops/memory-impact");
  assert(impact.influence.total30d >= 1, `${analyticsCase.name}: expected at least one influence event.`);
  assert(
    countFor(impact.influence.byAction30d, analyticsCase.expectedAction) >= 1,
    `${analyticsCase.name}: expected ${analyticsCase.expectedAction} in action counts.`,
  );
  assert(
    countFor(impact.influence.byPurpose30d, analyticsCase.expectedPurpose) >= 1,
    `${analyticsCase.name}: expected ${analyticsCase.expectedPurpose} in purpose counts.`,
  );
  assert(
    impact.ranking.acceptedOffers30d >= analyticsCase.expectedAcceptedOffers,
    `${analyticsCase.name}: accepted influenced offers were not counted.`,
  );
  assert(
    impact.ranking.resolvedOffers30d >= analyticsCase.expectedResolvedOffers,
    `${analyticsCase.name}: resolved influenced offers were not counted.`,
  );
  assert(
    impact.privacy.employerFacingPrivateInfluenceCount30d === analyticsCase.expectedPrivateBoundaryHits,
    `${analyticsCase.name}: private worker memory appeared in employer-facing influence.`,
  );
  assert(
    impact.memoryUsage.unusedActiveMemoriesByKind.length > 0,
    `${analyticsCase.name}: unused active memory kind summary was empty.`,
  );
  log(analyticsCase.name);
}

async function runOptionalExtractionEvals(app, refs) {
  if (!RUN_LLM_EXTRACTION) {
    log("extraction fixture shape validated (set MEMORY_EVAL_RUN_LLM=1 for live LLM extraction)");
    return;
  }

  for (const testCase of fixtures.extractionCases) {
    const ownerId = testCase.ownerType === "worker" ? refs.workers.eligible_preferred : refs.organisation;
    const subjectId = testCase.subjectType === "site" ? refs.site : ownerId;
    const result = await app.agents.memory.rememberFromEvent({
      ownerType: testCase.ownerType,
      ownerId,
      subjectType: testCase.subjectType,
      subjectId,
      sourceRefType: "MemoryEval",
      sourceRefId: `${runId}-${testCase.name}`,
      text: testCase.event,
      data: { evalCase: testCase.name },
    });
    assert(result.success, `${testCase.name}: live extraction failed: ${result.explanation}`);

    for (const expected of testCase.expected.candidates) {
      const match = (result.data ?? []).find((memory) => {
        const haystack = `${memory.title} ${memory.content}`.toLowerCase();
        return (
          memory.kind === expected.kind &&
          memory.visibility === expected.visibility &&
          expected.contentIncludes.some((term) => haystack.includes(term.toLowerCase()))
        );
      });
      assert(match, `${testCase.name}: no extracted memory matched expected ${expected.kind}.`);
    }
    log(`${testCase.name} live extraction`);
  }
}

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
let app = null;

try {
  validateExtractionFixtures();
  log("fixture catalog loaded");

  const { buildServer } = await import("../apps/api/src/index.ts");
  app = await buildServer();
  await app.ready();
  log("API ready in-process");

  const refs = await seedEvalData(prisma);
  log("isolated eval data seeded");

  await runRetrievalEvals(app, refs);
  await runRankingEvals(app, prisma, refs);
  await runAnalyticsEvals(app, prisma, refs);
  await runOptionalExtractionEvals(app, refs);

  console.log("\nViora Memory evals passed.");
} finally {
  if (app) await app.close();
  await cleanup(prisma).catch((err) => {
    console.warn(`[warn] memory eval cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
  });
  await prisma.$disconnect();
}
