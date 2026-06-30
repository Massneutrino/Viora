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

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

function log(message) {
  console.log(`[ok] ${message}`);
}

loadDotEnv();
process.env.DATABASE_URL ??= "postgresql://viora:viora@localhost:5432/viora";
process.env.AI_PROVIDER ??= "anthropic";
process.env.ANTHROPIC_API_KEY ??= "workflow-test-no-llm";
process.env.GOOGLE_API_KEY ??= "workflow-test-no-llm";

const domain = await import("@viora/domain");
const {
  V_WORKFLOWS,
  simulateWorkflow,
  validateWorkflow,
  workflowSummaries,
} = domain;

for (const workflow of V_WORKFLOWS) {
  const errors = validateWorkflow(workflow).filter((warning) => warning.severity === "error");
  assert(errors.length === 0, `${workflow.id} has validation errors: ${JSON.stringify(errors)}`);
}
log("all shipped V workflows validate");

const base = V_WORKFLOWS[0];
assert(base, "expected at least one workflow");

const missingEdge = {
  ...base,
  edges: [{ id: "bad-edge", from: "start", to: "missing-node" }],
  scenarios: [],
};
assert(
  validateWorkflow(missingEdge).some((warning) => warning.code === "missing_edge_to"),
  "validator should reject missing edge target",
);

const mutatingWithoutAudit = {
  ...base,
  nodes: [
    ...base.nodes,
    {
      id: "bad-mutator",
      type: "api_action",
      label: "Bad mutator",
      description: "Mutates without audit.",
      mutatesState: true,
      x: 0,
      y: 0,
    },
  ],
  edges: [],
  scenarios: [],
};
assert(
  validateWorkflow(mutatingWithoutAudit).some((warning) => warning.code === "mutating_node_without_audit"),
  "validator should reject mutating node without audit action",
);

const llmCompliance = {
  ...base,
  nodes: [
    {
      id: "bad-compliance",
      type: "deterministic_check",
      label: "Bad compliance",
      description: "LLM compliance decision.",
      agent: "compliance",
      mayCallLLM: true,
      x: 0,
      y: 0,
    },
  ],
  edges: [],
  scenarios: [],
};
assert(
  validateWorkflow(llmCompliance).some((warning) => warning.code === "llm_compliance_decision"),
  "validator should reject LLM compliance decisions",
);

const privateEmployerMemory = {
  ...base,
  nodes: [
    {
      id: "bad-memory",
      type: "memory_context",
      label: "Bad memory",
      description: "Employer-facing private memory.",
      audience: "employer",
      memoryVisibility: "private",
      x: 0,
      y: 0,
    },
  ],
  edges: [],
  scenarios: [],
};
assert(
  validateWorkflow(privateEmployerMemory).some((warning) => warning.code === "private_worker_memory_employer_facing"),
  "validator should reject employer-facing private worker memory",
);
log("workflow validator rejects unsafe definitions");

const intake = V_WORKFLOWS.find((workflow) => workflow.id === "employer-booking-intake");
assert(intake, "employer intake workflow missing");
const intakeHappy = simulateWorkflow(intake, "happy_path");
assert(intakeHappy.path.includes("persist"), "happy path should create BookingRequest node");
assert(intakeHappy.path.includes("broadcast"), "happy path should reach broadcast node");

const intakeMissing = simulateWorkflow(intake, "missing_field");
assert(intakeMissing.decisions.some((decision) => decision.outcome === "clarify"), "missing field should clarify");

const compliance = V_WORKFLOWS.find((workflow) => workflow.id === "compliance-document-chase");
assert(compliance, "compliance workflow missing");
const complianceBlock = simulateWorkflow(compliance, "compliance_block");
assert(complianceBlock.blocked, "compliance scenario should be blocked");

const dynamicRate = V_WORKFLOWS.find((workflow) => workflow.id === "dynamic-rate-escalation");
assert(dynamicRate, "dynamic rate workflow missing");
const dynamicEscalation = simulateWorkflow(dynamicRate, "guardrail_escalation");
assert(dynamicEscalation.escalated, "Dynamic Rate L2 scenario should escalate");

const replacement = V_WORKFLOWS.find((workflow) => workflow.id === "replacement-recovery");
assert(replacement, "replacement workflow missing");
const replacementResult = simulateWorkflow(replacement, "replacement_rebroadcast");
assert(
  replacementResult.expectedAuditActions.includes("replacement.trigger"),
  "replacement scenario should include replacement.trigger audit",
);
log("workflow simulation scenarios resolve expected paths");

const { buildServer } = await import("../apps/api/src/index.ts");
const app = await buildServer();

const before = {
  audit: await app.db.auditEvent.count({ where: { action: "workflow.simulate" } }),
  bookings: await app.db.bookingRequest.count(),
  offers: await app.db.offer.count(),
  complianceDocs: await app.db.complianceDocument.count(),
  memories: await app.db.memoryEntry.count(),
  approvals: await app.db.pendingApproval.count(),
  negotiations: await app.db.negotiationRecord.count(),
};

const list = await injectJson(app, "GET", "/v1/admin/v-workflows");
assert(list.workflows?.length >= 7, "workflow list should include initial playbooks");
assert(workflowSummaries().length === list.workflows.length, "API summaries should match registry");

const detail = await injectJson(app, "GET", "/v1/admin/v-workflows/employer-booking-intake");
assert(detail.workflow?.id === "employer-booking-intake", "workflow detail should return requested workflow");

const simulation = await injectJson(app, "POST", "/v1/admin/v-workflows/employer-booking-intake/simulate", {
  scenarioId: "happy_path",
});
assert(simulation.result?.path?.includes("broadcast"), "API simulation should reach broadcast node");

const after = {
  audit: await app.db.auditEvent.count({ where: { action: "workflow.simulate" } }),
  bookings: await app.db.bookingRequest.count(),
  offers: await app.db.offer.count(),
  complianceDocs: await app.db.complianceDocument.count(),
  memories: await app.db.memoryEntry.count(),
  approvals: await app.db.pendingApproval.count(),
  negotiations: await app.db.negotiationRecord.count(),
};

assert(after.audit === before.audit + 1, "simulate should write exactly one workflow.simulate audit event");
assert(after.bookings === before.bookings, "simulate must not create booking requests");
assert(after.offers === before.offers, "simulate must not create offers");
assert(after.complianceDocs === before.complianceDocs, "simulate must not create compliance documents");
assert(after.memories === before.memories, "simulate must not create memories");
assert(after.approvals === before.approvals, "simulate must not create pending approvals");
assert(after.negotiations === before.negotiations, "simulate must not create negotiation records");
log("workflow API endpoints and audit-only simulation side effect verified");

await app.close();
await app.db.$disconnect();
