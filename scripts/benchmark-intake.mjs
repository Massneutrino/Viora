import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

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

function parseArgs(argv) {
  const options = { limit: undefined, samplesPath: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === "--limit" || arg === "-n") && argv[i + 1]) {
      options.limit = Number(argv[++i]);
    } else if (arg.startsWith("--limit=")) {
      options.limit = Number(arg.slice("--limit=".length));
    } else if ((arg === "--samples" || arg === "-s") && argv[i + 1]) {
      options.samplesPath = argv[++i];
    } else if (arg.startsWith("--samples=")) {
      options.samplesPath = arg.slice("--samples=".length);
    }
  }
  return options;
}

const contexts = {
  greenfield: {
    organisationId: "demo-org",
    sites: [{ id: "demo-site", name: "Greenfield Primary" }],
    memory: { summary: "Greenfield's usual booking is a full-day supply_teacher shift from 08:30 to 15:30." },
    guardrails: {
      autonomyLevel: "L2",
      budgetCeiling: 200,
      payFloor: 80,
      approvedRoleTypes: [
        "supply_teacher",
        "cover_supervisor",
        "teaching_assistant",
        "learning_support_assistant",
        "invigilator",
      ],
      escalationContacts: ["cover@greenfieldmat.org"],
    },
  },
  oakwood: {
    organisationId: "demo-org-primary",
    sites: [{ id: "demo-site-primary", name: "Oakwood Primary" }],
    memory: { summary: "Oakwood full-day cover normally runs 08:30 to 15:30." },
    guardrails: {
      autonomyLevel: "L2",
      budgetCeiling: 185,
      payFloor: 80,
      approvedRoleTypes: ["supply_teacher", "cover_supervisor", "teaching_assistant"],
      escalationContacts: ["helen.patel@oakwoodprimary.sch.uk"],
    },
  },
  riverside: {
    organisationId: "demo-org-secondary",
    sites: [{ id: "demo-site-secondary", name: "Riverside Academy" }],
    memory: { summary: "Riverside often needs secondary cover with subject notes in requirements." },
    guardrails: {
      autonomyLevel: "L2",
      budgetCeiling: 220,
      payFloor: 90,
      approvedRoleTypes: ["supply_teacher", "cover_supervisor", "teaching_assistant", "invigilator"],
      escalationContacts: ["marcus.thompson@riversideacademy.org"],
    },
  },
  kingsbridge: {
    organisationId: "demo-org-university",
    sites: [{ id: "demo-site-university", name: "Kingsbridge - South Campus" }],
    memory: { summary: "Kingsbridge exam support can be half-day invigilation." },
    guardrails: {
      autonomyLevel: "L2",
      budgetCeiling: 280,
      payFloor: 70,
      approvedRoleTypes: ["supply_teacher", "invigilator", "learning_support_assistant"],
      escalationContacts: ["fiona.nguyen@kingsbridge.ac.uk"],
    },
  },
  rainbow: {
    organisationId: "demo-org-nursery",
    sites: [{ id: "demo-site-nursery", name: "Rainbow Nursery - Islington" }],
    memory: { summary: "Rainbow accepts LSA shorthand for learning support assistant." },
    guardrails: {
      autonomyLevel: "L2",
      budgetCeiling: 110,
      payFloor: 70,
      approvedRoleTypes: ["teaching_assistant", "learning_support_assistant", "cover_supervisor"],
      escalationContacts: ["david.okonkwo@rainbownursery.org"],
    },
  },
  littleSprouts: {
    organisationId: "demo-org-daycare",
    sites: [{ id: "demo-site-daycare", name: "Little Sprouts - Camden" }],
    memory: { summary: "Little Sprouts accepts TA shorthand for teaching assistant." },
    guardrails: {
      autonomyLevel: "L2",
      budgetCeiling: 120,
      payFloor: 70,
      approvedRoleTypes: ["teaching_assistant", "learning_support_assistant"],
      escalationContacts: ["emma.walsh@littlesprouts.co.uk"],
    },
  },
};

const defaultSamples = [
  {
    id: "greenfield-ks2-supply",
    message:
      "Greenfield Primary needs a KS2 supply teacher on Monday 11 January 2027, 08:30 to 15:30. GBP 170 per day.",
    context: contexts.greenfield,
    gold: {
      roleType: "supply_teacher",
      siteId: "demo-site",
      startAt: "2027-01-11T08:30:00.000Z",
      endAt: "2027-01-11T15:30:00.000Z",
      rateMode: "standard",
      payRate: 170,
      missingFields: [],
      requirementsContains: ["ks2"],
    },
  },
  {
    id: "oakwood-cover-full-day",
    message:
      "Can V book a cover supervisor for Oakwood Primary on Wednesday 13 January 2027? Full day, GBP 145.",
    context: contexts.oakwood,
    gold: {
      roleType: "cover_supervisor",
      siteId: "demo-site-primary",
      startAt: "2027-01-13T08:30:00.000Z",
      endAt: "2027-01-13T15:30:00.000Z",
      rateMode: "standard",
      payRate: 145,
      missingFields: [],
    },
  },
  {
    id: "riverside-dynamic-maths",
    message:
      "Riverside Academy need a cover supervisor for GCSE maths cover on Friday 15 January 2027, 08:15-15:45. Use dynamic rate up to GBP 190.",
    context: contexts.riverside,
    gold: {
      roleType: "cover_supervisor",
      siteId: "demo-site-secondary",
      startAt: "2027-01-15T08:15:00.000Z",
      endAt: "2027-01-15T15:45:00.000Z",
      rateMode: "dynamic",
      maxPayRate: 190,
      missingFields: ["payRate"],
      requirementsContains: ["maths"],
    },
  },
  {
    id: "kingsbridge-invigilator-half-day",
    message:
      "Need an invigilator at Kingsbridge South Campus from 9am to noon on Monday 18 January 2027. GBP 85.",
    context: contexts.kingsbridge,
    gold: {
      roleType: "invigilator",
      siteId: "demo-site-university",
      startAt: "2027-01-18T09:00:00.000Z",
      endAt: "2027-01-18T12:00:00.000Z",
      rateMode: "standard",
      payRate: 85,
      missingFields: [],
    },
  },
  {
    id: "rainbow-lsa-send",
    message:
      "Rainbow Nursery Islington need an LSA with SEND experience on Monday 18 January 2027, 08:00-13:00. GBP 100.",
    context: contexts.rainbow,
    gold: {
      roleType: "learning_support_assistant",
      siteId: "demo-site-nursery",
      startAt: "2027-01-18T08:00:00.000Z",
      endAt: "2027-01-18T13:00:00.000Z",
      rateMode: "standard",
      payRate: 100,
      missingFields: [],
      requirementsContains: ["send"],
    },
  },
  {
    id: "little-sprouts-ta",
    message:
      "Little Sprouts Camden needs a TA on Tuesday 19 January 2027, 8 till 4. GBP 105.",
    context: contexts.littleSprouts,
    gold: {
      roleType: "teaching_assistant",
      siteId: "demo-site-daycare",
      startAt: "2027-01-19T08:00:00.000Z",
      endAt: "2027-01-19T16:00:00.000Z",
      rateMode: "standard",
      payRate: 105,
      missingFields: [],
    },
  },
  {
    id: "greenfield-follow-up-memory",
    message: "Same as our usual Greenfield booking on Thursday 21 January 2027, but pay GBP 160.",
    context: contexts.greenfield,
    gold: {
      roleType: "supply_teacher",
      siteId: "demo-site",
      startAt: "2027-01-21T08:30:00.000Z",
      endAt: "2027-01-21T15:30:00.000Z",
      rateMode: "standard",
      payRate: 160,
      missingFields: [],
    },
  },
  {
    id: "missing-site",
    message: "Need a KS1 supply teacher on Friday 22 January 2027, 08:30-15:30. GBP 175.",
    context: { ...contexts.greenfield, sites: [] },
    gold: {
      roleType: "supply_teacher",
      startAt: "2027-01-22T08:30:00.000Z",
      endAt: "2027-01-22T15:30:00.000Z",
      rateMode: "standard",
      payRate: 175,
      missingFields: ["siteId"],
      requirementsContains: ["ks1"],
    },
  },
  {
    id: "above-budget-pay",
    message:
      "Greenfield Primary need a science supply teacher on Monday 25 January 2027, 08:30-15:30, GBP 230.",
    context: contexts.greenfield,
    gold: {
      roleType: "supply_teacher",
      siteId: "demo-site",
      startAt: "2027-01-25T08:30:00.000Z",
      endAt: "2027-01-25T15:30:00.000Z",
      rateMode: "standard",
      payRate: 230,
      missingFields: ["payRate"],
      requirementsContains: ["science"],
    },
  },
  {
    id: "outside-approved-role",
    message:
      "Greenfield Primary needs a receptionist on Tuesday 26 January 2027 from 08:00 to 12:00 at GBP 90.",
    context: contexts.greenfield,
    gold: {
      roleType: "receptionist",
      siteId: "demo-site",
      startAt: "2027-01-26T08:00:00.000Z",
      endAt: "2027-01-26T12:00:00.000Z",
      rateMode: "standard",
      payRate: 90,
      missingFields: ["roleType"],
    },
  },
];

function normalise(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function isoMinute(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 16);
}

function hasMissingFields(actual, expected) {
  const actualSet = new Set((actual ?? []).map(normalise));
  if ((expected ?? []).length === 0) return actualSet.size === 0;
  return expected.every((field) => actualSet.has(normalise(field)));
}

function requirementsContain(actual, expected) {
  if (!expected?.length) return true;
  const text = JSON.stringify(actual ?? {}).toLowerCase();
  return expected.every((item) => text.includes(String(item).toLowerCase()));
}

function compareCase(actual, gold) {
  const checks = [
    ["roleType", normalise(actual.roleType) === normalise(gold.roleType)],
    ["siteId", gold.siteId === undefined || actual.siteId === gold.siteId],
    ["startAt", isoMinute(actual.startAt) === isoMinute(gold.startAt)],
    ["endAt", isoMinute(actual.endAt) === isoMinute(gold.endAt)],
    ["rateMode", gold.rateMode === undefined || actual.rateMode === gold.rateMode],
    ["payRate", gold.payRate === undefined || Math.abs(Number(actual.payRate) - gold.payRate) < 0.01],
    ["maxPayRate", gold.maxPayRate === undefined || Math.abs(Number(actual.maxPayRate) - gold.maxPayRate) < 0.01],
    ["missingFields", hasMissingFields(actual.missingFields, gold.missingFields)],
    ["requirements", requirementsContain(actual.requirements, gold.requirementsContains)],
  ];
  return {
    checks,
    passed: checks.every(([, ok]) => ok),
  };
}

function loadSamples(samplesPath) {
  if (!samplesPath) return defaultSamples;
  const path = resolve(process.cwd(), samplesPath);
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("--samples must point to a JSON array");
  return parsed;
}

loadDotEnv();

let imports;
try {
  imports = await Promise.all([import("@viora/agents"), import("@viora/domain")]);
} catch (err) {
  console.error("Could not import built Viora packages. Run: npm run benchmark:intake");
  throw err;
}

const [{ vAgent, getActiveLlmConfig }, { PHASE_0_SUCCESS_METRICS }] = imports;
const options = parseArgs(process.argv.slice(2));
const limit = Number.isFinite(options.limit) ? Math.max(0, options.limit) : undefined;
const samples = loadSamples(options.samplesPath).slice(0, limit);
const target = PHASE_0_SUCCESS_METRICS.intentCaptureAccuracy;
const llmConfig = getActiveLlmConfig({ task: "parseIntent" });

console.log(`Intake benchmark: ${samples.length} sample(s)`);
console.log(`parseIntent model: ${llmConfig.provider}/${llmConfig.model}`);
console.log(`Target sample accuracy: ${(target * 100).toFixed(1)}%\n`);

let passedCases = 0;
let passedFields = 0;
let totalFields = 0;

for (const sample of samples) {
  const actual = await vAgent.parseIntent(sample.message, sample.context);
  const result = compareCase(actual, sample.gold);
  if (result.passed) passedCases++;
  for (const [, ok] of result.checks) {
    totalFields++;
    if (ok) passedFields++;
  }

  const failed = result.checks.filter(([, ok]) => !ok).map(([name]) => name);
  const marker = result.passed ? "PASS" : "FAIL";
  console.log(`${marker} ${sample.id}${failed.length ? ` (${failed.join(", ")})` : ""}`);
  if (!result.passed) {
    console.log(`  expected: ${JSON.stringify(sample.gold)}`);
    console.log(
      `  actual:   ${JSON.stringify({
        roleType: actual.roleType,
        siteId: actual.siteId,
        startAt: actual.startAt?.toISOString(),
        endAt: actual.endAt?.toISOString(),
        rateMode: actual.rateMode,
        payRate: actual.payRate,
        maxPayRate: actual.maxPayRate,
        missingFields: actual.missingFields,
        requirements: actual.requirements,
      })}`,
    );
  }
}

const sampleAccuracy = samples.length ? passedCases / samples.length : 0;
const fieldAccuracy = totalFields ? passedFields / totalFields : 0;

console.log("\nSummary");
console.log(`Sample accuracy: ${(sampleAccuracy * 100).toFixed(1)}% (${passedCases}/${samples.length})`);
console.log(`Field accuracy:  ${(fieldAccuracy * 100).toFixed(1)}% (${passedFields}/${totalFields})`);

if (sampleAccuracy < target) {
  console.error(`Below target: ${(target * 100).toFixed(1)}% sample accuracy`);
  process.exitCode = 1;
}
