import type {
  AutonomyLevel,
  BookingRequest,
  ConversationChannel,
  GuardrailPolicy,
  Match,
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
  parseIntent(rawInput: string, context: { organisationId: string }): Promise<ParsedBookingIntent>;
  clarify(missingFields: string[], context: Record<string, unknown>): Promise<string>;
  confirmIntent(intent: ParsedBookingIntent): Promise<string>;
}

/** Employer Context Agent — works each open booking. */
export interface EmployerContextAgent {
  processRequest(
    intent: ParsedBookingIntent,
    policy: GuardrailPolicy,
  ): Promise<AgentActionResult<BookingRequest>>;
  monitorBooking(bookingId: string): Promise<AgentActionResult>;
  triggerReplacement(bookingId: string): Promise<AgentActionResult>;
}

/** Worker Context Agent — surfaces ranked opportunities. */
export interface WorkerContextAgent {
  surfaceNextOffer(workerId: string): Promise<AgentActionResult<Offer | null>>;
  explainFit(offerId: string): Promise<string>;
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

/** Ops Agent — internal team support. */
export interface OpsAgent {
  getUnfilledShifts(): Promise<{ bookingRequestId: string; urgency: string }[]>;
  getMarketHealthSummary(): Promise<Record<string, unknown>>;
}
