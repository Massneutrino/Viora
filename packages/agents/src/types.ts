import type {
  AutonomyLevel,
  Booking,
  ConversationChannel,
  Match,
  MemoryEdge,
  MemoryEntry,
  MemoryOwnerType,
  MemorySubjectType,
  Offer,
} from "@viora/domain";

/** Parsed staffing intent from natural language intake. */
export interface ParsedBookingIntent {
  roleType: string;
  siteId?: string;
  siteName?: string;
  startAt: Date;
  endAt: Date;
  payRate?: number;
  maxPayRate?: number;
  requirements?: Record<string, unknown>;
  missingFields: string[];
  confidence: number;
}

export interface VIntakeContext {
  organisationId: string;
  sites?: { id: string; name: string }[];
  memory?: {
    summary: string;
  };
  guardrails: {
    autonomyLevel: AutonomyLevel;
    budgetCeiling?: number;
    payFloor?: number;
    maxCommuteMinutes?: number;
    approvedRoleTypes: string[];
    escalationContacts: string[];
  };
}

/** Result of any agent action — always auditable. */
export interface AgentActionResult<T = unknown> {
  success: boolean;
  data?: T;
  explanation: string;
  requiresHumanApproval: boolean;
  auditPayload: Record<string, unknown>;
}

/** V — user-facing omnichannel agent. */
export interface VAgent {
  channel: ConversationChannel;
  parseIntent(rawInput: string, context: VIntakeContext): Promise<ParsedBookingIntent>;
  clarify(missingFields: string[], context: Record<string, unknown>): Promise<string>;
  confirmIntent(intent: ParsedBookingIntent): Promise<string>;
}

/** Employer Context Agent — works each open booking. */
export interface EmployerContextAgent {
  processRequest(
    bookingRequestId: string,
    offerId: string,
    workerId: string,
  ): Promise<AgentActionResult<Booking>>;
  monitorBooking(bookingId: string): Promise<AgentActionResult>;
  triggerReplacement(bookingId: string): Promise<AgentActionResult>;
}

/** Worker Context Agent — surfaces ranked opportunities. */
export interface WorkerContextAgent {
  surfaceNextOffer(workerId: string): Promise<AgentActionResult<Offer | null>>;
  explainFit(offerId: string): Promise<string>;
}

export interface MemoryEventInput {
  ownerType: MemoryOwnerType;
  ownerId: string;
  subjectType: MemorySubjectType;
  subjectId: string;
  sourceRefType: string;
  sourceRefId: string;
  text: string;
  data?: Record<string, unknown>;
}

export interface MemoryContext {
  entries: MemoryEntry[];
  edges: MemoryEdge[];
  summary: string;
}

/** Memory Agent — writes and retrieves Viora Memory. */
export interface MemoryAgent {
  rememberFromEvent(input: MemoryEventInput): Promise<AgentActionResult<MemoryEntry[]>>;
  recordOfferOutcome(offerId: string, outcome: "accepted" | "declined"): Promise<AgentActionResult>;
  recordShiftEvent(shiftId: string, outcome: string): Promise<AgentActionResult>;
  getOrganisationContext(organisationId: string, opts?: { siteId?: string }): Promise<MemoryContext>;
  getWorkerContext(workerId: string, opts?: { includePrivate?: boolean }): Promise<MemoryContext>;
  getOfferContext(offerId: string): Promise<MemoryContext>;
}

/** Market Agent — clears supply and demand. */
export interface MarketAgent {
  rankCandidates(
    bookingRequestId: string,
    limit?: number,
  ): Promise<AgentActionResult<Match[]>>;
  estimateFillProbability(bookingRequestId: string): Promise<number>;
  broadcastOffers(
    bookingRequestId: string,
    strategy: string,
    autonomyLevel: AutonomyLevel,
  ): Promise<AgentActionResult<Offer[]>>;
}

/** Trust and Compliance Agent — deterministic eligibility gates only. */
export interface TrustComplianceAgent {
  checkEligibility(workerId: string, bookingRequestId: string): Promise<{
    eligible: boolean;
    gates: Record<string, boolean>;
    reason?: string;
  }>;
}

/** A labelled count, e.g. one bucket of a status breakdown. */
export interface OpsCount {
  key: string;
  count: number;
}

/** Aggregate ops dashboard metrics — all read-only, computed on demand. */
export interface OpsStats {
  workforce: {
    totalWorkers: number;
    avgReliability: number | null;
    docsExpiringSoon: number;
    complianceDocs: OpsCount[];
  };
  funnel: {
    bookingRequests: OpsCount[];
    bookings: OpsCount[];
    offers: OpsCount[];
  };
  operations: {
    shifts: OpsCount[];
    auditOutcomes7d: OpsCount[];
  };
  financial: {
    invoices: OpsCount[];
    revenue: number;
    workerPayTotal: number;
    unapprovedTimesheets: number;
  };
}

/** Ops Agent — internal team support. */
export interface OpsAgent {
  getUnfilledShifts(): Promise<{ bookingRequestId: string; urgency: string }[]>;
  getMarketHealthSummary(): Promise<Record<string, unknown>>;
  getOpsStats(): Promise<OpsStats>;
}
