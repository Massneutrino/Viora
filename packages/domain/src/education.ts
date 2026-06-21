/** Education-specific role types for Phase 0 pilot. */
export const EDUCATION_ROLE_TYPES = [
  "supply_teacher",
  "cover_supervisor",
  "teaching_assistant",
  "learning_support_assistant",
  "invigilator",
] as const;

export type EducationRoleType = (typeof EDUCATION_ROLE_TYPES)[number];

/** Hard compliance gates for education bookings (PRD §9.3). */
export interface EducationComplianceRequirements {
  enhancedDbs: ComplianceStatus;
  rightToWork: ComplianceStatus;
  identityVerified: boolean;
  qtsOrNonQts: "qts" | "non_qts" | "not_applicable";
  safeguardingTraining: ComplianceStatus;
  referencesVerified: boolean;
  prohibitionFromTeachingChecked: boolean;
  overseasCheck?: ComplianceStatus;
}

type ComplianceStatus = "pending" | "verified" | "expired" | "rejected";

/** Returns true only when all deterministic gates pass. No probabilistic inference. */
export function isEligibleForEducationBooking(
  requirements: EducationComplianceRequirements,
  roleRequiresQts: boolean,
): boolean {
  if (requirements.enhancedDbs !== "verified") return false;
  if (requirements.rightToWork !== "verified") return false;
  if (!requirements.identityVerified) return false;
  if (requirements.safeguardingTraining !== "verified") return false;
  if (!requirements.referencesVerified) return false;
  if (!requirements.prohibitionFromTeachingChecked) return false;
  if (roleRequiresQts && requirements.qtsOrNonQts !== "qts") return false;
  return true;
}
