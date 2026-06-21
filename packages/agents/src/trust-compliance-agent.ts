import { isEligibleForEducationBooking } from "@viora/domain";
import type { PrismaClient } from "@viora/database";
import type { TrustComplianceAgent } from "./types.js";

/** Roles in the education sector that require Qualified Teacher Status. */
const QTS_REQUIRED_ROLES = new Set(["supply_teacher"]);

export function createTrustComplianceAgent(db: PrismaClient): TrustComplianceAgent {
  return {
    async checkEligibility(workerId, bookingRequestId) {
      const [passport, bookingRequest] = await Promise.all([
        db.passport.findUnique({
          where: { workerId },
          include: { documents: true },
        }),
        db.bookingRequest.findUnique({
          where: { id: bookingRequestId },
          select: { roleType: true },
        }),
      ]);

      if (!passport) {
        return {
          eligible: false,
          gates: {},
          reason: "Worker has no Passport record — compliance verification has not started.",
        };
      }

      if (!bookingRequest) {
        return {
          eligible: false,
          gates: {},
          reason: "Booking request not found.",
        };
      }

      const roleRequiresQts = QTS_REQUIRED_ROLES.has(bookingRequest.roleType);

      // referencesVerified and prohibitionFromTeachingChecked are tracked as
      // ComplianceDocument records uploaded and verified by the admin team.
      const hasVerifiedDoc = (type: string) =>
        passport.documents.some(
          (d) => d.documentType === type && d.status === "verified",
        );

      const qtsOrNonQts: "qts" | "non_qts" | "not_applicable" =
        passport.qtsStatus === "verified"
          ? "qts"
          : passport.qtsStatus == null
            ? "not_applicable"
            : "non_qts";

      const requirements = {
        enhancedDbs: passport.dbsStatus,
        rightToWork: passport.rightToWorkStatus,
        identityVerified: passport.identityVerified,
        qtsOrNonQts,
        safeguardingTraining: passport.safeguardingStatus,
        referencesVerified: hasVerifiedDoc("references"),
        prohibitionFromTeachingChecked: hasVerifiedDoc("prohibition_check"),
      };

      const eligible = isEligibleForEducationBooking(requirements, roleRequiresQts);

      const gates: Record<string, boolean> = {
        enhancedDbs: requirements.enhancedDbs === "verified",
        rightToWork: requirements.rightToWork === "verified",
        identityVerified: requirements.identityVerified,
        safeguardingTraining: requirements.safeguardingTraining === "verified",
        referencesVerified: requirements.referencesVerified,
        prohibitionFromTeachingChecked: requirements.prohibitionFromTeachingChecked,
      };

      if (roleRequiresQts) {
        gates["qts"] = requirements.qtsOrNonQts === "qts";
      }

      const failedGates = Object.entries(gates)
        .filter(([, passed]) => !passed)
        .map(([name]) => name);

      return {
        eligible,
        gates,
        reason: eligible
          ? undefined
          : `Ineligible — failed: ${failedGates.join(", ")}.`,
      };
    },
  };
}
