export type WorkflowNodeType =
  | "start"
  | "collect_field"
  | "llm_extract"
  | "deterministic_check"
  | "memory_context"
  | "message"
  | "api_action"
  | "human_approval"
  | "audit_event"
  | "end";

export type WorkflowAgent =
  | "v"
  | "market"
  | "memory"
  | "compliance"
  | "employer_context"
  | "worker_context"
  | "ops"
  | "admin"
  | "system";

export type WorkflowStatus = "active" | "draft" | "deprecated";
export type WorkflowAudience = "employer" | "worker" | "admin" | "agent" | "system";
export type WorkflowMemoryVisibility = "private" | "operational" | "shared";

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  label: string;
  description: string;
  agent?: WorkflowAgent;
  mayCallLLM?: boolean;
  mutatesState?: boolean;
  auditAction?: string;
  guardrailBoundary?: string;
  complianceBoundary?: string;
  memoryBoundary?: string;
  memoryVisibility?: WorkflowMemoryVisibility;
  audience?: WorkflowAudience;
  apiSurface?: string;
  x: number;
  y: number;
}

export interface WorkflowEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  condition?: string;
  tone?: "default" | "success" | "warning" | "danger";
}

export interface WorkflowSimulationMessage {
  audience: WorkflowAudience;
  text: string;
}

export interface WorkflowSimulationDecision {
  nodeId: string;
  outcome: "continue" | "clarify" | "blocked" | "escalated" | "degraded" | "complete";
  reason: string;
}

export interface WorkflowSimulationScenario {
  id: string;
  title: string;
  description: string;
  inputs: Record<string, unknown>;
  path: string[];
  messages: WorkflowSimulationMessage[];
  decisions: WorkflowSimulationDecision[];
  expectedAuditActions: string[];
}

export interface WorkflowDefinition {
  id: string;
  title: string;
  version: string;
  status: WorkflowStatus;
  description: string;
  tags: string[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  scenarios: WorkflowSimulationScenario[];
}

export interface WorkflowSummary {
  id: string;
  title: string;
  version: string;
  status: WorkflowStatus;
  description: string;
  tags: string[];
  nodeCount: number;
  scenarioCount: number;
  validationErrorCount: number;
}

export interface WorkflowValidationWarning {
  code: string;
  severity: "warning" | "error";
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface WorkflowSimulationResult {
  workflowId: string;
  workflowTitle: string;
  version: string;
  scenarioId: string;
  scenarioTitle: string;
  inputs: Record<string, unknown>;
  path: string[];
  nodes: WorkflowNode[];
  messages: WorkflowSimulationMessage[];
  decisions: WorkflowSimulationDecision[];
  expectedAuditActions: string[];
  validationWarnings: WorkflowValidationWarning[];
  blocked: boolean;
  escalated: boolean;
  degraded: boolean;
}

function edge(from: string, to: string, label?: string, tone?: WorkflowEdge["tone"]): WorkflowEdge {
  return { id: `${from}->${to}`, from, to, label, tone };
}

function hasPathEdge(workflow: WorkflowDefinition, from: string, to: string): boolean {
  return workflow.edges.some((candidate) => candidate.from === from && candidate.to === to);
}

function hasHumanApprovalNeighbour(workflow: WorkflowDefinition, node: WorkflowNode): boolean {
  const approvals = new Set(workflow.nodes.filter((candidate) => candidate.type === "human_approval").map((candidate) => candidate.id));
  return workflow.edges.some(
    (candidate) =>
      (candidate.from === node.id && approvals.has(candidate.to)) ||
      (candidate.to === node.id && approvals.has(candidate.from)),
  );
}

function actionLooksGuarded(action: string | undefined, label: string, apiSurface: string | undefined): boolean {
  const value = `${action ?? ""} ${label} ${apiSurface ?? ""}`.toLowerCase();
  return (
    value.includes("offers.broadcast") ||
    value.includes("booking.create") ||
    value.includes("replacement.trigger") ||
    value.includes("dynamic_rate") ||
    value.includes("dynamic rate") ||
    value.includes("broadcast") ||
    value.includes("booking creation")
  );
}

export function validateWorkflow(workflow: WorkflowDefinition): WorkflowValidationWarning[] {
  const warnings: WorkflowValidationWarning[] = [];
  const nodeIds = new Set(workflow.nodes.map((node) => node.id));

  for (const edge of workflow.edges) {
    if (!nodeIds.has(edge.from)) {
      warnings.push({
        code: "missing_edge_from",
        severity: "error",
        edgeId: edge.id,
        message: `Edge ${edge.id} starts at missing node ${edge.from}.`,
      });
    }
    if (!nodeIds.has(edge.to)) {
      warnings.push({
        code: "missing_edge_to",
        severity: "error",
        edgeId: edge.id,
        message: `Edge ${edge.id} points to missing node ${edge.to}.`,
      });
    }
  }

  for (const node of workflow.nodes) {
    if (node.mutatesState && !node.auditAction) {
      warnings.push({
        code: "mutating_node_without_audit",
        severity: "error",
        nodeId: node.id,
        message: `${node.label} mutates state but does not declare an audit action.`,
      });
    }

    if ((node.agent === "compliance" || node.complianceBoundary) && node.mayCallLLM) {
      warnings.push({
        code: "llm_compliance_decision",
        severity: "error",
        nodeId: node.id,
        message: `${node.label} is compliance-related but is marked as LLM-driven.`,
      });
    }

    if (node.audience === "employer" && node.memoryVisibility === "private") {
      warnings.push({
        code: "private_worker_memory_employer_facing",
        severity: "error",
        nodeId: node.id,
        message: `${node.label} exposes private memory to an employer-facing context.`,
      });
    }

    if (
      node.mutatesState &&
      actionLooksGuarded(node.auditAction, node.label, node.apiSurface) &&
      !node.guardrailBoundary &&
      !hasHumanApprovalNeighbour(workflow, node)
    ) {
      warnings.push({
        code: "guarded_action_without_boundary",
        severity: "error",
        nodeId: node.id,
        message: `${node.label} can mutate a guarded operational action without guardrail or approval metadata.`,
      });
    }
  }

  for (const scenario of workflow.scenarios) {
    for (let index = 0; index < scenario.path.length - 1; index += 1) {
      const from = scenario.path[index];
      const to = scenario.path[index + 1];
      if (!from || !to || !hasPathEdge(workflow, from, to)) {
        warnings.push({
          code: "scenario_path_missing_edge",
          severity: "error",
          message: `${scenario.title} uses a missing edge from ${from} to ${to}.`,
        });
      }
    }
  }

  return warnings;
}

export function workflowSummaries(workflows = V_WORKFLOWS): WorkflowSummary[] {
  return workflows.map((workflow) => {
    const validationErrorCount = validateWorkflow(workflow).filter((warning) => warning.severity === "error").length;
    return {
      id: workflow.id,
      title: workflow.title,
      version: workflow.version,
      status: workflow.status,
      description: workflow.description,
      tags: workflow.tags,
      nodeCount: workflow.nodes.length,
      scenarioCount: workflow.scenarios.length,
      validationErrorCount,
    };
  });
}

export function findWorkflow(id: string, workflows = V_WORKFLOWS): WorkflowDefinition | undefined {
  return workflows.find((workflow) => workflow.id === id);
}

export function simulateWorkflow(
  workflow: WorkflowDefinition,
  scenarioId: string,
  inputs: Record<string, unknown> = {},
): WorkflowSimulationResult {
  const scenario = workflow.scenarios.find((candidate) => candidate.id === scenarioId);
  if (!scenario) throw new Error(`Unknown workflow scenario: ${scenarioId}`);

  const nodeById = new Map(workflow.nodes.map((node) => [node.id, node]));
  const nodes = scenario.path.map((nodeId) => {
    const node = nodeById.get(nodeId);
    if (!node) throw new Error(`Scenario ${scenario.id} references missing node ${nodeId}`);
    return node;
  });
  const decisions = scenario.decisions;

  return {
    workflowId: workflow.id,
    workflowTitle: workflow.title,
    version: workflow.version,
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    inputs: { ...scenario.inputs, ...inputs },
    path: scenario.path,
    nodes,
    messages: scenario.messages,
    decisions,
    expectedAuditActions: scenario.expectedAuditActions,
    validationWarnings: validateWorkflow(workflow),
    blocked: decisions.some((decision) => decision.outcome === "blocked"),
    escalated: decisions.some((decision) => decision.outcome === "escalated"),
    degraded: decisions.some((decision) => decision.outcome === "degraded"),
  };
}

const employerBookingIntake: WorkflowDefinition = {
  id: "employer-booking-intake",
  title: "Employer Booking Intake",
  version: "0.1.0",
  status: "active",
  description: "V captures an employer staffing request, clarifies missing details, confirms intent, and hands off to matching.",
  tags: ["employer", "intake", "booking", "phase0"],
  nodes: [
    { id: "start", type: "start", label: "Employer asks V", description: "Employer sends a booking request through web, WhatsApp, or voice.", agent: "v", x: 40, y: 190 },
    { id: "load-context", type: "memory_context", label: "Load org context", description: "Load sites, guardrails, and purpose-scoped organisation memory.", agent: "memory", auditAction: "memory.influence", memoryVisibility: "operational", audience: "employer", memoryBoundary: "Organisation memory can suggest defaults only; it cannot override latest user input.", x: 260, y: 190 },
    { id: "parse", type: "llm_extract", label: "Parse intent", description: "Use createLLMClient().structured() to extract role, site, time, rate, and requirements.", agent: "v", mayCallLLM: true, apiSurface: "processIntakeTurn -> vAgent.parseIntent", x: 500, y: 190 },
    { id: "fallback", type: "message", label: "LLM fallback", description: "Use deterministic fallback if the provider is unavailable.", agent: "v", auditAction: "intake.parse", x: 500, y: 330 },
    { id: "missing", type: "deterministic_check", label: "Missing fields?", description: "Server-side checks validate required fields and guardrail ranges.", agent: "system", guardrailBoundary: "Budget, pay floor, role approval, and required fields are deterministic checks.", x: 740, y: 190 },
    { id: "clarify", type: "message", label: "Ask clarification", description: "V asks for at most two missing details.", agent: "v", mayCallLLM: true, auditAction: "intake.clarify", x: 980, y: 90 },
    { id: "persist", type: "api_action", label: "Create BookingRequest", description: "Persist a pending booking request only after required fields are available.", agent: "v", mutatesState: true, auditAction: "intake.confirm", guardrailBoundary: "Creates pending_confirmation only; matching still follows guardrails.", apiSurface: "POST /v1/intake/parse", x: 980, y: 255 },
    { id: "broadcast", type: "api_action", label: "Rank and broadcast", description: "Market agent ranks compliant candidates and broadcasts offers subject to guardrails.", agent: "market", mutatesState: true, auditAction: "offers.broadcast", guardrailBoundary: "Autonomy, budget, Dynamic Rate, and approval queue apply before mutation.", apiSurface: "market.rankCandidates + market.broadcastOffers", x: 1220, y: 255 },
    { id: "end", type: "end", label: "Employer sees status", description: "Employer receives confirmation or clarification and can continue the conversation.", agent: "v", x: 1460, y: 190 },
  ],
  edges: [
    edge("start", "load-context"),
    edge("load-context", "parse"),
    edge("parse", "missing"),
    edge("parse", "fallback", "LLM unavailable", "warning"),
    edge("fallback", "clarify", "degraded clarification", "warning"),
    edge("missing", "clarify", "missing details", "warning"),
    edge("clarify", "end"),
    edge("missing", "persist", "complete intent", "success"),
    edge("persist", "broadcast"),
    edge("broadcast", "end"),
  ],
  scenarios: [
    {
      id: "happy_path",
      title: "Happy path",
      description: "All required booking details are present and matching starts.",
      inputs: { rawInput: "Need a KS2 supply teacher at Greenfield tomorrow, GBP 160." },
      path: ["start", "load-context", "parse", "missing", "persist", "broadcast", "end"],
      messages: [{ audience: "employer", text: "I have captured the request and V is matching eligible workers now." }],
      decisions: [
        { nodeId: "missing", outcome: "continue", reason: "Required fields are present and within guardrails." },
        { nodeId: "broadcast", outcome: "continue", reason: "Broadcast proceeds through Market Agent guardrails." },
      ],
      expectedAuditActions: ["memory.influence", "intake.parse", "intake.confirm", "offers.broadcast"],
    },
    {
      id: "missing_field",
      title: "Missing field clarification",
      description: "V asks for the missing pay rate instead of creating a booking.",
      inputs: { rawInput: "Need a teaching assistant at Greenfield tomorrow." },
      path: ["start", "load-context", "parse", "missing", "clarify", "end"],
      messages: [{ audience: "employer", text: "Could you confirm the pay rate for that shift?" }],
      decisions: [{ nodeId: "missing", outcome: "clarify", reason: "payRate is absent." }],
      expectedAuditActions: ["memory.influence", "intake.parse", "intake.clarify"],
    },
    {
      id: "llm_unavailable",
      title: "LLM unavailable fallback",
      description: "The provider fails and V uses a deterministic fallback question.",
      inputs: { provider: "unavailable" },
      path: ["start", "load-context", "parse", "fallback", "clarify", "end"],
      messages: [{ audience: "employer", text: "I need the role, site, date and time, and pay rate to book this correctly." }],
      decisions: [{ nodeId: "fallback", outcome: "degraded", reason: "No live LLM call is required for fallback copy." }],
      expectedAuditActions: ["intake.parse", "intake.clarify"],
    },
  ],
};

const workerPassportOnboarding: WorkflowDefinition = {
  id: "worker-passport-onboarding",
  title: "Worker Passport Onboarding",
  version: "0.1.0",
  status: "active",
  description: "A worker completes profile and Passport evidence before becoming eligible for regulated work.",
  tags: ["worker", "passport", "compliance"],
  nodes: [
    { id: "start", type: "start", label: "Worker opens Passport", description: "Worker enters the Passport tab.", agent: "worker_context", x: 40, y: 170 },
    { id: "collect", type: "collect_field", label: "Collect profile and docs", description: "Capture personal details, roles, radius, and document upload metadata.", agent: "worker_context", x: 280, y: 170 },
    { id: "upload", type: "api_action", label: "Store document", description: "Upload document content and metadata to local storage.", agent: "system", mutatesState: true, auditAction: "compliance.document.upload", apiSurface: "POST /v1/workers/:id/compliance/upload", x: 520, y: 170 },
    { id: "queue", type: "human_approval", label: "Manual verification", description: "Ops verifies or rejects each document in Phase 0.", agent: "admin", auditAction: "compliance.document.review", complianceBoundary: "Eligibility waits for deterministic document status updates.", x: 760, y: 170 },
    { id: "eligible", type: "deterministic_check", label: "Eligibility check", description: "Compliance agent uses deterministic sector gates.", agent: "compliance", complianceBoundary: "isEligibleForEducationBooking() remains the only education eligibility source.", x: 1000, y: 170 },
    { id: "message", type: "message", label: "Show Passport status", description: "Worker sees pending, verified, expired, or rejected state.", agent: "worker_context", x: 1240, y: 170 },
    { id: "end", type: "end", label: "Passport updated", description: "Passport remains visible with downloadable documents and status.", x: 1460, y: 170 },
  ],
  edges: [
    edge("start", "collect"),
    edge("collect", "upload"),
    edge("upload", "queue"),
    edge("queue", "eligible"),
    edge("queue", "message", "awaiting review", "warning"),
    edge("eligible", "message"),
    edge("message", "end"),
  ],
  scenarios: [
    {
      id: "documents_pending",
      title: "Documents pending",
      description: "Worker uploads evidence and waits for manual review.",
      inputs: { workerId: "demo-worker", documentType: "enhanced_dbs" },
      path: ["start", "collect", "upload", "queue", "message", "end"],
      messages: [{ audience: "worker", text: "Your document is uploaded and waiting for verification." }],
      decisions: [{ nodeId: "queue", outcome: "escalated", reason: "Phase 0 compliance verification is manual." }],
      expectedAuditActions: ["compliance.document.upload", "compliance.document.review"],
    },
  ],
};

const complianceDocumentChase: WorkflowDefinition = {
  id: "compliance-document-chase",
  title: "Compliance Document Chase",
  version: "0.1.0",
  status: "active",
  description: "V nudges missing or expiring worker documents without making eligibility judgments itself.",
  tags: ["worker", "compliance", "nudges"],
  nodes: [
    { id: "start", type: "start", label: "Compliance gap detected", description: "Admin queue or Passport state shows missing evidence.", agent: "compliance", x: 40, y: 170 },
    { id: "check", type: "deterministic_check", label: "Check required evidence", description: "Compare Passport statuses against sector requirements.", agent: "compliance", complianceBoundary: "Deterministic statuses only; no LLM eligibility inference.", x: 300, y: 170 },
    { id: "message", type: "message", label: "Ask worker for document", description: "V explains the missing document in worker-safe language.", agent: "v", mayCallLLM: true, x: 560, y: 90 },
    { id: "block", type: "message", label: "Block regulated booking", description: "Worker remains ineligible for affected bookings until verification passes.", agent: "compliance", complianceBoundary: "Compliance block is deterministic.", x: 560, y: 250 },
    { id: "audit", type: "audit_event", label: "Audit compliance outcome", description: "Record the nudge or block reason.", agent: "system", auditAction: "compliance.document.chase", x: 830, y: 170 },
    { id: "end", type: "end", label: "Await upload or review", description: "Worker can upload evidence; admin reviews it.", x: 1080, y: 170 },
  ],
  edges: [
    edge("start", "check"),
    edge("check", "message", "missing or expiring", "warning"),
    edge("check", "block", "booking eligibility fails", "danger"),
    edge("message", "audit"),
    edge("block", "audit"),
    edge("audit", "end"),
  ],
  scenarios: [
    {
      id: "compliance_block",
      title: "Compliance block",
      description: "An unverified DBS blocks a regulated education booking.",
      inputs: { workerId: "demo-worker-5", documentType: "enhanced_dbs" },
      path: ["start", "check", "block", "audit", "end"],
      messages: [{ audience: "admin", text: "Worker is blocked for this booking until enhanced DBS is verified." }],
      decisions: [{ nodeId: "check", outcome: "blocked", reason: "Enhanced DBS is not verified." }],
      expectedAuditActions: ["compliance.document.chase"],
    },
  ],
};

const offerExplanation: WorkflowDefinition = {
  id: "offer-explanation-accept-decline",
  title: "Offer Explanation and Accept/Decline",
  version: "0.1.0",
  status: "active",
  description: "Worker sees the next offer, safe fit reasons, and accepts or declines.",
  tags: ["worker", "offers", "memory"],
  nodes: [
    { id: "start", type: "start", label: "Worker opens feed", description: "Worker web/mobile requests next offer.", agent: "worker_context", x: 40, y: 180 },
    { id: "surface", type: "api_action", label: "Surface next offer", description: "Return the highest-ranked pending offer for this worker.", agent: "worker_context", auditAction: "offer.surface", apiSurface: "GET /v1/workers/:id/offer", x: 300, y: 180 },
    { id: "memory", type: "memory_context", label: "Worker-safe memory reasons", description: "Fetch worker-facing context; own private memory may be explained only to the worker.", agent: "memory", auditAction: "memory.influence", memoryVisibility: "private", audience: "worker", memoryBoundary: "Private worker memory is never sent to employer-facing shortlist copy.", x: 560, y: 180 },
    { id: "explain", type: "message", label: "Explain fit", description: "V explains why the offer matches in worker-safe language.", agent: "worker_context", mayCallLLM: true, apiSurface: "explainFit(offerId)", x: 820, y: 180 },
    { id: "accept", type: "api_action", label: "Accept offer", description: "Accept the offer and create booking through employer context agent if allowed.", agent: "employer_context", mutatesState: true, auditAction: "booking.create", guardrailBoundary: "Booking creation checks compliance and guardrails, or queues approval.", apiSurface: "POST /v1/workers/:id/offers/:offerId/accept", x: 1080, y: 90 },
    { id: "decline", type: "api_action", label: "Decline offer", description: "Decline the offer and record learning signal.", agent: "worker_context", mutatesState: true, auditAction: "offer.decline", apiSurface: "POST /v1/workers/:id/offers/:offerId/decline", x: 1080, y: 270 },
    { id: "end", type: "end", label: "Feed updated", description: "Worker sees booking confirmation or the next available offer.", x: 1340, y: 180 },
  ],
  edges: [
    edge("start", "surface"),
    edge("surface", "memory"),
    edge("memory", "explain"),
    edge("explain", "end", "view only"),
    edge("explain", "accept", "worker accepts", "success"),
    edge("explain", "decline", "worker declines", "warning"),
    edge("accept", "end"),
    edge("decline", "end"),
  ],
  scenarios: [
    {
      id: "memory_boundary",
      title: "Worker private memory explanation",
      description: "Private worker memory is safe in worker-facing offer explanation.",
      inputs: { workerId: "demo-worker", offerId: "offer-demo" },
      path: ["start", "surface", "memory", "explain", "end"],
      messages: [{ audience: "worker", text: "This matches your preferred commute and recent KS2 confidence signal." }],
      decisions: [{ nodeId: "memory", outcome: "continue", reason: "Audience is worker, so own private memory can be explained." }],
      expectedAuditActions: ["offer.surface", "memory.influence"],
    },
    {
      id: "accept_offer",
      title: "Accept offer",
      description: "Worker accepts and booking creation proceeds through compliance and guardrails.",
      inputs: { offerId: "offer-demo" },
      path: ["start", "surface", "memory", "explain", "accept", "end"],
      messages: [{ audience: "worker", text: "You are booked. V has updated the employer." }],
      decisions: [{ nodeId: "accept", outcome: "continue", reason: "Booking creation remains guarded." }],
      expectedAuditActions: ["offer.surface", "memory.influence", "booking.create"],
    },
  ],
};

const replacementRecovery: WorkflowDefinition = {
  id: "replacement-recovery",
  title: "Replacement Recovery",
  version: "0.1.0",
  status: "active",
  description: "V reacts to a cancelled or at-risk booking and reopens the market safely.",
  tags: ["operations", "replacement", "self-healing"],
  nodes: [
    { id: "start", type: "start", label: "Booking at risk", description: "Cancellation, no-show, or admin action marks a booking at risk.", agent: "employer_context", x: 40, y: 180 },
    { id: "cancel", type: "api_action", label: "Cancel or reopen booking", description: "Admin or system marks the booking state.", agent: "admin", mutatesState: true, auditAction: "booking.cancel", apiSurface: "POST /v1/admin/bookings/:id/cancel", x: 300, y: 180 },
    { id: "guardrail", type: "deterministic_check", label: "Replacement allowed?", description: "Check autonomy level, budget, role, and backup-worker constraints.", agent: "employer_context", guardrailBoundary: "Replacement is blocked or queued if guardrails require review.", x: 560, y: 180 },
    { id: "approval", type: "human_approval", label: "Queue approval", description: "Ops signs off if replacement exceeds autonomy.", agent: "admin", auditAction: "replacement.trigger", x: 820, y: 80 },
    { id: "rebroadcast", type: "api_action", label: "Trigger replacement", description: "Use backup workers or ranked matching to rebroadcast.", agent: "employer_context", mutatesState: true, auditAction: "replacement.trigger", guardrailBoundary: "Uses approved replacement path only.", apiSurface: "employer.triggerReplacement(bookingId)", x: 820, y: 260 },
    { id: "audit", type: "audit_event", label: "Recovery audit", description: "Record cancellation, reopen, and replacement outcomes.", agent: "system", auditAction: "replacement.trigger", x: 1080, y: 180 },
    { id: "end", type: "end", label: "Replacement activity visible", description: "Admin recovery activity and employer status update.", x: 1320, y: 180 },
  ],
  edges: [
    edge("start", "cancel"),
    edge("cancel", "guardrail"),
    edge("guardrail", "approval", "needs approval", "warning"),
    edge("approval", "rebroadcast", "approved", "success"),
    edge("guardrail", "rebroadcast", "allowed", "success"),
    edge("rebroadcast", "audit"),
    edge("audit", "end"),
  ],
  scenarios: [
    {
      id: "replacement_rebroadcast",
      title: "Replacement rebroadcast",
      description: "A cancelled booking is reopened and replacement offers are sent.",
      inputs: { bookingId: "demo-booking" },
      path: ["start", "cancel", "guardrail", "rebroadcast", "audit", "end"],
      messages: [{ audience: "admin", text: "Replacement triggered and recovery activity recorded." }],
      decisions: [{ nodeId: "guardrail", outcome: "continue", reason: "Replacement is within configured autonomy." }],
      expectedAuditActions: ["booking.cancel", "replacement.trigger"],
    },
    {
      id: "replacement_approval",
      title: "Replacement requires approval",
      description: "Guardrails queue the replacement before offers mutate.",
      inputs: { autonomyLevel: "L1" },
      path: ["start", "cancel", "guardrail", "approval", "rebroadcast", "audit", "end"],
      messages: [{ audience: "admin", text: "Replacement is queued for approval before rebroadcast." }],
      decisions: [{ nodeId: "approval", outcome: "escalated", reason: "Autonomy level requires human sign-off." }],
      expectedAuditActions: ["booking.cancel", "replacement.trigger"],
    },
  ],
};

const postShiftFeedback: WorkflowDefinition = {
  id: "post-shift-feedback-memory",
  title: "Post-shift Feedback and Memory Confirmation",
  version: "0.1.0",
  status: "active",
  description: "Feedback writes audit rows and proposes memory only through review-gated learning.",
  tags: ["feedback", "memory", "review"],
  nodes: [
    { id: "start", type: "start", label: "Shift complete", description: "Worker checks out or admin completes timesheet flow.", agent: "worker_context", x: 40, y: 180 },
    { id: "collect", type: "collect_field", label: "Collect feedback", description: "Employer or worker gives rating/comment.", agent: "v", x: 300, y: 180 },
    { id: "persist", type: "api_action", label: "Write feedback", description: "Persist Feedback and audit the submission.", agent: "system", mutatesState: true, auditAction: "feedback.create", apiSurface: "POST /v1/workers/:id/feedback", x: 560, y: 180 },
    { id: "infer", type: "llm_extract", label: "Infer memory candidate", description: "Memory agent may propose briefing or fit feedback from repeated signals.", agent: "memory", mayCallLLM: true, auditAction: "memory.feedback.learn", x: 820, y: 180 },
    { id: "review", type: "human_approval", label: "Review memory suggestion", description: "Ops confirms, rejects, or applies suggestions before operational use.", agent: "admin", auditAction: "memory.review", memoryBoundary: "Ranking-affecting learning remains review-gated.", x: 1080, y: 180 },
    { id: "end", type: "end", label: "Learning reviewed", description: "Confirmed memory can be used within scoped retrieval thresholds.", x: 1340, y: 180 },
  ],
  edges: [
    edge("start", "collect"),
    edge("collect", "persist"),
    edge("persist", "infer"),
    edge("infer", "review"),
    edge("review", "end"),
  ],
  scenarios: [
    {
      id: "review_gated_learning",
      title: "Review-gated learning",
      description: "Repeated positive feedback creates a review suggestion, not automatic ranking mutation.",
      inputs: { feedback: "Great fit for KS2 mornings." },
      path: ["start", "collect", "persist", "infer", "review", "end"],
      messages: [{ audience: "admin", text: "Memory suggestion awaits review before operational use." }],
      decisions: [{ nodeId: "review", outcome: "escalated", reason: "Memory mutation that may influence operations requires review." }],
      expectedAuditActions: ["feedback.create", "memory.feedback.learn", "memory.review"],
    },
  ],
};

const dynamicRateEscalation: WorkflowDefinition = {
  id: "dynamic-rate-escalation",
  title: "Dynamic Rate Escalation",
  version: "0.1.0",
  status: "active",
  description: "Dynamic Rate clears within worker floors and employer ceilings only when autonomy and guardrails allow it.",
  tags: ["dynamic-rate", "guardrails", "market"],
  nodes: [
    { id: "start", type: "start", label: "Dynamic request", description: "Employer asks V to adjust pay within a ceiling.", agent: "v", x: 40, y: 180 },
    { id: "parse", type: "llm_extract", label: "Capture ceiling", description: "Extract payRate/maxPayRate but do not decide clearing.", agent: "v", mayCallLLM: true, x: 300, y: 180 },
    { id: "guardrail", type: "deterministic_check", label: "Check Dynamic Rate guardrails", description: "Require maxPayRate, worker pay floors, and L3 autonomy for clearing.", agent: "market", guardrailBoundary: "Missing ceiling, floors above ceiling, or low autonomy block mutation.", x: 560, y: 180 },
    { id: "approval", type: "human_approval", label: "Queue rate approval", description: "Low autonomy or risky changes go to PendingApproval.", agent: "admin", auditAction: "offers.broadcast", x: 820, y: 80 },
    { id: "clear", type: "api_action", label: "Clear rate and broadcast", description: "Create NegotiationRecord and offers at the agreed rate.", agent: "market", mutatesState: true, auditAction: "dynamic_rate.clear", guardrailBoundary: "Only L3+ can clear autonomously within ceiling/floor constraints.", apiSurface: "market.broadcastOffers(rateMode=dynamic)", x: 820, y: 260 },
    { id: "audit", type: "audit_event", label: "Rate explanation audit", description: "Record floor, ceiling, agreed rate, and explanation.", agent: "system", auditAction: "dynamic_rate.clear", x: 1080, y: 180 },
    { id: "end", type: "end", label: "Offer explains rate", description: "Worker and admin see transparent rate reasoning.", x: 1340, y: 180 },
  ],
  edges: [
    edge("start", "parse"),
    edge("parse", "guardrail"),
    edge("guardrail", "end", "blocked", "danger"),
    edge("guardrail", "approval", "below L3 or risky", "warning"),
    edge("approval", "clear", "approved", "success"),
    edge("guardrail", "clear", "L3 allowed", "success"),
    edge("clear", "audit"),
    edge("audit", "end"),
  ],
  scenarios: [
    {
      id: "guardrail_escalation",
      title: "Guardrail escalation",
      description: "L2 Dynamic Rate request queues approval before broadcast.",
      inputs: { rateMode: "dynamic", autonomyLevel: "L2", maxPayRate: 190 },
      path: ["start", "parse", "guardrail", "approval", "clear", "audit", "end"],
      messages: [{ audience: "admin", text: "Dynamic Rate needs approval before V broadcasts adjusted offers." }],
      decisions: [{ nodeId: "approval", outcome: "escalated", reason: "Dynamic Rate clearing requires L3 autonomy." }],
      expectedAuditActions: ["offers.broadcast", "dynamic_rate.clear"],
    },
    {
      id: "floor_above_ceiling",
      title: "Worker floor above ceiling",
      description: "Clearing is blocked when the available worker floor exceeds employer ceiling.",
      inputs: { maxPayRate: 150, workerFloor: 175 },
      path: ["start", "parse", "guardrail", "end"],
      messages: [{ audience: "admin", text: "No Dynamic Rate offer can be cleared because worker floor exceeds employer ceiling." }],
      decisions: [{ nodeId: "guardrail", outcome: "blocked", reason: "Worker floor is above employer ceiling." }],
      expectedAuditActions: ["dynamic_rate.clear"],
    },
  ],
};

export const V_WORKFLOWS: WorkflowDefinition[] = [
  employerBookingIntake,
  workerPassportOnboarding,
  complianceDocumentChase,
  offerExplanation,
  replacementRecovery,
  postShiftFeedback,
  dynamicRateEscalation,
];
