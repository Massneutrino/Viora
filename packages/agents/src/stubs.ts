import type {
  EmployerContextAgent,
  MarketAgent,
  OpsAgent,
  ParsedBookingIntent,
  TrustComplianceAgent,
  VAgent,
  WorkerContextAgent,
} from "./types.js";

/** Stub implementations for Phase 0 development — replace with LLM-backed agents. */
export const stubVAgent: VAgent = {
  channel: "web",
  async parseIntent(rawInput: string): Promise<ParsedBookingIntent> {
    return {
      roleType: "supply_teacher",
      startAt: new Date(),
      endAt: new Date(Date.now() + 7 * 60 * 60 * 1000),
      missingFields: ["siteId", "payRate"],
      confidence: 0.5,
    };
  },
  async clarify(missingFields: string[]): Promise<string> {
    return `I need a bit more information: ${missingFields.join(", ")}.`;
  },
  async confirmIntent(intent: ParsedBookingIntent): Promise<string> {
    return `Confirming: ${intent.roleType} from ${intent.startAt.toISOString()} to ${intent.endAt.toISOString()}.`;
  },
};

export const stubEmployerContextAgent: EmployerContextAgent = {
  async processRequest() {
    return {
      success: true,
      explanation: "Request queued for matching.",
      requiresHumanApproval: true,
      auditPayload: { agent: "employer_context", action: "process_request" },
    };
  },
  async monitorBooking() {
    return {
      success: true,
      explanation: "Booking monitored.",
      requiresHumanApproval: false,
      auditPayload: { agent: "employer_context", action: "monitor" },
    };
  },
  async triggerReplacement() {
    return {
      success: true,
      explanation: "Backup candidates notified.",
      requiresHumanApproval: true,
      auditPayload: { agent: "employer_context", action: "replacement" },
    };
  },
};

export const stubWorkerContextAgent: WorkerContextAgent = {
  async surfaceNextOffer() {
    return {
      success: true,
      data: null,
      explanation: "No offers available.",
      requiresHumanApproval: false,
      auditPayload: { agent: "worker_context", action: "surface_offer" },
    };
  },
  async explainFit() {
    return "This shift matches your role preferences and commute range.";
  },
};

export const stubMarketAgent: MarketAgent = {
  async rankCandidates() {
    return {
      success: true,
      data: [],
      explanation: "No eligible candidates found.",
      requiresHumanApproval: true,
      auditPayload: { agent: "market", action: "rank" },
    };
  },
  async estimateFillProbability() {
    return 0;
  },
  async broadcastOffers() {
    return {
      success: true,
      data: [],
      explanation: "Offers broadcast pending approval.",
      requiresHumanApproval: true,
      auditPayload: { agent: "market", action: "broadcast" },
    };
  },
};

export const stubTrustComplianceAgent: TrustComplianceAgent = {
  async checkEligibility() {
    return {
      eligible: false,
      gates: { dbs: false, rightToWork: false, safeguarding: false },
      reason: "Compliance verification pending.",
    };
  },
};

export const stubOpsAgent: OpsAgent = {
  async getUnfilledShifts() {
    return [];
  },
  async getMarketHealthSummary() {
    return { unfilledCount: 0, fillRate: 0 };
  },
  async getOpsStats() {
    return {
      workforce: { totalWorkers: 0, avgReliability: null, docsExpiringSoon: 0, complianceDocs: [] },
      funnel: { bookingRequests: [], bookings: [], offers: [] },
      operations: { shifts: [], auditOutcomes7d: [] },
      financial: { invoices: [], revenue: 0, workerPayTotal: 0, unapprovedTimesheets: 0 },
    };
  },
  async getMemoryImpactStats() {
    return {
      periodDays: { recent: 7, baseline: 30 },
      influence: {
        total7d: 0,
        total30d: 0,
        byPurpose30d: [],
        byAudience30d: [],
        byAction30d: [],
        byOutcome30d: [],
      },
      intake: {
        influencedTurns30d: 0,
        clarificationRequired30d: 0,
        pendingConfirmation30d: 0,
        clarificationRate30d: null,
      },
      ranking: {
        influencedBookingRequests30d: 0,
        offers30d: 0,
        resolvedOffers30d: 0,
        acceptedOffers30d: 0,
        offerAcceptanceRate30d: null,
        bookingsCreated30d: 0,
      },
      memoryUsage: {
        topMemories30d: [],
        topEdges30d: [],
        unusedActiveMemories: 0,
        unusedActiveMemoriesByKind: [],
      },
      privacy: {
        workerPrivateMemories: 0,
        employerFacingPrivateInfluenceCount30d: 0,
        leakedMemoryIds30d: [],
      },
    };
  },
};
