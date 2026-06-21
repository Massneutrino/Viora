import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ParsedBookingIntent, VIntakeContext } from "@viora/agents";
import type { Prisma } from "@viora/database";

const parseIntentSchema = z.object({
  organisationId: z.string(),
  rawInput: z.string().min(1),
  channel: z.enum(["app", "whatsapp", "voice", "phone", "web"]).default("web"),
});

function serializeIntent(intent: ParsedBookingIntent): Record<string, unknown> {
  return {
    roleType: intent.roleType,
    siteId: intent.siteId ?? null,
    siteName: intent.siteName ?? null,
    startAt: intent.startAt.toISOString(),
    endAt: intent.endAt.toISOString(),
    payRate: intent.payRate ?? null,
    maxPayRate: intent.maxPayRate ?? null,
    requirements: intent.requirements ?? null,
    missingFields: intent.missingFields,
    confidence: intent.confidence,
  };
}

function normalizeMissingFields(
  intent: ParsedBookingIntent,
  guardrails: VIntakeContext["guardrails"],
): string[] {
  const missing = new Set(intent.missingFields);

  if (!intent.siteId) missing.add("siteId");
  if (intent.payRate === undefined) missing.add("payRate");

  if (guardrails.approvedRoleTypes.length > 0 && !guardrails.approvedRoleTypes.includes(intent.roleType)) {
    missing.add("roleType");
  }

  if (
    intent.payRate !== undefined &&
    ((guardrails.budgetCeiling !== undefined && intent.payRate > guardrails.budgetCeiling) ||
      (guardrails.payFloor !== undefined && intent.payRate < guardrails.payFloor))
  ) {
    missing.add("payRate");
  }

  return [...missing];
}

export const intakeRoutes: FastifyPluginAsync = async (app) => {
  /** POST /v1/intake/parse - V-powered natural language intake (Phase 0) */
  app.post("/parse", async (request, reply) => {
    const body = parseIntentSchema.parse(request.body);

    const organisation = await app.db.organisation.findUnique({
      where: { id: body.organisationId },
      include: { guardrailPolicy: true },
    });

    if (!organisation) {
      return reply.code(404).send({ error: "Organisation not found." });
    }

    if (!organisation.guardrailPolicy) {
      return reply.code(409).send({
        error: "GuardrailPolicy missing for organisation.",
        organisationId: body.organisationId,
      });
    }

    const intakeContext: VIntakeContext = {
      organisationId: body.organisationId,
      guardrails: {
        autonomyLevel: organisation.guardrailPolicy.autonomyLevel,
        budgetCeiling: organisation.guardrailPolicy.budgetCeiling ?? undefined,
        payFloor: organisation.guardrailPolicy.payFloor ?? undefined,
        maxCommuteMinutes: organisation.guardrailPolicy.maxCommuteMinutes ?? undefined,
        approvedRoleTypes: organisation.guardrailPolicy.approvedRoleTypes,
        escalationContacts: organisation.guardrailPolicy.escalationContacts,
      },
    };

    const guardrailSnapshot = {
      autonomyLevel: intakeContext.guardrails.autonomyLevel,
      budgetCeiling: intakeContext.guardrails.budgetCeiling ?? null,
      payFloor: intakeContext.guardrails.payFloor ?? null,
      maxCommuteMinutes: intakeContext.guardrails.maxCommuteMinutes ?? null,
      approvedRoleTypes: intakeContext.guardrails.approvedRoleTypes,
      escalationContacts: intakeContext.guardrails.escalationContacts,
    };
    const clarificationContext: Record<string, unknown> = {
      organisationId: body.organisationId,
      guardrails: guardrailSnapshot,
    };

    const parsedIntent = await app.agents.v.parseIntent(body.rawInput, intakeContext);
    const missingFields = normalizeMissingFields(parsedIntent, intakeContext.guardrails);
    const intent: ParsedBookingIntent = { ...parsedIntent, missingFields };

    const clarificationNeeded = missingFields.length > 0;
    const message = clarificationNeeded
      ? await app.agents.v.clarify(missingFields, clarificationContext)
      : await app.agents.v.confirmIntent(intent);

    const intentSnapshot = serializeIntent(intent);
    const persistence = await app.db.$transaction(async (tx) => {
      let bookingRequestId: string | undefined;

      if (!clarificationNeeded && intent.siteId && intent.payRate !== undefined) {
        const booking = await tx.bookingRequest.create({
          data: {
            organisationId: body.organisationId,
            siteId: intent.siteId,
            roleType: intent.roleType,
            startAt: intent.startAt,
            endAt: intent.endAt,
            payRate: intent.payRate,
            maxPayRate: intent.maxPayRate,
            requirements: intent.requirements as Prisma.InputJsonValue | undefined,
            rawIntent: body.rawInput,
            channel: body.channel,
            status: "pending_confirmation",
            broadcastStrategy: "sequential",
          },
        });
        bookingRequestId = booking.id;
      }

      const conversation = await tx.conversation.create({
        data: {
          participantType: "employer",
          participantId: body.organisationId,
          channel: body.channel,
          intent: intent.roleType,
          extractedEntities: intentSnapshot as Prisma.InputJsonValue,
          ...(bookingRequestId ? { bookingRequestId } : {}),
          messages: {
            create: [
              {
                role: "employer",
                content: body.rawInput,
                metadata: {
                  channel: body.channel,
                } as Prisma.InputJsonValue,
              },
              {
                role: "agent",
                content: message,
                metadata: {
                  clarificationNeeded,
                  missingFields,
                  bookingRequestId: bookingRequestId ?? null,
                } as Prisma.InputJsonValue,
              },
            ],
          },
        },
      });

      const auditEntity = {
        entityType: bookingRequestId ? "BookingRequest" : "Conversation",
        entityId: bookingRequestId ?? conversation.id,
      };

      await tx.auditEvent.create({
        data: {
          actorType: "agent",
          actorId: "v",
          action: "intake.parse",
          entityType: auditEntity.entityType,
          entityId: auditEntity.entityId,
          inputs: {
            organisationId: body.organisationId,
            rawInput: body.rawInput,
            channel: body.channel,
            guardrails: guardrailSnapshot,
          } as Prisma.InputJsonValue,
          outputs: {
            intent: intentSnapshot,
            clarificationNeeded,
            conversationId: conversation.id,
            bookingRequestId: bookingRequestId ?? null,
          } as Prisma.InputJsonValue,
          outcome: "parsed",
        },
      });

      await tx.auditEvent.create({
        data: {
          actorType: "agent",
          actorId: "v",
          action: clarificationNeeded ? "intake.clarify" : "intake.confirm",
          entityType: auditEntity.entityType,
          entityId: auditEntity.entityId,
          inputs: {
            intent: intentSnapshot,
            missingFields,
            guardrails: guardrailSnapshot,
          } as Prisma.InputJsonValue,
          outputs: {
            message,
            conversationId: conversation.id,
            bookingRequestId: bookingRequestId ?? null,
          } as Prisma.InputJsonValue,
          outcome: clarificationNeeded ? "clarification_required" : "pending_confirmation",
        },
      });

      return { bookingRequestId, conversationId: conversation.id };
    });

    return reply.send({
      intent,
      clarificationNeeded,
      message,
      bookingRequestId: persistence.bookingRequestId,
      conversationId: persistence.conversationId,
    });
  });
};
