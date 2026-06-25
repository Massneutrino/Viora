import type { Prisma, PrismaClient } from "@viora/database";
import { evaluateGuardrailAction } from "./guardrails.js";
import type { EmployerContextAgent, MarketAgent, MemoryAgent, TrustComplianceAgent } from "./types.js";

const VIORA_FEE_RATE = 0.15;
const BOOKABLE_REQUEST_STATUSES = new Set([
  "pending_confirmation",
  "confirmed",
  "broadcasting",
]);
const REASSIGNABLE_BOOKING_STATUSES = new Set(["cancelled", "at_risk"]);

export function createEmployerContextAgent(
  db: PrismaClient,
  compliance: TrustComplianceAgent,
  market?: MarketAgent,
  memory?: MemoryAgent,
): EmployerContextAgent {
  async function auditFailure(
    action: string,
    entityType: string,
    entityId: string,
    inputs: Prisma.InputJsonValue,
    explanation: string,
  ) {
    await db.auditEvent.create({
      data: {
        actorType: "agent",
        actorId: "employer_context",
        action,
        entityType,
        entityId,
        inputs,
        outputs: { explanation },
        outcome: "blocked",
      },
    });
  }

  return {
    async processRequest(bookingRequestId, offerId, workerId, options) {
      const offer = await db.offer.findUnique({
        where: { id: offerId },
        include: {
          booking: true,
          bookingRequest: {
            include: {
              booking: { include: { shift: true, timesheet: true } },
              site: true,
              organisation: { include: { guardrailPolicy: true } },
            },
          },
        },
      });

      const inputs = { bookingRequestId, offerId, workerId } as Prisma.InputJsonValue;

      if (!offer || offer.workerId !== workerId || offer.bookingRequestId !== bookingRequestId) {
        const explanation = "Offer not found for worker and booking request.";
        await auditFailure("booking.create", "Offer", offerId, inputs, explanation);
        return {
          success: false,
          explanation,
          requiresHumanApproval: true,
          auditPayload: { bookingRequestId, offerId, workerId, error: "offer_not_found" },
        };
      }

      if (offer.status !== "pending") {
        const explanation = `Offer already ${offer.status}.`;
        await auditFailure("booking.create", "Offer", offerId, inputs, explanation);
        return {
          success: false,
          explanation,
          requiresHumanApproval: true,
          auditPayload: { bookingRequestId, offerId, workerId, status: offer.status },
        };
      }

      if (offer.expiresAt <= new Date()) {
        const explanation = "Offer has expired.";
        await auditFailure("booking.create", "Offer", offerId, inputs, explanation);
        return {
          success: false,
          explanation,
          requiresHumanApproval: true,
          auditPayload: { bookingRequestId, offerId, workerId, error: "offer_expired" },
        };
      }

      const { bookingRequest } = offer;
      const existingBooking = bookingRequest.booking;
      const isRecoveryAssignment =
        existingBooking && REASSIGNABLE_BOOKING_STATUSES.has(existingBooking.status);

      if (!BOOKABLE_REQUEST_STATUSES.has(bookingRequest.status) && !isRecoveryAssignment) {
        const explanation = `BookingRequest is ${bookingRequest.status}, so it cannot be booked.`;
        await auditFailure("booking.create", "BookingRequest", bookingRequestId, inputs, explanation);
        return {
          success: false,
          explanation,
          requiresHumanApproval: true,
          auditPayload: { bookingRequestId, offerId, workerId, status: bookingRequest.status },
        };
      }

      if (offer.booking || (existingBooking && !isRecoveryAssignment)) {
        const explanation = "Booking already exists for this offer or booking request.";
        await auditFailure("booking.create", "BookingRequest", bookingRequestId, inputs, explanation);
        return {
          success: false,
          explanation,
          requiresHumanApproval: true,
          auditPayload: { bookingRequestId, offerId, workerId, error: "booking_exists" },
        };
      }

      if (existingBooking?.timesheet) {
        const explanation = "Booking has a timesheet, so it cannot be reassigned safely.";
        await auditFailure("booking.create", "BookingRequest", bookingRequestId, inputs, explanation);
        return {
          success: false,
          explanation,
          requiresHumanApproval: true,
          auditPayload: { bookingRequestId, offerId, workerId, error: "timesheet_exists" },
        };
      }

      const guardrail = await evaluateGuardrailAction(db, {
        organisationId: bookingRequest.organisationId,
        action: "assign",
        roleType: bookingRequest.roleType,
        payRate: offer.payRate,
        approvedBy: options?.approvedBy,
      });

      if (!guardrail.allowed || guardrail.requiresHumanApproval) {
        const explanation = guardrail.reason;
        return {
          success: false,
          explanation,
          requiresHumanApproval: true,
          auditPayload: {
            queueAction: "booking.create",
            organisationId: bookingRequest.organisationId,
            bookingRequestId,
            offerId,
            workerId,
            guardrail: {
              allowed: guardrail.allowed,
              requiresHumanApproval: guardrail.requiresHumanApproval,
              reason: guardrail.reason,
            },
          },
        };
      }

      const eligibility = await compliance.checkEligibility(workerId, bookingRequestId);
      if (!eligibility.eligible) {
        const explanation = eligibility.reason ?? "Worker is not eligible for this booking.";
        await db.auditEvent.create({
          data: {
            actorType: "agent",
            actorId: "employer_context",
            action: "booking.create",
            entityType: "BookingRequest",
            entityId: bookingRequestId,
            inputs,
            outputs: {
              eligibility,
            },
            outcome: "compliance_failed",
          },
        });
        return {
          success: false,
          explanation,
          requiresHumanApproval: true,
          auditPayload: { bookingRequestId, offerId, workerId, eligibility },
        };
      }

      const acceptedPayRate = offer.payRate;
      const vioraFee = Number((acceptedPayRate * VIORA_FEE_RATE).toFixed(2));
      const totalCost = Number((acceptedPayRate + vioraFee).toFixed(2));
      const complianceSnapshot = {
        checkedAt: new Date().toISOString(),
        eligible: eligibility.eligible,
        gates: eligibility.gates,
        reason: eligibility.reason ?? null,
      };

      const booking = await db.$transaction(async (tx) => {
        const updatedOffer = await tx.offer.update({
          where: { id: offerId },
          data: { status: "accepted" },
        });

        await tx.offer.updateMany({
          where: {
            bookingRequestId,
            id: { not: offerId },
            status: "pending",
          },
          data: { status: "declined" },
        });

        let confirmedBooking;
        if (existingBooking) {
          if (existingBooking.offerId !== offerId) {
            await tx.offer.updateMany({
              where: { id: existingBooking.offerId, status: "accepted" },
              data: { status: "declined" },
            });
          }

          confirmedBooking = await tx.booking.update({
            where: { id: existingBooking.id },
            data: {
              workerId,
              offerId,
              status: "confirmed",
              roleType: bookingRequest.roleType,
              startAt: bookingRequest.startAt,
              endAt: bookingRequest.endAt,
              payRate: acceptedPayRate,
              vioraFee,
              totalCost,
              complianceSnapshot,
            },
          });

          await tx.shift.upsert({
            where: { bookingId: confirmedBooking.id },
            update: {
              status: "scheduled",
              checkedInAt: null,
              checkedOutAt: null,
              checkInLatitude: null,
              checkInLongitude: null,
            },
            create: {
              bookingId: confirmedBooking.id,
              status: "scheduled",
            },
          });
        } else {
          confirmedBooking = await tx.booking.create({
            data: {
              bookingRequestId,
              organisationId: bookingRequest.organisationId,
              siteId: bookingRequest.siteId,
              workerId,
              offerId,
              status: "confirmed",
              roleType: bookingRequest.roleType,
              startAt: bookingRequest.startAt,
              endAt: bookingRequest.endAt,
              payRate: acceptedPayRate,
              vioraFee,
              totalCost,
              backupWorkerIds: [],
              complianceSnapshot,
            },
          });

          await tx.shift.create({
            data: {
              bookingId: confirmedBooking.id,
              status: "scheduled",
            },
          });
        }

        await tx.bookingRequest.update({
          where: { id: bookingRequestId },
          data: { status: "filled" },
        });

        await tx.auditEvent.create({
          data: {
            actorType: "user",
            actorId: workerId,
            action: "offer.accept",
            entityType: "Offer",
            entityId: offerId,
            inputs,
            outputs: {
              bookingRequestId,
              status: updatedOffer.status,
            },
            outcome: "accepted",
          },
        });

        await tx.auditEvent.create({
          data: {
            actorType: "agent",
            actorId: "employer_context",
            action: existingBooking ? "booking.reassign" : "booking.create",
            entityType: "Booking",
            entityId: confirmedBooking.id,
            inputs,
            outputs: {
              bookingId: confirmedBooking.id,
              shiftStatus: "scheduled",
              bookingRequestStatus: "filled",
              payRate: acceptedPayRate,
              vioraFee,
              totalCost,
              complianceSnapshot,
            },
            outcome: "confirmed",
          },
        });

        return confirmedBooking;
      });

      if (memory) {
        await memory.recordOfferOutcome(offerId, "accepted").catch(() => undefined);
        await memory
          .rememberFromEvent({
            ownerType: "organisation",
            ownerId: bookingRequest.organisationId,
            subjectType: "booking",
            subjectId: booking.id,
            sourceRefType: "Booking",
            sourceRefId: booking.id,
            text: `Booking confirmed for ${bookingRequest.roleType} at ${bookingRequest.site.name}. Worker ${workerId} accepted at pay rate ${acceptedPayRate}.`,
            data: {
              bookingRequestId,
              offerId,
              workerId,
              siteId: bookingRequest.siteId,
              roleType: bookingRequest.roleType,
              payRate: acceptedPayRate,
              bookingRequestPayRate: bookingRequest.payRate,
              rateMode: bookingRequest.rateMode,
            },
          })
          .catch(() => undefined);
      }

      return {
        success: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: booking as any,
        explanation: "Shift accepted and booking confirmed.",
        requiresHumanApproval: false,
        auditPayload: { bookingRequestId, offerId, workerId, bookingId: booking.id },
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

    async triggerReplacement(bookingId, options) {
      const booking = await db.booking.findUnique({
        where: { id: bookingId },
        include: {
          bookingRequest: {
            include: { organisation: { include: { guardrailPolicy: true } } },
          },
        },
      });

      const inputs = { bookingId } as Prisma.InputJsonValue;
      if (!booking) {
        const explanation = "Booking not found.";
        await auditFailure("replacement.trigger", "Booking", bookingId, inputs, explanation);
        return {
          success: false,
          explanation,
          requiresHumanApproval: true,
          auditPayload: { bookingId, error: "not_found" },
        };
      }

      if (!REASSIGNABLE_BOOKING_STATUSES.has(booking.status)) {
        const explanation = `Booking is ${booking.status}, so replacement is not available.`;
        await auditFailure("replacement.trigger", "Booking", bookingId, inputs, explanation);
        return {
          success: false,
          explanation,
          requiresHumanApproval: true,
          auditPayload: { bookingId, status: booking.status },
        };
      }

      const policy = booking.bookingRequest.organisation.guardrailPolicy;
      const guardrail = await evaluateGuardrailAction(db, {
        organisationId: booking.organisationId,
        action: "replacement",
        roleType: booking.roleType,
        payRate: booking.payRate,
        approvedBy: options?.approvedBy,
      });
      if (!guardrail.allowed || guardrail.requiresHumanApproval) {
        const explanation = guardrail.reason;
        return {
          success: false,
          explanation,
          requiresHumanApproval: true,
          auditPayload: {
            queueAction: "replacement.trigger",
            organisationId: booking.organisationId,
            bookingId,
            bookingRequestId: booking.bookingRequestId,
            guardrail: {
              allowed: guardrail.allowed,
              requiresHumanApproval: guardrail.requiresHumanApproval,
              reason: guardrail.reason,
            },
          },
        };
      }

      const eligibleBackupWorkerIds: string[] = [];
      for (const workerId of booking.backupWorkerIds) {
        const eligibility = await compliance.checkEligibility(workerId, booking.bookingRequestId);
        if (eligibility.eligible) eligibleBackupWorkerIds.push(workerId);
      }

      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      let offerCount = 0;
      let fallbackUsed = false;

      if (eligibleBackupWorkerIds.length > 0) {
        await db.$transaction(async (tx) => {
          await tx.bookingRequest.update({
            where: { id: booking.bookingRequestId },
            data: { status: "broadcasting" },
          });

          for (const workerId of eligibleBackupWorkerIds) {
            const existing = await tx.offer.findFirst({
              where: {
                bookingRequestId: booking.bookingRequestId,
                workerId,
                status: { in: ["pending", "accepted"] },
              },
            });
            if (existing) continue;

            await tx.offer.create({
              data: {
                bookingRequestId: booking.bookingRequestId,
                workerId,
                payRate: booking.payRate,
                fitExplanation: "Backup worker for cancelled or at-risk booking.",
                expiresAt,
                status: "pending",
              },
            });
            offerCount += 1;
          }

          await tx.auditEvent.create({
            data: {
              actorType: "agent",
              actorId: "employer_context",
              action: "replacement.trigger",
              entityType: "Booking",
              entityId: booking.id,
              inputs,
              outputs: {
                bookingRequestId: booking.bookingRequestId,
                backupWorkerIds: eligibleBackupWorkerIds,
                offerCount,
                fallbackUsed: false,
              },
              outcome: offerCount > 0 ? "backup_offers_sent" : "no_new_backup_offers",
            },
          });
        });
      } else if (market) {
        fallbackUsed = true;
        await db.bookingRequest.update({
          where: { id: booking.bookingRequestId },
          data: { status: "broadcasting" },
        });
        await market.rankCandidates(booking.bookingRequestId);
        const offers = await market.broadcastOffers(
          booking.bookingRequestId,
          booking.bookingRequest.broadcastStrategy,
          policy?.autonomyLevel ?? "L4",
          options,
        );
        offerCount = offers.data?.length ?? 0;

        await db.auditEvent.create({
          data: {
            actorType: "agent",
            actorId: "employer_context",
            action: "replacement.trigger",
            entityType: "Booking",
            entityId: booking.id,
            inputs,
            outputs: {
              bookingRequestId: booking.bookingRequestId,
              offerCount,
              fallbackUsed,
            },
            outcome: offerCount > 0 ? "fallback_offers_sent" : "no_replacement_offers",
          },
        });
      } else {
        const explanation = "No eligible backup workers and MarketAgent is not configured.";
        await auditFailure("replacement.trigger", "Booking", bookingId, inputs, explanation);
        return {
          success: false,
          explanation,
          requiresHumanApproval: true,
          auditPayload: { bookingId, error: "no_replacement_path" },
        };
      }

      return {
        success: true,
        explanation: `${offerCount} replacement offer(s) broadcast.`,
        requiresHumanApproval: offerCount === 0,
        auditPayload: {
          bookingId,
          bookingRequestId: booking.bookingRequestId,
          offerCount,
          fallbackUsed,
        },
      };
    },
  };
}
