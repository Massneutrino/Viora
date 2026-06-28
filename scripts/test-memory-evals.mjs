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

async function validateTypedValueFixtures() {
  const {
    cpdTrainingSignalTypes,
    isCpdTrainingSignalRankingEligible,
    validateMemoryValue,
    memoryValueTypes,
  } = await import("@viora/domain");
  const knownTypes = new Set(memoryValueTypes());
  const coveredCpdSignalTypes = new Set();
  assert(Array.isArray(fixtures.typedValueCases), "Fixture file must include typedValueCases.");
  for (const testCase of fixtures.typedValueCases) {
    assert(typeof testCase.name === "string" && testCase.name, "Typed value case is missing a name.");
    assert(MEMORY_KINDS.has(testCase.kind), `${testCase.name}: invalid kind ${testCase.kind}.`);
    assert(testCase.value && typeof testCase.value === "object", `${testCase.name}: value must be an object.`);
    assert(knownTypes.has(testCase.value.valueType), `${testCase.name}: unknown valueType.`);
    const result = validateMemoryValue(testCase.kind, testCase.value);
    assert(
      result.ok === testCase.valid,
      `${testCase.name}: expected valid=${testCase.valid}, got errors: ${result.errors.join("; ")}`,
    );
    if (testCase.valid && testCase.value.valueType === "cpd_training_signal") {
      coveredCpdSignalTypes.add(testCase.value.signalType);
      const rankingEligible = isCpdTrainingSignalRankingEligible(testCase.value);
      assert(
        rankingEligible === ["completed_cpd", "training_impact_evidence"].includes(testCase.value.signalType),
        `${testCase.name}: unexpected CPD ranking eligibility.`,
      );
    }
  }
  for (const signalType of cpdTrainingSignalTypes()) {
    assert(coveredCpdSignalTypes.has(signalType), `Missing typed CPD fixture for ${signalType}.`);
  }
}

async function validateTemporalScoringFixtures() {
  const { scoreTemporalMemoryEdges } = await import("@viora/domain");
  assert(Array.isArray(fixtures.temporalScoringCases), "Fixture file must include temporalScoringCases.");
  const now = new Date("2026-06-27T12:00:00.000Z");
  for (const testCase of fixtures.temporalScoringCases) {
    const edges = testCase.edges.map((edge) => ({
      id: edge.id,
      ownerId: edge.ownerId ?? "worker-temporal",
      weight: edge.weight,
      confidence: edge.confidence,
      evidenceCount: edge.evidenceCount,
      status: edge.status ?? "active",
      visibility: edge.visibility ?? "operational",
      validFrom: new Date(edge.validFrom ?? "2026-01-01T00:00:00.000Z"),
      validUntil: edge.validUntil ? new Date(edge.validUntil) : null,
      lastEvidenceAt: edge.lastEvidenceAt ? new Date(edge.lastEvidenceAt) : null,
      decayPolicy: edge.decayPolicy ?? "none",
      supersededByEdgeId: edge.supersededByEdgeId ?? null,
    }));
    const result = scoreTemporalMemoryEdges(edges, now);
    for (const expected of testCase.expectedIncluded ?? []) {
      const actual = result.included.find((score) => score.edgeId === expected.id);
      assert(actual, `${testCase.name}: expected ${expected.id} to be included.`);
      if (expected.minScore !== undefined) {
        assert(actual.score >= expected.minScore, `${testCase.name}: ${expected.id} score too low.`);
      }
      if (expected.maxScore !== undefined) {
        assert(actual.score <= expected.maxScore, `${testCase.name}: ${expected.id} score too high.`);
      }
    }
    for (const expected of testCase.expectedExcluded ?? []) {
      const actual = result.excluded.find((exclusion) => exclusion.edgeId === expected.id);
      assert(actual, `${testCase.name}: expected ${expected.id} to be excluded.`);
      assert(actual.reason === expected.reason, `${testCase.name}: ${expected.id} excluded for ${actual.reason}.`);
    }
    log(testCase.name);
  }
}

async function runTypedValueRouteEvals(app, refs) {
  const validCase = fixtures.typedValueCases.find((testCase) => testCase.name === "site_instruction_value");
  assert(validCase, "Missing site_instruction_value typed value case.");
  const createRes = await app.inject({
    method: "POST",
    url: `/v1/organisations/${refs.organisation}/memory`,
    payload: {
      subjectType: "site",
      subjectId: refs.site,
      kind: validCase.kind,
      title: "Typed site instruction",
      content: "Sign in at reception before registration.",
      value: validCase.value,
      visibility: "operational",
      useScopes: ["intake_default", "briefing", "explanation"],
      actorId: "memory-eval",
    },
  });
  assert(createRes.statusCode === 201, `typed memory create failed (${createRes.statusCode}): ${createRes.body}`);
  const created = JSON.parse(createRes.body).memory;
  assert(created.value.valueType === "site_instruction", "typed memory create did not persist valueType.");

  const invalidCase = fixtures.typedValueCases.find((testCase) => testCase.name === "invalid_pay_missing_rate_unit");
  assert(invalidCase, "Missing invalid_pay_missing_rate_unit typed value case.");
  const invalidRes = await app.inject({
    method: "POST",
    url: `/v1/workers/${refs.workers.eligible_preferred}/memory`,
    payload: {
      kind: invalidCase.kind,
      title: "Invalid pay expectation",
      content: "This should fail typed value validation.",
      value: invalidCase.value,
      actorId: "memory-eval",
    },
  });
  assert(
    invalidRes.statusCode >= 400 && invalidRes.statusCode < 500,
    `invalid typed memory create unexpectedly succeeded (${invalidRes.statusCode}).`,
  );
  log("typed memory value route validation");
}

async function runMemoryControlsEvals(app, refs) {
  const privateRes = await app.inject({
    method: "POST",
    url: `/v1/workers/${refs.workers.eligible_preferred}/memory`,
    payload: {
      kind: "preference",
      title: "Private control memory",
      content: "Worker-only control memory for UI governance tests.",
      visibility: "private",
      actorId: "memory-eval",
    },
  });
  assert(privateRes.statusCode === 201, `private memory create failed (${privateRes.statusCode}): ${privateRes.body}`);
  const privateMemory = JSON.parse(privateRes.body).memory;

  const workerPrivateList = await injectJson(
    app,
    `/v1/workers/${refs.workers.eligible_preferred}/memory?visibility=private&search=control`,
  );
  assert(
    workerPrivateList.memories.some((memory) => memory.id === privateMemory.id),
    "Worker memory controls did not list own private memory with filters.",
  );

  const orgMemoryList = await injectJson(app, `/v1/organisations/${refs.organisation}/memory?search=control`);
  assert(
    !orgMemoryList.memories.some((memory) => memory.id === privateMemory.id),
    "Employer memory controls listed worker-private memory.",
  );

  const promotedRes = await app.inject({
    method: "PATCH",
    url: `/v1/workers/${refs.workers.eligible_preferred}/memory/${privateMemory.id}`,
    payload: {
      visibility: "operational",
      status: "active",
      useScopes: ["profile", "ranking_signal", "briefing", "explanation"],
      actorId: "memory-eval",
    },
  });
  assert(promotedRes.statusCode === 200, `memory promotion failed (${promotedRes.statusCode}): ${promotedRes.body}`);

  const promotedList = await injectJson(
    app,
    `/v1/workers/${refs.workers.eligible_preferred}/memory?visibility=operational&scope=ranking_signal&search=control`,
  );
  assert(
    promotedList.memories.some((memory) => memory.id === privateMemory.id),
    "Promoted operational memory was not visible to worker controls.",
  );

  const archivedRes = await app.inject({
    method: "PATCH",
    url: `/v1/workers/${refs.workers.eligible_preferred}/memory/${privateMemory.id}`,
    payload: { status: "archived", actorId: "memory-eval" },
  });
  assert(archivedRes.statusCode === 200, `memory archive failed (${archivedRes.statusCode}): ${archivedRes.body}`);

  const activeList = await injectJson(
    app,
    `/v1/workers/${refs.workers.eligible_preferred}/memory?scope=ranking_signal&search=control`,
  );
  assert(
    !activeList.memories.some((memory) => memory.id === privateMemory.id),
    "Archived memory still appeared in active memory controls list.",
  );

  log("memory controls filters and promotion/archive");
}

function runTypedValueSeedEvals(refs) {
  const typedRefs = [
    "org_active_instruction",
    "worker_operational_fit",
    "worker_private_preference",
  ];
  for (const ref of typedRefs) {
    assert(refs.memories[ref], `typed seed missing ${ref}.`);
  }
  log("typed memory value fixtures");
}

async function cleanup(prisma) {
  const passports = await prisma.passport.findMany({
    where: { workerId: { startsWith: runId } },
    select: { id: true },
  });
  const passportIds = passports.map((passport) => passport.id);

  await prisma.auditEvent.deleteMany({ where: { entityId: { startsWith: runId } } });
  await prisma.memoryReviewSuggestion.deleteMany({
    where: {
      OR: [
        { ownerId: { startsWith: runId } },
        { affectedMemoryIds: { has: id("memory-consolidation-stale") } },
      ],
    },
  });
  await prisma.memoryEpisode.deleteMany({
    where: {
      OR: [
        { ownerId: { startsWith: runId } },
        { subjectId: { startsWith: runId } },
        { sourceRefId: { startsWith: runId } },
        { entityId: { startsWith: runId } },
      ],
    },
  });
  await prisma.feedback.deleteMany({ where: { shift: { booking: { id: { startsWith: runId } } } } });
  await prisma.shift.deleteMany({ where: { booking: { id: { startsWith: runId } } } });
  await prisma.booking.deleteMany({ where: { id: { startsWith: runId } } });
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
      value: {
        valueType: "site_instruction",
        instruction: "Tell workers to sign in at reception and collect behaviour notes.",
        appliesTo: [roleType],
        priority: "high",
      },
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
      value: {
        valueType: "role_confidence",
        roleType,
        confidence: 0.9,
        evidence: "Strong repeat fit for this site.",
      },
    },
    {
      ref: "worker_completed_cpd",
      ownerType: "worker",
      ownerId: refs.workers.eligible_preferred,
      subjectType: "worker",
      subjectId: refs.workers.eligible_preferred,
      kind: "fit_signal",
      title: "Completed safeguarding CPD",
      content: "Worker completed Safeguarding Level 2 CPD.",
      visibility: "operational",
      useScopes: ["ranking_signal", "briefing", "explanation"],
      expiresAt: null,
      value: {
        valueType: "cpd_training_signal",
        signalType: "completed_cpd",
        trainingName: "Safeguarding Level 2",
        status: "completed",
        roleTypes: [roleType],
        sector: "education",
        provider: "Viora Academy",
        completedAt: "2026-06-01T00:00:00.000Z",
      },
    },
    {
      ref: "worker_private_cpd_gap",
      ownerType: "worker",
      ownerId: refs.workers.eligible_preferred,
      subjectType: "worker",
      subjectId: refs.workers.eligible_preferred,
      kind: "preference",
      title: "Private CPD confidence gap",
      content: "Worker privately wants support with KS2 behaviour confidence.",
      visibility: "private",
      useScopes: ["profile", "briefing", "explanation"],
      expiresAt: null,
      value: {
        valueType: "cpd_training_signal",
        signalType: "confidence_gap",
        trainingName: "KS2 behaviour support",
        status: "recommended",
        roleTypes: [roleType],
        sector: "education",
      },
    },
    {
      ref: "ineligible_completed_cpd",
      ownerType: "worker",
      ownerId: refs.workers.ineligible_strong_memory,
      subjectType: "worker",
      subjectId: refs.workers.ineligible_strong_memory,
      kind: "fit_signal",
      title: "Ineligible worker completed CPD",
      content: "Ineligible worker has a strong completed CPD memory but must still fail compliance.",
      visibility: "operational",
      useScopes: ["ranking_signal", "explanation"],
      expiresAt: null,
      value: {
        valueType: "cpd_training_signal",
        signalType: "completed_cpd",
        trainingName: "Safeguarding Level 2",
        status: "completed",
        roleTypes: [roleType],
        sector: "education",
        completedAt: "2026-06-01T00:00:00.000Z",
      },
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
      useScopes: ["profile", "ranking_signal", "explanation"],
      expiresAt: null,
      value: {
        valueType: "commute_preference",
        maxMinutes: 35,
        exception: "Worker-only private preference.",
      },
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
        value: { evalRef: seed.ref, ...(seed.value ?? {}) },
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
      lastEvidenceAt: new Date(),
      decayPolicy: "linear_365d",
    },
    {
      ref: "ineligible_strong_site_fit",
      ownerId: refs.workers.ineligible_strong_memory,
      fromId: refs.workers.ineligible_strong_memory,
      toId: refs.site,
      weight: 1,
      confidence: 1,
      label: "Ineligible worker has strong site fit.",
      lastEvidenceAt: new Date(),
      decayPolicy: "linear_365d",
    },
    {
      ref: "baseline_expired_site_fit",
      ownerId: refs.workers.eligible_baseline,
      fromId: refs.workers.eligible_baseline,
      toId: refs.site,
      weight: 1,
      confidence: 1,
      label: "Expired fit signal should not boost baseline worker.",
      validUntil: new Date(Date.now() - 24 * 60 * 60 * 1000),
      lastEvidenceAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000),
      decayPolicy: "linear_365d",
    },
    {
      ref: "baseline_negative_role_risk",
      ownerId: refs.workers.eligible_baseline,
      fromId: refs.workers.eligible_baseline,
      toType: "role",
      toId: roleType,
      kind: "risk",
      weight: -0.7,
      confidence: 0.8,
      label: "Recent risk signal should lower baseline worker within bounds.",
      lastEvidenceAt: new Date(),
      decayPolicy: "linear_365d",
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
        toType: seed.toType ?? "site",
        toId: seed.toId,
        kind: seed.kind ?? "fit_signal",
        label: seed.label,
        weight: seed.weight,
        confidence: seed.confidence,
        evidenceCount: 3,
        sourceType: "system_event",
        sourceRefType: "MemoryEval",
        sourceRefId: runId,
        visibility: "operational",
        status: "active",
        validUntil: seed.validUntil,
        lastEvidenceAt: seed.lastEvidenceAt,
        decayPolicy: seed.decayPolicy ?? "none",
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

async function runCpdRetrievalEvals(app, refs) {
  const rankingContext = await app.agents.memory.getWorkerRankingContext(Object.values(refs.workers), {
    siteId: refs.site,
    roleType,
  });
  const rankingMemoryIds = rankingContext.entries.map((memory) => memory.id);
  assert(
    rankingMemoryIds.includes(refs.memories.worker_completed_cpd),
    "Operational completed CPD was not available to ranking context.",
  );
  assert(
    !rankingMemoryIds.includes(refs.memories.worker_private_cpd_gap),
    "Private CPD confidence gap leaked into employer ranking context.",
  );

  const briefingContext = await app.agents.memory.getWorkerContext(refs.workers.eligible_preferred, {
    purpose: "briefing",
    audience: "worker",
    roleType,
  });
  const briefingMemoryIds = briefingContext.entries.map((memory) => memory.id);
  assert(
    briefingMemoryIds.includes(refs.memories.worker_completed_cpd),
    "Operational completed CPD was not available to worker briefing context.",
  );
  assert(
    briefingMemoryIds.includes(refs.memories.worker_private_cpd_gap),
    "Worker-facing briefing context did not include the worker's private CPD gap.",
  );
  log("cpd memory retrieval boundaries");
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
  const temporalMetadata = influence.inputs?.metadata?.temporalMemory;
  assert(temporalMetadata, `${influenceCase.name}: temporal scoring metadata missing from influence audit.`);
  assert(
    temporalMetadata.excludedByReason?.expired >= 1,
    `${influenceCase.name}: expired temporal edge exclusion was not audited.`,
  );
  assert(
    temporalMetadata.scores?.some((score) => score.edgeId === refs.edges.eligible_preferred_site_fit),
    `${influenceCase.name}: included temporal edge score was not audited.`,
  );
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

  const matchesResponse = await injectJson(app, `/v1/bookings/${refs.bookingRequest}/matches`);
  const employerReasonIds = (matchesResponse.memoryReasons ?? []).map((reason) => reason.id);
  assert(
    employerReasonIds.includes(refs.memories.worker_operational_fit) ||
      employerReasonIds.includes(refs.edges.eligible_preferred_site_fit),
    "ranking memory reasons did not include an operational memory signal.",
  );
  assert(
    !employerReasonIds.includes(refs.memories.worker_private_preference),
    "employer-facing ranking memory reasons leaked private worker memory.",
  );
  assert(
    !employerReasonIds.includes(refs.memories.worker_private_cpd_gap),
    "employer-facing ranking memory reasons leaked private CPD memory.",
  );
  log("employer-facing memory influence reasons");
}

async function runOfferExplanationEvals(app, prisma, refs) {
  const match = await prisma.match.findFirst({
    where: { bookingRequestId: refs.bookingRequest, workerId: refs.workers.eligible_preferred },
    orderBy: { rank: "asc" },
  });
  assert(match, "offer explanation eval needs an eligible preferred match.");

  const offerId = id("offer-worker-memory-reasons");
  await prisma.offer.create({
    data: {
      id: offerId,
      bookingRequestId: refs.bookingRequest,
      workerId: refs.workers.eligible_preferred,
      matchId: match.id,
      status: "pending",
      payRate: 150,
      fitExplanation: "Memory eval offer for worker-facing explanation.",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  const offerResponse = await injectJson(app, `/v1/workers/${refs.workers.eligible_preferred}/offer`);
  const workerReasonIds = (offerResponse.offer?.memoryReasons ?? []).map((reason) => reason.id);
  assert(
    workerReasonIds.includes(refs.memories.worker_private_preference),
    "worker-facing offer memory reasons did not include the worker's own private explanation memory.",
  );
  log("worker-facing memory influence reasons");

  const offerMemoryResult = await app.agents.memory.recordOfferOutcome(offerId, "accepted");
  assert(offerMemoryResult.success, `offer outcome memory projection failed: ${offerMemoryResult.explanation}`);
  const offerEpisodes = await prisma.memoryEpisode.findMany({
    where: { sourceRefType: "Offer", sourceRefId: offerId },
  });
  assert(offerEpisodes.length >= 3, "Offer outcome did not create memory episodes for reinforced edges.");
  const offerEdges = await prisma.memoryEdge.findMany({
    where: { sourceRefType: "Offer", sourceRefId: offerId },
  });
  assert(
    offerEdges.every((edge) => edge.lastEvidenceAt && Array.isArray(edge.evidenceRefs)),
    "Offer outcome did not update edge temporal evidence metadata.",
  );

  const bookingId = id("booking-worker-memory-reasons");
  const shiftId = id("shift-worker-memory-reasons");
  await prisma.booking.create({
    data: {
      id: bookingId,
      bookingRequestId: refs.bookingRequest,
      organisationId: refs.organisation,
      siteId: refs.site,
      workerId: refs.workers.eligible_preferred,
      offerId,
      status: "confirmed",
      roleType,
      startAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      endAt: new Date(Date.now() + 31 * 60 * 60 * 1000),
      payRate: 150,
      vioraFee: 30,
      totalCost: 180,
      backupWorkerIds: [],
      complianceSnapshot: { eval: true },
    },
  });
  await prisma.shift.create({
    data: {
      id: shiftId,
      bookingId,
      status: "scheduled",
    },
  });
  const shiftMemoryResult = await app.agents.memory.recordShiftEvent(shiftId, "checked_out");
  assert(shiftMemoryResult.success, `shift memory projection failed: ${shiftMemoryResult.explanation}`);
  const shiftEpisode = await prisma.memoryEpisode.findFirst({
    where: { sourceRefType: "Shift", sourceRefId: shiftId },
  });
  assert(shiftEpisode, "Shift event did not create a memory episode.");

  const evidence = await injectJson(app, "/v1/admin/memory/evidence");
  assert(
    evidence.episodes?.some((episode) => episode.id === shiftEpisode.id),
    "Admin memory evidence endpoint did not include recent episode.",
  );
  assert(
    evidence.edges?.some((edge) => edge.ownerId === refs.workers.eligible_preferred),
    "Admin memory evidence endpoint did not include worker edge evidence.",
  );
  assert(
    evidence.influence?.some((event) => event.entityId === refs.bookingRequest),
    "Admin memory evidence endpoint did not include recent influence audit.",
  );
  log("temporal memory episodes and edge evidence");
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

async function runConsolidationEvals(app, prisma, refs) {
  const oldDate = new Date(Date.now() - 150 * 24 * 60 * 60 * 1000);
  const staleId = id("memory-consolidation-stale");
  const duplicateA = id("memory-consolidation-duplicate-a");
  const duplicateB = id("memory-consolidation-duplicate-b");
  const conflictA = id("memory-consolidation-conflict-a");
  const conflictB = id("memory-consolidation-conflict-b");
  await prisma.memoryEntry.createMany({
    data: [
      {
        id: staleId,
        ownerType: "organisation",
        ownerId: refs.organisation,
        subjectType: "site",
        subjectId: refs.site,
        kind: "briefing_note",
        key: "consolidation_stale",
        title: "Old parking note",
        content: "Use the old car park gate.",
        sourceType: "user_entered",
        visibility: "operational",
        status: "active",
        useScopes: ["briefing"],
        sensitivity: "standard",
        confidence: 0.7,
        updatedAt: oldDate,
      },
      {
        id: duplicateA,
        ownerType: "organisation",
        ownerId: refs.organisation,
        subjectType: "site",
        subjectId: refs.site,
        kind: "instruction",
        key: "duplicate_arrival",
        title: "Arrival instruction",
        content: "Arrive at reception by 08:00.",
        sourceType: "user_entered",
        visibility: "operational",
        status: "active",
        useScopes: ["briefing"],
        sensitivity: "standard",
        confidence: 0.8,
      },
      {
        id: duplicateB,
        ownerType: "organisation",
        ownerId: refs.organisation,
        subjectType: "site",
        subjectId: refs.site,
        kind: "instruction",
        key: "duplicate_arrival",
        title: "Arrival instruction",
        content: "Arrive at reception by 08:00 and collect plans.",
        sourceType: "user_entered",
        visibility: "operational",
        status: "active",
        useScopes: ["briefing"],
        sensitivity: "standard",
        confidence: 0.75,
      },
      {
        id: conflictA,
        ownerType: "worker",
        ownerId: refs.workers.eligible_preferred,
        subjectType: "worker",
        subjectId: refs.workers.eligible_preferred,
        kind: "pay_signal",
        key: "pay_floor_old",
        title: "Pay expectation",
        content: "Prefers at least 120 per day.",
        value: { valueType: "pay_expectation", amount: 120, currency: "GBP", rateUnit: "day" },
        sourceType: "user_entered",
        visibility: "operational",
        status: "active",
        useScopes: ["ranking_signal", "explanation"],
        sensitivity: "standard",
        confidence: 0.8,
      },
      {
        id: conflictB,
        ownerType: "worker",
        ownerId: refs.workers.eligible_preferred,
        subjectType: "worker",
        subjectId: refs.workers.eligible_preferred,
        kind: "pay_signal",
        key: "pay_floor_new",
        title: "Pay expectation",
        content: "Will not accept less than 165 per day.",
        value: { valueType: "pay_expectation", amount: 165, currency: "GBP", rateUnit: "day" },
        sourceType: "user_entered",
        visibility: "operational",
        status: "active",
        useScopes: ["ranking_signal", "explanation"],
        sensitivity: "standard",
        confidence: 0.9,
      },
    ],
  });

  await prisma.memoryEpisode.createMany({
    data: [0, 1, 2].map((idx) => ({
      id: id(`consolidation-episode-${idx}`),
      ownerType: "worker",
      ownerId: refs.workers.eligible_preferred,
      subjectType: "site",
      subjectId: refs.site,
      kind: "fit_signal",
      label: "Repeated accepted Greenfield shift",
      sourceType: "system_event",
      sourceRefType: "Offer",
      sourceRefId: id(`consolidation-offer-${idx}`),
      entityType: "Offer",
      entityId: id(`consolidation-offer-${idx}`),
      outcome: "accepted",
      occurredAt: new Date(Date.now() - idx * 24 * 60 * 60 * 1000),
      affectedMemoryIds: [],
      affectedEdgeIds: [refs.edges.eligible_preferred_site_fit],
      metadata: { eval: true },
    })),
  });

  const consolidation = await injectJson(app, "/v1/admin/memory/consolidation");
  const suggestions = consolidation.suggestions ?? [];
  const archiveSuggestion = suggestions.find((suggestion) => suggestion.action === "archive" && suggestion.affectedMemoryIds.includes(staleId));
  const mergeSuggestion = suggestions.find((suggestion) => suggestion.action === "merge" && suggestion.affectedMemoryIds.includes(duplicateA) && suggestion.affectedMemoryIds.includes(duplicateB));
  const conflictSuggestion = suggestions.find((suggestion) => suggestion.action === "needs_human_review" && suggestion.affectedMemoryIds.includes(conflictA) && suggestion.affectedMemoryIds.includes(conflictB));
  const patternSuggestion = suggestions.find((suggestion) => suggestion.action === "confirm_pattern" && suggestion.affectedEdgeIds.includes(refs.edges.eligible_preferred_site_fit));
  assert(archiveSuggestion, "Consolidation did not suggest archiving stale memory.");
  assert(mergeSuggestion, "Consolidation did not suggest merging duplicate memories.");
  assert(conflictSuggestion, "Consolidation did not suggest review for conflicting memories.");
  assert(patternSuggestion, "Consolidation did not suggest confirming repeated episode pattern.");

  const rejectRes = await app.inject({
    method: "POST",
    url: `/v1/admin/memory/consolidation/${conflictSuggestion.id}/reject`,
    payload: { adminId: "memory-eval" },
  });
  assert(rejectRes.statusCode === 200, `Consolidation reject failed (${rejectRes.statusCode}): ${rejectRes.body}`);
  const conflictRows = await prisma.memoryEntry.findMany({ where: { id: { in: [conflictA, conflictB] } } });
  assert(conflictRows.every((memory) => memory.status === "active"), "Rejected consolidation mutated conflicting memories.");

  const applyArchive = await app.inject({
    method: "POST",
    url: `/v1/admin/memory/consolidation/${archiveSuggestion.id}/apply`,
    payload: { adminId: "memory-eval" },
  });
  assert(applyArchive.statusCode === 200, `Consolidation archive apply failed (${applyArchive.statusCode}): ${applyArchive.body}`);
  const stale = await prisma.memoryEntry.findUnique({ where: { id: staleId } });
  assert(stale?.status === "archived", "Applied archive suggestion did not archive stale memory.");

  const applyPattern = await app.inject({
    method: "POST",
    url: `/v1/admin/memory/consolidation/${patternSuggestion.id}/apply`,
    payload: { adminId: "memory-eval" },
  });
  assert(applyPattern.statusCode === 200, `Consolidation pattern apply failed (${applyPattern.statusCode}): ${applyPattern.body}`);
  const patternMemory = await prisma.memoryEntry.findFirst({
    where: { sourceRefType: "MemoryReviewSuggestion", sourceRefId: patternSuggestion.id },
  });
  assert(patternMemory?.status === "pending_confirmation", "Pattern consolidation did not create pending memory.");

  const audit = await prisma.auditEvent.findMany({
    where: { action: { in: ["memory.consolidation.apply", "memory.consolidation.reject"] } },
  });
  assert(audit.length >= 3, "Consolidation apply/reject audit rows were not written.");
  log("memory consolidation suggestions and review actions");
}

async function runProceduralLearningEvals(app, prisma, refs) {
  const seedClarifications = async (missingFields, label) => {
    for (let idx = 0; idx < 3; idx += 1) {
      await prisma.auditEvent.create({
        data: {
          actorType: "agent",
          actorId: "v",
          action: "intake.clarify",
          entityType: "Conversation",
          entityId: id(`procedural-${label}-conversation-${idx}`),
          inputs: {
            organisationId: refs.organisation,
            rawInput: `Need ${roleType} cover at ${refs.site}; procedural eval ${label} ${idx}.`,
            channel: "web",
            conversationId: null,
            intent: {
              roleType,
              siteId: refs.site,
            },
            missingFields,
            guardrails: {},
          },
          outputs: {
            message: `Please confirm ${missingFields.join(" and ")}.`,
            conversationId: id(`procedural-${label}-conversation-${idx}`),
            bookingRequestId: null,
            fallbackUsed: false,
          },
          outcome: "clarification_required",
        },
      });
    }
  };

  await seedClarifications(["payRate"], "pay");
  await seedClarifications(["startAt"], "start");

  const consolidation = await injectJson(app, "/v1/admin/memory/consolidation");
  const suggestions = consolidation.suggestions ?? [];
  const paySuggestion = suggestions.find(
    (suggestion) =>
      suggestion.action === "propose_playbook" &&
      suggestion.ownerId === refs.organisation &&
      suggestion.inputs?.trigger?.missingFields?.includes("payRate"),
  );
  const startSuggestion = suggestions.find(
    (suggestion) =>
      suggestion.action === "propose_playbook" &&
      suggestion.ownerId === refs.organisation &&
      suggestion.inputs?.trigger?.missingFields?.includes("startAt"),
  );
  assert(paySuggestion, "Procedural learning did not suggest payRate intake playbook.");
  assert(startSuggestion, "Procedural learning did not suggest startAt intake playbook.");

  const rejectRes = await app.inject({
    method: "POST",
    url: `/v1/admin/memory/consolidation/${startSuggestion.id}/reject`,
    payload: { adminId: "memory-eval" },
  });
  assert(rejectRes.statusCode === 200, `Procedural playbook reject failed (${rejectRes.statusCode}): ${rejectRes.body}`);

  const applyRes = await app.inject({
    method: "POST",
    url: `/v1/admin/memory/consolidation/${paySuggestion.id}/apply`,
    payload: { adminId: "memory-eval" },
  });
  assert(applyRes.statusCode === 200, `Procedural playbook apply failed (${applyRes.statusCode}): ${applyRes.body}`);

  const approved = await prisma.memoryEntry.findFirst({
    where: {
      sourceRefType: "MemoryReviewSuggestion",
      sourceRefId: paySuggestion.id,
      kind: "pattern",
      status: "active",
    },
  });
  assert(approved, "Applied procedural playbook did not create active memory.");
  assert(approved.confirmedBy === "memory-eval", "Applied procedural playbook did not record reviewer.");
  assert(approved.useScopes.includes("intake_default"), "Procedural playbook is not intake-scoped.");
  assert(!approved.useScopes.includes("ranking_signal"), "Procedural playbook unexpectedly has ranking scope.");
  assert(approved.value?.valueType === "procedural_playbook", "Procedural playbook valueType was not persisted.");
  assert(
    approved.value?.guardrails?.rankingImpact === "none" && approved.value?.guardrails?.complianceImpact === "none",
    "Procedural playbook guardrails were not persisted.",
  );

  const rejectedMemory = await prisma.memoryEntry.findFirst({
    where: { sourceRefType: "MemoryReviewSuggestion", sourceRefId: startSuggestion.id },
  });
  assert(!rejectedMemory, "Rejected procedural playbook created memory.");

  const context = await app.agents.memory.getOrganisationContext(refs.organisation, {
    purpose: "intake_default",
    audience: "employer",
    siteId: refs.site,
  });
  assert(
    context.entries.some((memory) => memory.id === approved.id),
    "Approved procedural playbook did not appear in intake memory retrieval.",
  );

  const audit = await prisma.auditEvent.findMany({
    where: {
      entityType: "MemoryReviewSuggestion",
      entityId: { in: [paySuggestion.id, startSuggestion.id] },
      action: { in: ["memory.consolidation.apply", "memory.consolidation.reject"] },
    },
  });
  assert(audit.length === 2, "Procedural playbook review decisions were not audited.");
  log("reviewed procedural intake playbooks");
}

async function createCompletedFeedbackShift(prisma, refs, suffix) {
  const bookingRequestId = id(`feedback-booking-request-${suffix}`);
  const offerId = id(`feedback-offer-${suffix}`);
  const bookingId = id(`feedback-booking-${suffix}`);
  const shiftId = id(`feedback-shift-${suffix}`);
  await prisma.bookingRequest.create({
    data: {
      id: bookingRequestId,
      organisationId: refs.organisation,
      siteId: refs.site,
      status: "filled",
      roleType,
      startAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      endAt: new Date(Date.now() - 41 * 60 * 60 * 1000),
      rateMode: "standard",
      payRate: 150,
      rawIntent: `Feedback eval booking ${suffix}`,
      channel: "web",
      broadcastStrategy: "simultaneous_top_n",
    },
  });
  await prisma.offer.create({
    data: {
      id: offerId,
      bookingRequestId,
      workerId: refs.workers.eligible_preferred,
      status: "accepted",
      payRate: 150,
      fitExplanation: "Feedback eval accepted offer.",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  await prisma.booking.create({
    data: {
      id: bookingId,
      bookingRequestId,
      organisationId: refs.organisation,
      siteId: refs.site,
      workerId: refs.workers.eligible_preferred,
      offerId,
      status: "completed",
      roleType,
      startAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      endAt: new Date(Date.now() - 41 * 60 * 60 * 1000),
      payRate: 150,
      vioraFee: 30,
      totalCost: 180,
      backupWorkerIds: [],
      complianceSnapshot: { eval: true },
    },
  });
  await prisma.shift.create({
    data: {
      id: shiftId,
      bookingId,
      status: "checked_out",
      checkedInAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      checkedOutAt: new Date(Date.now() - 41 * 60 * 60 * 1000),
    },
  });
  return shiftId;
}

async function postJson(app, url, payload) {
  const res = await app.inject({ method: "POST", url, payload });
  assert(res.statusCode >= 200 && res.statusCode < 300, `${url} failed (${res.statusCode}): ${res.body}`);
  return JSON.parse(res.body);
}

async function runPostShiftLearningEvals(app, prisma, refs) {
  const shiftA = await createCompletedFeedbackShift(prisma, refs, "a");
  const shiftB = await createCompletedFeedbackShift(prisma, refs, "b");
  const shiftC = await createCompletedFeedbackShift(prisma, refs, "c");
  const shiftContested = await createCompletedFeedbackShift(prisma, refs, "contested");

  const workerCommentA = "The briefing should mention the reception gate code and behaviour plan before arrival.";
  const workerCommentB = "Future workers need a briefing note about the reception gate and lesson plan pickup.";

  await postJson(app, `/v1/organisations/${refs.organisation}/shifts/${shiftA}/feedback`, {
    rating: 5,
    comment: "Excellent fit for this site and role.",
  });
  await postJson(app, `/v1/organisations/${refs.organisation}/shifts/${shiftB}/feedback`, {
    rating: 4,
    comment: "Strong repeat fit; pupils responded well.",
  });
  await postJson(app, `/v1/workers/${refs.workers.eligible_preferred}/shifts/${shiftA}/feedback`, {
    rating: 4,
    comment: workerCommentA,
  });
  await postJson(app, `/v1/workers/${refs.workers.eligible_preferred}/shifts/${shiftB}/feedback`, {
    rating: 4,
    comment: workerCommentB,
  });
  await postJson(app, `/v1/organisations/${refs.organisation}/shifts/${shiftContested}/feedback`, {
    rating: 5,
    comment: "This should not become learning evidence.",
    contested: true,
  });
  await postJson(app, `/v1/workers/${refs.workers.eligible_preferred}/shifts/${shiftC}/feedback`, {
    rating: 2,
    comment: "This comment is too generic to become a briefing note.",
  });

  const feedbackRows = await prisma.feedback.findMany({
    where: { shiftId: { in: [shiftA, shiftB, shiftC, shiftContested] } },
  });
  assert(feedbackRows.length === 6, "Feedback endpoints did not create expected rows.");
  const feedbackEpisodes = await prisma.memoryEpisode.findMany({
    where: { sourceRefType: "Feedback", sourceRefId: { in: feedbackRows.map((feedback) => feedback.id) } },
  });
  assert(feedbackEpisodes.length >= 6, "Feedback learning did not create memory episodes.");

  const consolidation = await injectJson(app, "/v1/admin/memory/consolidation");
  const suggestions = consolidation.suggestions ?? [];
  const fitSuggestion = suggestions.find(
    (suggestion) =>
      suggestion.action === "propose_fit_feedback" &&
      suggestion.ownerId === refs.workers.eligible_preferred &&
      suggestion.subjectId === refs.site,
  );
  const briefingSuggestion = suggestions.find(
    (suggestion) =>
      suggestion.action === "propose_briefing_note" &&
      suggestion.ownerId === refs.organisation &&
      suggestion.subjectId === refs.site,
  );
  assert(fitSuggestion, "Post-shift learning did not suggest fit feedback review.");
  assert(briefingSuggestion, "Post-shift learning did not suggest briefing note review.");

  await postJson(app, `/v1/admin/memory/consolidation/${fitSuggestion.id}/apply`, { adminId: "memory-eval" });
  await postJson(app, `/v1/admin/memory/consolidation/${briefingSuggestion.id}/apply`, { adminId: "memory-eval" });

  const fitMemory = await prisma.memoryEntry.findFirst({
    where: { sourceRefType: "MemoryReviewSuggestion", sourceRefId: fitSuggestion.id },
  });
  assert(fitMemory?.status === "pending_confirmation", "Fit feedback apply did not create pending-confirmation memory.");
  assert(fitMemory.useScopes.includes("ranking_signal"), "Fit feedback memory is missing ranking scope.");
  assert(fitMemory.value?.valueType === "role_confidence", "Fit feedback memory did not use role_confidence value.");

  const briefingMemory = await prisma.memoryEntry.findFirst({
    where: { sourceRefType: "MemoryReviewSuggestion", sourceRefId: briefingSuggestion.id },
  });
  assert(briefingMemory?.status === "active", "Briefing feedback apply did not create active memory.");
  assert(briefingMemory.useScopes.includes("briefing"), "Briefing feedback memory is missing briefing scope.");
  assert(!briefingMemory.useScopes.includes("ranking_signal"), "Briefing feedback memory unexpectedly has ranking scope.");
  assert(briefingMemory.value?.valueType === "briefing_note", "Briefing feedback memory did not use briefing_note value.");

  const contestedSuggestion = suggestions.find(
    (suggestion) =>
      suggestion.action === "propose_fit_feedback" &&
      suggestion.inputs?.comments?.some((comment) => String(comment).includes("should not become")),
  );
  assert(!contestedSuggestion, "Contested feedback created a post-shift learning suggestion.");

  const audit = await prisma.auditEvent.findMany({
    where: { action: { in: ["shift.feedback", "memory.feedback.learn"] }, entityId: { in: feedbackRows.map((feedback) => feedback.id) } },
  });
  assert(audit.length >= 12, "Feedback endpoints and memory learning did not write audit rows.");
  log("post-shift feedback learning suggestions");
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
  await validateTypedValueFixtures();
  await validateTemporalScoringFixtures();
  log("fixture catalog loaded");

  const { buildServer } = await import("../apps/api/src/index.ts");
  app = await buildServer();
  await app.ready();
  log("API ready in-process");

  const refs = await seedEvalData(prisma);
  log("isolated eval data seeded");

  runTypedValueSeedEvals(refs);
  await runTypedValueRouteEvals(app, refs);
  await runMemoryControlsEvals(app, refs);
  await runRetrievalEvals(app, refs);
  await runCpdRetrievalEvals(app, refs);
  await runRankingEvals(app, prisma, refs);
  await runOfferExplanationEvals(app, prisma, refs);
  await runConsolidationEvals(app, prisma, refs);
  await runProceduralLearningEvals(app, prisma, refs);
  await runPostShiftLearningEvals(app, prisma, refs);
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
