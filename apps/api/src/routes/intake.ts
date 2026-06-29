import type { FastifyBaseLogger, FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ParsedBookingIntent, VIntakeContext } from "@viora/agents";
import type { Prisma } from "@viora/database";

export const parseIntentSchema = z.object({
  organisationId: z.string(),
  rawInput: z.string().min(1),
  rateMode: z.enum(["standard", "dynamic"]).optional(),
  channel: z.enum(["app", "whatsapp", "voice", "phone", "web"]).default("web"),
  conversationId: z.string().nullish(),
});

type ProcessIntakeTurnInput = z.input<typeof parseIntentSchema> & {
  inboundMetadata?: Prisma.InputJsonValue;
  outboundMetadata?: Prisma.InputJsonValue;
};

type ProcessIntakeTurnResult = {
  intent: ParsedBookingIntent | null;
  clarificationNeeded: boolean;
  message: string;
  bookingRequestId: string | null | undefined;
  conversationId: string;
  fallbackUsed: boolean;
  degradedReason?: string;
};

export class IntakeHttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly payload: Record<string, unknown>,
  ) {
    super(typeof payload.error === "string" ? payload.error : "Intake request failed.");
  }
}

const FALLBACK_MISSING_FIELDS = ["roleType", "siteId", "startAt", "endAt", "payRate"];
const THANK_YOU_ONLY = /^(thank\s*you|thanks|thx|ta|cheers|ok(?:ay)?|great|perfect|brilliant|nice)[.! ]*$/i;

function fallbackIntakeMessage(): string {
  return "I have your request, but I need a few details to make sure it is booked correctly. Please send the role, site, date and time, and pay rate.";
}

function fallbackClarificationMessage(missingFields: string[]): string {
  const friendlyFields = missingFields.map((field) => {
    const labels: Record<string, string> = {
      roleType: "role",
      siteId: "site",
      startAt: "start date/time",
      endAt: "end time",
      maxPayRate: "maximum rate",
      payRate: "pay rate",
    };
    return labels[field] ?? field;
  });
  return `I can help with that. Could you confirm ${friendlyFields.slice(0, 2).join(" and ")}?`;
}

function fallbackConfirmationMessage(intent: ParsedBookingIntent): string {
  const site = intent.siteName ?? intent.siteId ?? "the selected site";
  const pay = intent.payRate === undefined ? "" : ` at GBP ${intent.payRate}/day`;
  return `I have captured this as ${intent.roleType} at ${site} from ${intent.startAt.toISOString()} to ${intent.endAt.toISOString()}${pay}. I will start matching eligible workers now.`;
}

function extractLatestPayRate(messages: string[]): number | undefined {
  const joined = messages.join("\n");
  const matches = [...joined.matchAll(/(?:\u00a3|gbp\s*)\s*(\d+(?:\.\d+)?)/gi)];
  const latest = matches.at(-1)?.[1];
  return latest === undefined ? undefined : Number(latest);
}

function startOfUtcDate(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function nextWeekdayDate(day: number, now: Date): Date {
  const today = now.getUTCDay();
  const delta = (day - today + 7) % 7 || 7;
  return addDays(startOfUtcDate(now), delta);
}

function relativeTargetDate(text: string, now: Date): Date | null {
  const lower = text.toLowerCase();
  if (/\btoday\b/.test(lower)) return startOfUtcDate(now);
  if (/\b(tomorrow|tmrw|next\s+working\s+day)\b/.test(lower)) return addDays(startOfUtcDate(now), 1);

  const days: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };
  for (const [name, day] of Object.entries(days)) {
    if (new RegExp(`\\b${name}\\b`, "i").test(text)) return nextWeekdayDate(day, now);
  }
  return null;
}

function applyDateWithParsedTime(parsed: Date, targetDate: Date): Date {
  const next = new Date(targetDate);
  next.setUTCHours(parsed.getUTCHours(), parsed.getUTCMinutes(), parsed.getUTCSeconds(), parsed.getUTCMilliseconds());
  return next;
}

function stabiliseParsedIntent(
  intent: ParsedBookingIntent,
  messages: string[],
  now = new Date(),
): ParsedBookingIntent {
  let next = { ...intent };
  const payRate = extractLatestPayRate(messages);
  if (payRate !== undefined && !Number.isNaN(payRate)) {
    next = { ...next, payRate };
  }

  if (next.startAt <= now || next.endAt <= now || next.endAt <= next.startAt) {
    const text = messages.join("\n");
    const targetDate = relativeTargetDate(text, now);
    if (targetDate) {
      const startAt = applyDateWithParsedTime(next.startAt, targetDate);
      const parsedDurationMs = Math.max(
        30 * 60 * 1000,
        next.endAt.getTime() - next.startAt.getTime(),
      );
      next = {
        ...next,
        startAt,
        endAt: new Date(startAt.getTime() + parsedDurationMs),
      };
    }
  }

  return next;
}

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const status = "status" in err ? (err as { status?: number }).status : undefined;
    return {
      name: err.name,
      message: err.message,
      ...(typeof status === "number" ? { status } : {}),
    };
  }
  return { message: String(err) };
}

function deserializeIntent(snapshot: Record<string, unknown> | null | undefined): ParsedBookingIntent | null {
  if (!snapshot || typeof snapshot.roleType !== "string") return null;
  return {
    roleType: snapshot.roleType,
    siteId: typeof snapshot.siteId === "string" ? snapshot.siteId : undefined,
    siteName: typeof snapshot.siteName === "string" ? snapshot.siteName : undefined,
    startAt: new Date(snapshot.startAt as string),
    endAt: new Date(snapshot.endAt as string),
    rateMode: snapshot.rateMode === "dynamic" ? "dynamic" : "standard",
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
    rateMode: next.rateMode ?? prior.rateMode,
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
    rateMode: intent.rateMode ?? "standard",
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
  const now = new Date();

  if (!intent.siteId) missing.add("siteId");
  if (intent.payRate === undefined) missing.add("payRate");
  if (intent.rateMode === "dynamic" && intent.maxPayRate === undefined) missing.add("maxPayRate");
  if (!(intent.startAt instanceof Date) || Number.isNaN(intent.startAt.getTime()) || intent.startAt <= now) {
    missing.add("startAt");
  }
  if (!(intent.endAt instanceof Date) || Number.isNaN(intent.endAt.getTime()) || intent.endAt <= intent.startAt) {
    missing.add("endAt");
  }

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

export async function processIntakeTurn(
  app: FastifyInstance,
  log: FastifyBaseLogger,
  input: ProcessIntakeTurnInput,
): Promise<ProcessIntakeTurnResult> {
  const inboundMetadata = input.inboundMetadata ?? ({ channel: input.channel ?? "web" } as Prisma.InputJsonValue);
  const outboundMetadata = input.outboundMetadata ?? ({} as Prisma.InputJsonValue);
  const body = parseIntentSchema.parse(input);

  const organisation = await app.db.organisation.findUnique({
    where: { id: body.organisationId },
    include: { guardrailPolicy: true },
  });

  if (!organisation) {
    throw new IntakeHttpError(404, { error: "Organisation not found." });
  }

  if (!organisation.guardrailPolicy) {
    throw new IntakeHttpError(409, {
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
  const organisationMemory = await app.agents.memory.getOrganisationContext(body.organisationId, {
    purpose: "intake_default",
    audience: "employer",
  });

  let priorIntent: ParsedBookingIntent | null = null;
  let priorBookingRequestId: string | null = null;
  let priorMessages: { role: string; content: string }[] = [];
  if (body.conversationId) {
    const existing = await app.db.conversation.findUnique({
      where: { id: body.conversationId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!existing || existing.participantId !== body.organisationId) {
      throw new IntakeHttpError(404, { error: "Conversation not found." });
    }
    priorIntent = deserializeIntent(existing.extractedEntities as Record<string, unknown>);
    priorBookingRequestId = existing.bookingRequestId;
    priorMessages = existing.messages.map((m) => ({ role: m.role, content: m.content }));
  }

  intakeContext.sites = sites;
  intakeContext.memory = { summary: organisationMemory.summary };

  const parsePrompt = buildParsePrompt(body.rawInput, priorIntent, priorMessages);
  let parsedIntent: ParsedBookingIntent;
  try {
    const mergedIntent = mergeIntent(priorIntent, await app.agents.v.parseIntent(parsePrompt, intakeContext));
    const resolvedIntent = resolveSiteId(
      {
        ...mergedIntent,
        rateMode: body.rateMode ?? mergedIntent.rateMode ?? "standard",
      },
      sites,
      body.rawInput,
    );
    parsedIntent = stabiliseParsedIntent(
      resolvedIntent,
      [...priorMessages.map((m) => m.content), body.rawInput],
    );
    } catch (err) {
      const providerError = serializeError(err);
      log.warn({ err }, "V intake parse failed; using degraded fallback");
      const message = fallbackIntakeMessage();
      const fallbackSnapshot = {
        rawInput: body.rawInput,
        missingFields: FALLBACK_MISSING_FIELDS,
        degradedReason: "llm_unavailable",
        priorIntent: priorIntent ? serializeIntent(priorIntent) : null,
      };

      const persistence = await app.db.$transaction(async (tx) => {
        const messageRows = [
          {
            role: "employer",
            content: body.rawInput,
            metadata: inboundMetadata,
          },
          {
            role: "agent",
            content: message,
            metadata: {
              ...(typeof outboundMetadata === "object" && outboundMetadata !== null && !Array.isArray(outboundMetadata)
                ? outboundMetadata
                : {}),
              clarificationNeeded: true,
              missingFields: FALLBACK_MISSING_FIELDS,
              bookingRequestId: null,
              fallbackUsed: true,
              degradedReason: "llm_unavailable",
            } as Prisma.InputJsonValue,
          },
        ];

        const conversation = body.conversationId
          ? await tx.conversation.update({
              where: { id: body.conversationId },
              data: {
                messages: { create: messageRows },
              },
            })
          : await tx.conversation.create({
              data: {
                participantType: "employer",
                participantId: body.organisationId,
                channel: body.channel,
                intent: "booking_request",
                extractedEntities: fallbackSnapshot as Prisma.InputJsonValue,
                messages: { create: messageRows },
              },
            });

        const auditBase = {
          organisationId: body.organisationId,
          rawInput: body.rawInput,
          channel: body.channel,
          conversationId: body.conversationId ?? null,
          guardrails: guardrailSnapshot,
        };

        await tx.auditEvent.create({
          data: {
            actorType: "agent",
            actorId: "v",
            action: "intake.parse",
            entityType: "Conversation",
            entityId: conversation.id,
            inputs: auditBase as Prisma.InputJsonValue,
            outputs: {
              conversationId: conversation.id,
              bookingRequestId: null,
              fallbackUsed: true,
              degradedReason: "llm_unavailable",
              providerError,
            } as Prisma.InputJsonValue,
            outcome: "degraded_llm_unavailable",
          },
        });

        await tx.auditEvent.create({
          data: {
            actorType: "agent",
            actorId: "v",
            action: "intake.clarify",
            entityType: "Conversation",
            entityId: conversation.id,
            inputs: {
              ...auditBase,
              missingFields: FALLBACK_MISSING_FIELDS,
            } as Prisma.InputJsonValue,
            outputs: {
              message,
              conversationId: conversation.id,
              bookingRequestId: null,
              fallbackUsed: true,
              degradedReason: "llm_unavailable",
            } as Prisma.InputJsonValue,
            outcome: "degraded_llm_unavailable",
          },
        });

        return { conversationId: conversation.id };
      });

      return {
        intent: null,
        clarificationNeeded: true,
        message,
        bookingRequestId: null,
        conversationId: persistence.conversationId,
        fallbackUsed: true,
        degradedReason: "llm_unavailable",
      };
    }

    const missingFields = normalizeMissingFields(parsedIntent, intakeContext.guardrails);
    const intent: ParsedBookingIntent = { ...parsedIntent, missingFields };

    const intentSnapshot = serializeIntent(intent);
    const clarificationContext: Record<string, unknown> = {
      organisationId: body.organisationId,
      guardrails: guardrailSnapshot,
      priorIntent: intentSnapshot,
      knownSites: sites,
      memory: organisationMemory.summary,
    };

    const clarificationNeeded = missingFields.length > 0;
    let message: string;
    let responseFallbackUsed = false;
    let responseProviderError: Record<string, unknown> | undefined;
    try {
      message = clarificationNeeded
        ? await app.agents.v.clarify(missingFields, clarificationContext)
        : await app.agents.v.confirmIntent(intent);
    } catch (err) {
      log.warn({ err }, "V intake response generation failed; using deterministic response");
      responseFallbackUsed = true;
      responseProviderError = serializeError(err);
      message = clarificationNeeded ? fallbackClarificationMessage(missingFields) : fallbackConfirmationMessage(intent);
    }

    const persistence = await app.db.$transaction(async (tx) => {
      let bookingRequestId: string | undefined;
      let createdBookingRequest = false;
      const reusePriorBooking = Boolean(
        priorBookingRequestId &&
          !clarificationNeeded &&
          THANK_YOU_ONLY.test(body.rawInput.trim()),
      );

      if (reusePriorBooking && priorBookingRequestId) {
        bookingRequestId = priorBookingRequestId;
      } else if (!clarificationNeeded && intent.siteId && intent.payRate !== undefined) {
        const booking = await tx.bookingRequest.create({
          data: {
            organisationId: body.organisationId,
            siteId: intent.siteId,
            roleType: intent.roleType,
            startAt: intent.startAt,
            endAt: intent.endAt,
            payRate: intent.payRate,
            maxPayRate: intent.maxPayRate,
            rateMode: intent.rateMode ?? "standard",
            requirements: intent.requirements as Prisma.InputJsonValue | undefined,
            rawIntent: body.rawInput,
            channel: body.channel,
            status: "pending_confirmation",
            broadcastStrategy: "simultaneous_top_n",
          },
        });
        bookingRequestId = booking.id;
        createdBookingRequest = true;
      }

      const messageRows = [
        {
          role: "employer",
          content: body.rawInput,
          metadata: inboundMetadata,
        },
        {
          role: "agent",
          content: message,
          metadata: {
            ...(typeof outboundMetadata === "object" && outboundMetadata !== null && !Array.isArray(outboundMetadata)
              ? outboundMetadata
              : {}),
            clarificationNeeded,
            missingFields,
            bookingRequestId: bookingRequestId ?? null,
            fallbackUsed: responseFallbackUsed,
            degradedReason: responseFallbackUsed ? "llm_unavailable" : null,
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
            fallbackUsed: false,
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
            organisationId: body.organisationId,
            rawInput: body.rawInput,
            channel: body.channel,
            conversationId: body.conversationId ?? null,
            intent: intentSnapshot,
            missingFields,
            guardrails: guardrailSnapshot,
          } as Prisma.InputJsonValue,
          outputs: {
            message,
            conversationId: conversation.id,
            bookingRequestId: bookingRequestId ?? null,
            fallbackUsed: responseFallbackUsed,
            ...(responseProviderError ? { providerError: responseProviderError } : {}),
          } as Prisma.InputJsonValue,
          outcome: responseFallbackUsed
            ? "degraded_llm_unavailable"
            : clarificationNeeded
              ? "clarification_required"
              : "pending_confirmation",
        },
      });

      return { bookingRequestId, conversationId: conversation.id, createdBookingRequest };
    });

    if (!clarificationNeeded && persistence.bookingRequestId && persistence.createdBookingRequest) {
      const bookingRequest = await app.db.bookingRequest.findUnique({
        where: { id: persistence.bookingRequestId },
        include: { organisation: { include: { guardrailPolicy: true } } },
      });

      if (bookingRequest) {
        const ranking = await app.agents.market.rankCandidates(bookingRequest.id);
        if (ranking.success) {
          await app.agents.market.broadcastOffers(
            bookingRequest.id,
            bookingRequest.broadcastStrategy,
            bookingRequest.organisation.guardrailPolicy?.autonomyLevel ?? "L4",
          );
        }
      }
    }

    await app.agents.memory.recordInfluence({
      purpose: organisationMemory.audit.purpose,
      audience: organisationMemory.audit.audience,
      entityType: persistence.bookingRequestId ? "BookingRequest" : "Conversation",
      entityId: persistence.bookingRequestId ?? persistence.conversationId,
      action: clarificationNeeded ? "intake.clarify" : "intake.confirm",
      memoryIds: organisationMemory.audit.memoryIds,
      edgeIds: organisationMemory.audit.edgeIds,
      excluded: organisationMemory.audit.excluded,
      useScopes: organisationMemory.audit.useScopes,
      outcome: clarificationNeeded ? "clarification_required" : "pending_confirmation",
      note: "Organisation memory was supplied to V for intake defaults and clarification reduction.",
    });

    await app.agents.memory.rememberFromEvent({
      ownerType: "organisation",
      ownerId: body.organisationId,
      subjectType: persistence.bookingRequestId ? "booking_request" : "organisation",
      subjectId: persistence.bookingRequestId ?? body.organisationId,
      sourceRefType: persistence.bookingRequestId ? "BookingRequest" : "Conversation",
      sourceRefId: persistence.bookingRequestId ?? persistence.conversationId,
      text: `Employer intake turn: ${body.rawInput}\nV response: ${message}`,
      data: {
        intent: intentSnapshot,
        clarificationNeeded,
        missingFields,
        channel: body.channel,
      },
    }).catch((err) => log.warn({ err }, "memory inference failed after intake"));

    return {
      intent,
      clarificationNeeded,
      message,
      bookingRequestId: persistence.bookingRequestId,
      conversationId: persistence.conversationId,
      fallbackUsed: responseFallbackUsed,
      ...(responseFallbackUsed ? { degradedReason: "llm_unavailable" } : {}),
    };
}

export const intakeRoutes: FastifyPluginAsync = async (app) => {
  /** POST /v1/intake/parse - V-powered natural language intake (Phase 0) */
  app.post("/parse", async (request, reply) => {
    try {
      return await processIntakeTurn(app, request.log, request.body as ProcessIntakeTurnInput);
    } catch (err) {
      if (err instanceof IntakeHttpError) {
        return reply.code(err.statusCode).send(err.payload);
      }
      throw err;
    }
  });
};
