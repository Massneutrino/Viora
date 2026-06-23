/** Vertical sectors supported by Viora (education first in Phase 0). */
export type Sector = "education" | "security" | "care" | "hospitality" | "logistics" | "events";

/** Employer-side autonomy levels (L0–L4). */
export type AutonomyLevel = "L0" | "L1" | "L2" | "L3" | "L4";

export type EmployerRole =
  | "organisation_admin"
  | "cover_manager"
  | "approver"
  | "finance_user"
  | "read_only_auditor";

export type BookingRequestStatus =
  | "draft"
  | "pending_confirmation"
  | "confirmed"
  | "broadcasting"
  | "filled"
  | "cancelled";

export type OfferStatus = "pending" | "accepted" | "declined" | "expired";

export type BookingStatus = "confirmed" | "in_progress" | "completed" | "cancelled" | "at_risk";

export type ShiftStatus =
  | "scheduled"
  | "pre_shift_check"
  | "checked_in"
  | "checked_out"
  | "no_show"
  | "cancelled";

export type ComplianceStatus = "pending" | "verified" | "expired" | "rejected";

export type DocumentType =
  | "enhanced_dbs"
  | "right_to_work"
  | "safeguarding"
  | "qts"
  | "sia"
  | "identity"
  | "cv"
  | "reference_letter"
  | "references"
  | "prohibition_check";

export interface ComplianceDocument {
  id: string;
  passportId: string;
  documentType: DocumentType | string;
  fileName?: string;
  contentType?: string;
  status: ComplianceStatus;
  expiresAt?: Date;
  storageKey?: string;
  verifiedBy?: string;
  verifiedAt?: Date;
  createdAt: Date;
  downloadUrl?: string;
}

export type BroadcastStrategy =
  | "simultaneous_top_n"
  | "sequential"
  | "preferred_first"
  | "known_worker_only"
  | "auto_book"
  | "manual_approval";

export type ConversationChannel = "app" | "whatsapp" | "voice" | "phone" | "web";

export type ActorType = "user" | "agent" | "system" | "admin";

/** Constraints defining what V can do autonomously for an employer or worker. */
export interface GuardrailPolicy {
  autonomyLevel: AutonomyLevel;
  budgetCeiling?: number;
  payFloor?: number;
  maxCommuteMinutes?: number;
  approvedRoleTypes?: string[];
  workerWhitelist?: string[];
  workerBlocklist?: string[];
  autoAcceptConditions?: Record<string, unknown>;
  escalationContacts?: string[];
}

export interface Organisation {
  id: string;
  name: string;
  sector: Sector;
  type: string;
  timezone: string;
  parentOrganisationId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Site {
  id: string;
  organisationId: string;
  name: string;
  address: string;
  latitude?: number;
  longitude?: number;
  siteInstructions?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Worker {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  homeLatitude?: number;
  homeLongitude?: number;
  workRadiusKm?: number;
  roleTypes: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Passport {
  id: string;
  workerId: string;
  identityVerified: boolean;
  rightToWorkStatus: ComplianceStatus;
  dbsStatus: ComplianceStatus;
  qtsStatus?: ComplianceStatus;
  siaStatus?: ComplianceStatus;
  safeguardingStatus: ComplianceStatus;
  sectorEligibility: Sector[];
  reliabilityScore?: number;
  updatedAt: Date;
}

export interface BookingRequest {
  id: string;
  organisationId: string;
  siteId: string;
  status: BookingRequestStatus;
  roleType: string;
  startAt: Date;
  endAt: Date;
  payRate: number;
  maxPayRate?: number;
  requirements?: Record<string, unknown>;
  rawIntent?: string;
  channel: ConversationChannel;
  fillProbability?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Match {
  id: string;
  bookingRequestId: string;
  workerId: string;
  rank: number;
  acceptanceProbability: number;
  reasoning: string;
  scores: Record<string, number>;
  createdAt: Date;
}

export interface Offer {
  id: string;
  bookingRequestId: string;
  workerId: string;
  matchId?: string;
  status: OfferStatus;
  payRate: number;
  fitExplanation: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface Booking {
  id: string;
  bookingRequestId: string;
  organisationId: string;
  siteId: string;
  workerId: string;
  offerId: string;
  status: BookingStatus;
  roleType: string;
  startAt: Date;
  endAt: Date;
  payRate: number;
  vioraFee: number;
  totalCost: number;
  backupWorkerIds: string[];
  complianceSnapshot: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface Shift {
  id: string;
  bookingId: string;
  status: ShiftStatus;
  checkedInAt?: Date;
  checkedOutAt?: Date;
  checkInLatitude?: number;
  checkInLongitude?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Timesheet {
  id: string;
  shiftId: string;
  bookingId: string;
  workerId: string;
  organisationId: string;
  hoursWorked: number;
  approved: boolean;
  approvedAt?: Date;
  approvedBy?: string;
  createdAt: Date;
}

export interface Invoice {
  id: string;
  organisationId: string;
  periodStart: Date;
  periodEnd: Date;
  workerPayTotal: number;
  vioraFeeTotal: number;
  totalAmount: number;
  status: "draft" | "sent" | "paid";
  createdAt: Date;
}

export interface Conversation {
  id: string;
  participantType: "employer" | "worker";
  participantId: string;
  channel: ConversationChannel;
  intent?: string;
  extractedEntities?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditEvent {
  id: string;
  actorType: ActorType;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  outcome: string;
  createdAt: Date;
}

export interface NegotiationRecord {
  id: string;
  bookingRequestId: string;
  workerId: string;
  employerCeiling: number;
  workerFloor: number;
  agreedRate?: number;
  explanation: string;
  createdAt: Date;
}

export interface Feedback {
  id: string;
  shiftId: string;
  fromType: "employer" | "worker";
  fromId: string;
  rating?: number;
  comment?: string;
  contested: boolean;
  createdAt: Date;
}

export * from "./education.js";
export * from "./phase0.js";
export * from "./geo.js";
