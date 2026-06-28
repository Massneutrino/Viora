import type { MemoryKind } from "./index.js";

export type MemoryValueType =
  | "site_instruction"
  | "worker_availability"
  | "commute_preference"
  | "pay_expectation"
  | "role_confidence"
  | "briefing_note"
  | "worker_relationship"
  | "cpd_training_signal"
  | "procedural_playbook";

export type CpdTrainingSignalType =
  | "skill_interest"
  | "confidence_gap"
  | "completed_cpd"
  | "required_induction"
  | "expiring_training"
  | "employer_requested_training"
  | "training_impact_evidence";

export type MemoryTypedValue =
  | SiteInstructionMemoryValue
  | WorkerAvailabilityMemoryValue
  | CommutePreferenceMemoryValue
  | PayExpectationMemoryValue
  | RoleConfidenceMemoryValue
  | BriefingNoteMemoryValue
  | WorkerRelationshipMemoryValue
  | CpdTrainingSignalMemoryValue
  | ProceduralPlaybookMemoryValue;

export interface SiteInstructionMemoryValue {
  valueType: "site_instruction";
  instruction: string;
  appliesTo?: string[];
  priority?: "low" | "normal" | "high";
}

export interface WorkerAvailabilityMemoryValue {
  valueType: "worker_availability";
  availability: "available" | "unavailable" | "prefers" | "avoids";
  daysOfWeek?: string[];
  timeWindows?: Array<{ start: string; end: string }>;
  effectiveFrom?: string;
  effectiveUntil?: string;
}

export interface CommutePreferenceMemoryValue {
  valueType: "commute_preference";
  maxMinutes?: number;
  preferredTransport?: string;
  exception?: string;
}

export interface PayExpectationMemoryValue {
  valueType: "pay_expectation";
  minimumRate?: number;
  preferredRate?: number;
  currency: "GBP";
  rateUnit: "hour" | "day" | "shift";
}

export interface RoleConfidenceMemoryValue {
  valueType: "role_confidence";
  roleType: string;
  confidence: number;
  evidence?: string;
}

export interface BriefingNoteMemoryValue {
  valueType: "briefing_note";
  note: string;
  audience: "worker" | "employer" | "admin";
  priority?: "low" | "normal" | "high";
}

export interface WorkerRelationshipMemoryValue {
  valueType: "worker_relationship";
  workerId: string;
  relationship: "preferred" | "blocked";
  reason?: string;
}

export interface CpdTrainingSignalMemoryValue {
  valueType: "cpd_training_signal";
  signalType: CpdTrainingSignalType;
  trainingName: string;
  status: "completed" | "in_progress" | "expired" | "recommended";
  roleTypes?: string[];
  sector?: "education" | "security" | "care" | "hospitality" | "logistics" | "events";
  provider?: string;
  completedAt?: string;
  expiresAt?: string;
  evidenceRef?: string;
  impact?: string;
  requestedByOrganisationId?: string;
}

export interface ProceduralPlaybookMemoryValue {
  valueType: "procedural_playbook";
  playbookType: "intake_clarification";
  trigger: {
    organisationId: string;
    siteId?: string;
    roleType?: string;
    missingFields: string[];
  };
  guidance: string;
  evidence: {
    eventIds: string[];
    count: number;
    windowDays: number;
  };
  guardrails: {
    reviewRequired: true;
    rankingImpact: "none";
    complianceImpact: "none";
  };
}

export interface MemoryValueValidationResult {
  ok: boolean;
  value?: Record<string, unknown>;
  valueType?: MemoryValueType;
  errors: string[];
}

const VALUE_TYPES = new Set<MemoryValueType>([
  "site_instruction",
  "worker_availability",
  "commute_preference",
  "pay_expectation",
  "role_confidence",
  "briefing_note",
  "worker_relationship",
  "cpd_training_signal",
  "procedural_playbook",
]);

const CPD_SIGNAL_TYPES = new Set<CpdTrainingSignalType>([
  "skill_interest",
  "confidence_gap",
  "completed_cpd",
  "required_induction",
  "expiring_training",
  "employer_requested_training",
  "training_impact_evidence",
]);

const CPD_RANKING_ELIGIBLE_SIGNAL_TYPES = new Set<CpdTrainingSignalType>([
  "completed_cpd",
  "training_impact_evidence",
]);

const EXPECTED_KIND: Partial<Record<MemoryValueType, MemoryKind[]>> = {
  site_instruction: ["instruction"],
  worker_availability: ["availability_signal", "preference"],
  commute_preference: ["preference"],
  pay_expectation: ["pay_signal", "preference"],
  role_confidence: ["fit_signal"],
  briefing_note: ["briefing_note"],
  worker_relationship: ["preference", "risk", "fit_signal"],
  cpd_training_signal: ["preference", "fit_signal", "briefing_note", "feedback_summary"],
  procedural_playbook: ["pattern"],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isEnum<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && allowed.includes(value as T);
}

function stringArray(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every(isString));
}

function isoDateString(value: unknown): boolean {
  return value === undefined || (isString(value) && !Number.isNaN(Date.parse(value)));
}

function timeWindowArray(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.every((item) => isRecord(item) && isString(item.start) && isString(item.end)))
  );
}

function isCpdSignalType(value: unknown): value is CpdTrainingSignalType {
  return typeof value === "string" && CPD_SIGNAL_TYPES.has(value as CpdTrainingSignalType);
}

function nestedRecord(value: unknown, label: string, errors: string[]): Record<string, unknown> | null {
  if (!isRecord(value)) {
    errors.push(`${label} must be an object.`);
    return null;
  }
  return value;
}

function addKindWarning(errors: string[], valueType: MemoryValueType, kind: MemoryKind) {
  const expected = EXPECTED_KIND[valueType];
  if (expected && !expected.includes(kind)) {
    errors.push(`valueType ${valueType} is not expected for memory kind ${kind}.`);
  }
}

export function validateMemoryValue(kind: MemoryKind, value: unknown): MemoryValueValidationResult {
  if (value === undefined || value === null) return { ok: true, errors: [] };
  if (!isRecord(value)) return { ok: false, errors: ["Memory value must be an object."] };

  const rawValueType = value.valueType;
  if (rawValueType === undefined) return { ok: true, value, errors: [] };
  if (!isEnum(rawValueType, [...VALUE_TYPES])) {
    return { ok: false, errors: [`Unknown memory valueType ${String(rawValueType)}.`] };
  }

  const valueType = rawValueType;
  const errors: string[] = [];
  addKindWarning(errors, valueType, kind);

  if (valueType === "site_instruction") {
    if (!isString(value.instruction)) errors.push("site_instruction.instruction is required.");
    if (!stringArray(value.appliesTo)) errors.push("site_instruction.appliesTo must be a string array.");
    if (value.priority !== undefined && !isEnum(value.priority, ["low", "normal", "high"])) {
      errors.push("site_instruction.priority must be low, normal, or high.");
    }
  }

  if (valueType === "worker_availability") {
    if (!isEnum(value.availability, ["available", "unavailable", "prefers", "avoids"])) {
      errors.push("worker_availability.availability is required.");
    }
    if (!stringArray(value.daysOfWeek)) errors.push("worker_availability.daysOfWeek must be a string array.");
    if (!timeWindowArray(value.timeWindows)) errors.push("worker_availability.timeWindows are invalid.");
    if (!isoDateString(value.effectiveFrom)) errors.push("worker_availability.effectiveFrom must be an ISO date.");
    if (!isoDateString(value.effectiveUntil)) errors.push("worker_availability.effectiveUntil must be an ISO date.");
  }

  if (valueType === "commute_preference") {
    if (value.maxMinutes !== undefined && (!isNumber(value.maxMinutes) || value.maxMinutes < 0)) {
      errors.push("commute_preference.maxMinutes must be a positive number.");
    }
    if (value.preferredTransport !== undefined && !isString(value.preferredTransport)) {
      errors.push("commute_preference.preferredTransport must be a string.");
    }
    if (value.exception !== undefined && !isString(value.exception)) {
      errors.push("commute_preference.exception must be a string.");
    }
  }

  if (valueType === "pay_expectation") {
    if (value.minimumRate !== undefined && (!isNumber(value.minimumRate) || value.minimumRate < 0)) {
      errors.push("pay_expectation.minimumRate must be a positive number.");
    }
    if (value.preferredRate !== undefined && (!isNumber(value.preferredRate) || value.preferredRate < 0)) {
      errors.push("pay_expectation.preferredRate must be a positive number.");
    }
    if (value.currency !== "GBP") errors.push("pay_expectation.currency must be GBP.");
    if (!isEnum(value.rateUnit, ["hour", "day", "shift"])) {
      errors.push("pay_expectation.rateUnit must be hour, day, or shift.");
    }
  }

  if (valueType === "role_confidence") {
    if (!isString(value.roleType)) errors.push("role_confidence.roleType is required.");
    if (!isNumber(value.confidence) || value.confidence < 0 || value.confidence > 1) {
      errors.push("role_confidence.confidence must be between 0 and 1.");
    }
    if (value.evidence !== undefined && !isString(value.evidence)) {
      errors.push("role_confidence.evidence must be a string.");
    }
  }

  if (valueType === "briefing_note") {
    if (!isString(value.note)) errors.push("briefing_note.note is required.");
    if (!isEnum(value.audience, ["worker", "employer", "admin"])) {
      errors.push("briefing_note.audience must be worker, employer, or admin.");
    }
    if (value.priority !== undefined && !isEnum(value.priority, ["low", "normal", "high"])) {
      errors.push("briefing_note.priority must be low, normal, or high.");
    }
  }

  if (valueType === "worker_relationship") {
    if (!isString(value.workerId)) errors.push("worker_relationship.workerId is required.");
    if (!isEnum(value.relationship, ["preferred", "blocked"])) {
      errors.push("worker_relationship.relationship must be preferred or blocked.");
    }
    if (value.reason !== undefined && !isString(value.reason)) {
      errors.push("worker_relationship.reason must be a string.");
    }
  }

  if (valueType === "cpd_training_signal") {
    if (!isCpdSignalType(value.signalType)) errors.push("cpd_training_signal.signalType is required.");
    if (!isString(value.trainingName)) errors.push("cpd_training_signal.trainingName is required.");
    if (!isEnum(value.status, ["completed", "in_progress", "expired", "recommended"])) {
      errors.push("cpd_training_signal.status is required.");
    }
    if (!stringArray(value.roleTypes)) errors.push("cpd_training_signal.roleTypes must be a string array.");
    if (
      value.sector !== undefined &&
      !isEnum(value.sector, ["education", "security", "care", "hospitality", "logistics", "events"])
    ) {
      errors.push("cpd_training_signal.sector is invalid.");
    }
    if (value.provider !== undefined && !isString(value.provider)) {
      errors.push("cpd_training_signal.provider must be a string.");
    }
    if (!isoDateString(value.completedAt)) errors.push("cpd_training_signal.completedAt must be an ISO date.");
    if (!isoDateString(value.expiresAt)) errors.push("cpd_training_signal.expiresAt must be an ISO date.");
    if (value.evidenceRef !== undefined && !isString(value.evidenceRef)) {
      errors.push("cpd_training_signal.evidenceRef must be a string.");
    }
    if (value.impact !== undefined && !isString(value.impact)) {
      errors.push("cpd_training_signal.impact must be a string.");
    }
    if (value.requestedByOrganisationId !== undefined && !isString(value.requestedByOrganisationId)) {
      errors.push("cpd_training_signal.requestedByOrganisationId must be a string.");
    }
    if (value.signalType === "completed_cpd" && value.status !== "completed") {
      errors.push("cpd_training_signal.completed_cpd must have status completed.");
    }
    if (value.signalType === "completed_cpd" && !isString(value.completedAt)) {
      errors.push("cpd_training_signal.completed_cpd requires completedAt.");
    }
    if (value.signalType === "expiring_training" && !isString(value.expiresAt)) {
      errors.push("cpd_training_signal.expiring_training requires expiresAt.");
    }
  }

  if (valueType === "procedural_playbook") {
    if (value.playbookType !== "intake_clarification") {
      errors.push("procedural_playbook.playbookType must be intake_clarification.");
    }
    const trigger = nestedRecord(value.trigger, "procedural_playbook.trigger", errors);
    if (trigger) {
      if (!isString(trigger.organisationId)) errors.push("procedural_playbook.trigger.organisationId is required.");
      if (trigger.siteId !== undefined && !isString(trigger.siteId)) {
        errors.push("procedural_playbook.trigger.siteId must be a string.");
      }
      if (trigger.roleType !== undefined && !isString(trigger.roleType)) {
        errors.push("procedural_playbook.trigger.roleType must be a string.");
      }
      if (!stringArray(trigger.missingFields) || !Array.isArray(trigger.missingFields) || trigger.missingFields.length === 0) {
        errors.push("procedural_playbook.trigger.missingFields must be a non-empty string array.");
      }
    }
    if (!isString(value.guidance)) errors.push("procedural_playbook.guidance is required.");
    const evidence = nestedRecord(value.evidence, "procedural_playbook.evidence", errors);
    if (evidence) {
      if (!Array.isArray(evidence.eventIds) || !evidence.eventIds.every(isString) || evidence.eventIds.length === 0) {
        errors.push("procedural_playbook.evidence.eventIds must be a non-empty string array.");
      }
      if (!isNumber(evidence.count) || evidence.count < 1) {
        errors.push("procedural_playbook.evidence.count must be a positive number.");
      }
      if (!isNumber(evidence.windowDays) || evidence.windowDays < 1) {
        errors.push("procedural_playbook.evidence.windowDays must be a positive number.");
      }
    }
    const guardrails = nestedRecord(value.guardrails, "procedural_playbook.guardrails", errors);
    if (guardrails) {
      if (guardrails.reviewRequired !== true) errors.push("procedural_playbook.guardrails.reviewRequired must be true.");
      if (guardrails.rankingImpact !== "none") errors.push("procedural_playbook.guardrails.rankingImpact must be none.");
      if (guardrails.complianceImpact !== "none") errors.push("procedural_playbook.guardrails.complianceImpact must be none.");
    }
  }

  return { ok: errors.length === 0, value, valueType, errors };
}

export function memoryValueTypes(): MemoryValueType[] {
  return [...VALUE_TYPES];
}

export function cpdTrainingSignalTypes(): CpdTrainingSignalType[] {
  return [...CPD_SIGNAL_TYPES];
}

export function isCpdTrainingSignalRankingEligible(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.valueType === "cpd_training_signal" &&
    isCpdSignalType(value.signalType) &&
    CPD_RANKING_ELIGIBLE_SIGNAL_TYPES.has(value.signalType)
  );
}
