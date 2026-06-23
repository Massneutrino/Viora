import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ParsedBookingIntent, VIntakeContext } from "@viora/agents";
import type { Prisma } from "@viora/database";

const parseIntentSchema = z.object({
  organisationId: z.string(),
  rawInput: z.string().min(1),
  channel: z.enum(["app", "whatsapp", "voice", "phone", "web"]).default("web"),
  conversationId: z.string().nullish(),
});

function deserializeIntent(snapshot: Record<string, unknown> | null | undefined): ParsedBookingIntent | null {
  if (!snapshot || typeof snapshot.roleType !== "string") return null;
  return {
    roleType: snapshot.roleType,
    siteId: typeof snapshot.siteId === "string" ? snapshot.siteId : undefined,
    siteName: typeof snapshot.siteName === "string" ? snapshot.siteName : undefined,
    startAt: new Date(snapshot.startAt as string),
    endAt: new Date(snapshot.endAt as string),
    payRate: typeof snapshot.payRate === "number" ? snapshot.payRate : undefined,
    maxPayRate: typeof snapshot.maxPayRate === "number" ? snapshot.maxPayRate : undefined,
    requirements:
      snapshot.requirements && typeof snapshot.requirements === "object"
        ? (snapshot.requirements as Record<string, unknown>)
        : undefined,
    missingFields: Array.isArray(snapshot.missingFields)
      ? (snapshot.missingFields as string[])
      : [],
    confidence: typeof snapshot.confidence === "number" ? snapshot.confidence : 0,
  };
}

function mergeIntent(prior: ParsedBookingIntent | null, next: ParsedBookingIntent): ParsedBookingIntent {
  if (!prior) return next;
  return {
    roleType: next.roleType || prior.roleType,
    siteId: next.siteId ?? prior.siteId,
    siteName: next.siteName ?? prior.siteName,
    startAt: next.startAt,
    endAt: next.endAt,
    payRate: next.payRate ?? prior.payRate,
    maxPayRate: next.maxPayRate ?? prior.maxPayRate,
    requirements: next.requirements ?? prior.requirements,
    missingFields: next.missingFields,
    confidence: next.confidence,
  };
}

function resolveSiteId(
  intent: ParsedBookingIntent,
  sites: { id: string; name: string }[],
  rawInput?: string,
): ParsedBookingIntent {
  if (intent.siteId) return intent;
  const hay = `${intent.siteName ?? ""} ${rawInput ?? ""}`.trim().toLowerCase();
  if (!hay) return intent;
  const match = sites.find(
    (s) =>
      hay.includes(s.id.toLowerCase()) ||
      hay.includes(s.name.toLowerCase()) ||
      s.id.toLowerCase() === hay ||
      s.name.toLowerCase() === hay,
  );
  return match ? { ...intent, siteId: match.id, siteName: match.name } : intent;
}

function buildParsePrompt(
  rawInput: string,
  priorIntent: ParsedBookingIntent | null,
  messages: { role: string; content: string }[],
): string {
  const parts: string[] = [];
  if (messages.length > 0) {
    parts.push(
      "Conversation so far:",
      ...messages.map((m) => `${m.role === "employer" ? "Employer" : "V"}: ${m.content}`),
    );
  }
  if (priorIntent) {
    parts.push(`Previously extracted booking fields:\n${JSON.stringify(serializeIntent(priorIntent), null, 2)}`);
  }
  parts.push(`Employer's latest message:\n${rawInput}`);
  return parts.join("\n\n");
}

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
    const sites = await app.db.site.findMany({
      where: { organisationId: body.organisationId },
      select: { id: true, name: true },
    });

    let priorIntent: ParsedBookingIntent | null = null;
    let priorMessages: { role: string; content: string }[] = [];
    if (body.conversationId) {
      const existing = await app.db.conversation.findUnique({
        where: { id: body.conversationId },
        include: { messages: { orderBy: { createdAt: "asc" } } },
      });
      if (!existing || existing.participantId !== body.organisationId) {
        return reply.code(404).send({ error: "Conversation not found." });
      }
      priorIntent = deserializeIntent(existing.extractedEntities as Record<string, unknown>);
      priorMessages = existing.messages.map((m) => ({ role: m.role, content: m.content }));
    }

    intakeContext.sites = sites;

    const parsePrompt = buildParsePrompt(body.rawInput, priorIntent, priorMessages);
    const parsedIntent = resolveSiteId(
      mergeIntent(priorIntent, await app.agents.v.parseIntent(parsePrompt, intakeContext)),
      sites,
      body.rawInput,
    );
    const missingFields = normalizeMissingFields(parsedIntent, intakeContext.guardrails);
    const intent: ParsedBookingIntent = { ...parsedIntent, missingFields };

    const intentSnapshot = serializeIntent(intent);
    const clarificationContext: Record<string, unknown> = {
      organisationId: body.organisationId,
      guardrails: guardrailSnapshot,
      priorIntent: intentSnapshot,
      knownSites: sites,
    };

    const clarificationNeeded = missingFields.length > 0;
    const message = clarificationNeeded
      ? await app.agents.v.clarify(missingFields, clarificationContext)
      : await app.agents.v.confirmIntent(intent);

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

      const messageRows = [
        {
          role: "employer",
          content: body.rawInput,
          metadata: { channel: body.channel } as Prisma.InputJsonValue,
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
      ];

      const conversation = body.conversationId
        ? await tx.conversation.update({
            where: { id: body.conversationId },
            data: {
              intent: intent.roleType,
              extractedEntities: intentSnapshot as Prisma.InputJsonValue,
              ...(bookingRequestId ? { bookingRequestId } : {}),
              messages: { create: messageRows },
            },
          })
        : await tx.conversation.create({
            data: {
              participantType: "employer",
              participantId: body.organisationId,
              channel: body.channel,
              intent: intent.roleType,
              extractedEntities: intentSnapshot as Prisma.InputJsonValue,
              ...(bookingRequestId ? { bookingRequestId } : {}),
              messages: { create: messageRows },
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
            conversationId: body.conversationId ?? null,
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
