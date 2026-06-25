import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ActorType, PendingApproval, Prisma, PrismaClient } from "@viora/database";
import { writeAuditEvent } from "./audit.js";

export type ApprovalAction = "offers.broadcast" | "booking.create" | "replacement.trigger";

interface QueuePendingApprovalInput {
  organisationId: string;
  actorType: ActorType;
  actorId: string;
  action: ApprovalAction;
  entityType: string;
  entityId: string;
  inputs: Prisma.InputJsonValue;
  explanation: string;
}

export interface ApprovalExecutionResult {
  success: boolean;
  explanation: string;
  outputs: Prisma.InputJsonValue;
}

const broadcastInputsSchema = z
  .object({
    bookingRequestId: z.string().min(1),
    strategy: z.string().min(1).optional(),
  })
  .passthrough();

const bookingCreateInputsSchema = z
  .object({
    bookingRequestId: z.string().min(1),
    offerId: z.string().min(1),
    workerId: z.string().min(1),
  })
  .passthrough();

const replacementInputsSchema = z
  .object({
    bookingId: z.string().min(1),
  })
  .passthrough();

export async function queuePendingApproval(
  db: PrismaClient | Prisma.TransactionClient,
  input: QueuePendingApprovalInput,
) {
  const approval = await db.pendingApproval.create({
    data: {
      organisationId: input.organisationId,
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      inputs: input.inputs,
      explanation: input.explanation,
    },
  });

  await writeAuditEvent(db, {
    actorType: input.actorType,
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    inputs: input.inputs,
    outputs: {
      pendingApprovalId: approval.id,
      status: approval.status,
      explanation: input.explanation,
    } as Prisma.InputJsonValue,
    outcome: "queued_for_approval",
  });

  return approval;
}

export async function executePendingApproval(
  app: FastifyInstance,
  approval: PendingApproval,
  adminId: string,
): Promise<ApprovalExecutionResult> {
  if (approval.action === "offers.broadcast") {
    const inputs = broadcastInputsSchema.parse(approval.inputs);
    const bookingRequest = await app.db.bookingRequest.findUnique({
      where: { id: inputs.bookingRequestId },
      include: { organisation: { include: { guardrailPolicy: true } } },
    });
    if (!bookingRequest) {
      return {
        success: false,
        explanation: "BookingRequest not found.",
        outputs: { bookingRequestId: inputs.bookingRequestId } as Prisma.InputJsonValue,
      };
    }

    const matches = await app.agents.market.rankCandidates(inputs.bookingRequestId);
    if (!matches.success) {
      return {
        success: false,
        explanation: matches.explanation,
        outputs: { bookingRequestId: inputs.bookingRequestId } as Prisma.InputJsonValue,
      };
    }

    const strategy = inputs.strategy ?? bookingRequest.broadcastStrategy;
    const offers = await app.agents.market.broadcastOffers(
      inputs.bookingRequestId,
      strategy,
      bookingRequest.organisation.guardrailPolicy?.autonomyLevel ?? "L4",
      { approvedBy: adminId },
    );

    return {
      success: offers.success,
      explanation: offers.explanation,
      outputs: {
        bookingRequestId: inputs.bookingRequestId,
        matchCount: matches.data?.length ?? 0,
        offerCount: offers.data?.length ?? 0,
        offerIds: (offers.data ?? []).map((offer) => offer.id),
      } as Prisma.InputJsonValue,
    };
  }

  if (approval.action === "booking.create") {
    const inputs = bookingCreateInputsSchema.parse(approval.inputs);
    const result = await app.agents.employer.processRequest(
      inputs.bookingRequestId,
      inputs.offerId,
      inputs.workerId,
      { approvedBy: adminId },
    );

    return {
      success: result.success,
      explanation: result.explanation,
      outputs: {
        bookingRequestId: inputs.bookingRequestId,
        offerId: inputs.offerId,
        workerId: inputs.workerId,
        bookingId: result.data?.id ?? null,
      } as Prisma.InputJsonValue,
    };
  }

  if (approval.action === "replacement.trigger") {
    const inputs = replacementInputsSchema.parse(approval.inputs);
    const result = await app.agents.employer.triggerReplacement(inputs.bookingId, {
      approvedBy: adminId,
    });

    return {
      success: result.success,
      explanation: result.explanation,
      outputs: {
        bookingId: inputs.bookingId,
        auditPayload: result.auditPayload,
      } as Prisma.InputJsonValue,
    };
  }

  return {
    success: false,
    explanation: `Unsupported approval action: ${approval.action}.`,
    outputs: { action: approval.action } as Prisma.InputJsonValue,
  };
}
