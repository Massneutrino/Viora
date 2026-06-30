/** Phase 0 pilot scope boundaries (PRD §12). */
export const PHASE_0 = {
  geography: "single_dense_cluster",
  employerCount: { min: 3, max: 10 },
  workerCount: { min: 50, max: 200 },
  durationWeeks: { min: 10, max: 12 },
  defaultAutonomyLevels: ["L1", "L2"] as const,
  intakeChannels: ["app", "whatsapp"] as const,
  complianceVerification: "manual_ops",
  payroll: "export_only",
} as const;

export const PHASE_0_MUST_HAVE = [
  "v_natural_language_intake",
  "structured_booking_creation",
  "compliance_eligibility_gates",
  "candidate_ranking_explainable_shortlist",
  "worker_opportunity_feed",
  "booking_confirmation",
  "check_in_check_out",
  "self_healing_replacement_basic",
  "employer_guardrail_policy",
  "timesheet_generation",
  "timesheet_approval",
  "invoice_payroll_export",
  "employer_web_dashboard",
  "worker_mobile_app",
  "worker_schedule_view",
  "employer_schedule_view",
  "worker_availability_management",
  "admin_console",
  "audit_logs",
  "human_override",
] as const;

export const PHASE_0_SUCCESS_METRICS = {
  conversationalIntakeRate: 0.7,
  intentCaptureAccuracy: 0.95,
  medianTimeToFillMinutes: 12,
  fillRateWithin12Hours: 0.9,
  swipeDeckConversionMultiplier: 2,
  employerSatisfaction: 8,
  workerNps: 40,
  complianceGateAccuracy: 0,
} as const;
