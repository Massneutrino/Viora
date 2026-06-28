import type { Prisma, PrismaClient } from "@viora/database";
import type {
  MemoryAudience,
  MemoryKind,
  MemoryOwnerType,
  MemorySourceType,
  MemorySubjectType,
  MemoryUseScope,
  MemoryVisibility,
} from "@viora/domain";
import { validateMemoryValue } from "@viora/domain";
import { createLLMClient } from "./llm.js";
import type { AgentActionResult, MemoryAgent, MemoryContext, MemoryEventInput } from "./types.js";

const AUTO_ACTIVATE_CONFIDENCE = 0.78;

const MEMORY_KINDS = new Set<MemoryKind>([
  "preference",
  "instruction",
  "pattern",
  "risk",
  "fit_signal",
  "briefing_note",
  "availability_signal",
  "pay_signal",
  "feedback_summary",
]);

const MEMORY_VISIBILITIES = new Set<MemoryVisibility>(["private", "operational", "shared"]);
const DEFAULT_PURPOSE: MemoryUseScope = "profile";
const ORG_OPERATIONAL_SCOPES: MemoryUseScope[] = [
  "intake_default",
  "ranking_signal",
  "briefing",
  "explanation",
  "connector_export",
];
const WORKER_OPERATIONAL_SCOPES: MemoryUseScope[] = ["profile", "ranking_signal", "briefing", "explanation"];

type MemoryCandidate = {
  kind: string;
  key?: string;
  title: string;
  content: string;
  value?: Record<string, unknown>;
  confidence: number;
  visibility: string;
  sensitive?: boolean;
};

type MemoryExtraction = {
  candidates: MemoryCandidate[];
};

const MEMORY_EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    candidates: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: {
            type: "string",
            enum: [
              "preference",
              "instruction",
              "pattern",
              "risk",
              "fit_signal",
              "briefing_note",
              "availability_signal",
              "pay_signal",
              "feedback_summary",
            ],
          },
          key: { type: "string" },
          title: { type: "string" },
          content: { type: "string" },
          value: { type: "object", additionalProperties: true },
          confidence: { type: "number" },
          visibility: { type: "string", enum: ["private", "operational", "shared"] },
          sensitive: { type: "boolean" },
        },
        required: ["kind", "title", "content", "confidence", "visibility", "sensitive"],
      },
    },
  },
  required: ["candidates"],
} as const;

function cleanText(value: string, max = 1200): string {
  return value.trim().slice(0, max);
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function normalizeKind(value: string): MemoryKind {
  return MEMORY_KINDS.has(value as MemoryKind) ? (value as MemoryKind) : "pattern";
}

function normalizeVisibility(value: string, ownerType: MemoryOwnerType): MemoryVisibility {
  if (!MEMORY_VISIBILITIES.has(value as MemoryVisibility)) return "operational";
  const visibility = value as MemoryVisibility;
  if (ownerType === "worker" && visibility === "shared") return "operational";
  return visibility;
}

function memoryStatus(candidate: MemoryCandidate, visibility: MemoryVisibility): "active" | "pending_confirmation" {
  if (candidate.sensitive || visibility === "private") return "pending_confirmation";
  return candidate.confidence >= AUTO_ACTIVATE_CONFIDENCE ? "active" : "pending_confirmation";
}

function defaultUseScopes(ownerType: MemoryOwnerType, visibility: MemoryVisibility): MemoryUseScope[] {
  if (ownerType === "organisation") return ORG_OPERATIONAL_SCOPES;
  return visibility === "private" ? ["profile"] : WORKER_OPERATIONAL_SCOPES;
}

function uniqueScopes(scopes: MemoryUseScope[]): MemoryUseScope[] {
  return [...new Set(scopes)];
}

function summarizeContext(entries: MemoryContext["entries"], edges: MemoryContext["edges"]): string {
  const entryLines = entries.slice(0, 8).map((m) => `- ${m.title}: ${m.content}`);
  const edgeLines = edges
    .slice(0, 8)
    .map((e) => `- ${e.label} (${e.kind}, weight ${e.weight.toFixed(2)}, confidence ${e.confidence.toFixed(2)})`);
  return [...entryLines, ...edgeLines].join("\n");
}

function contextAudit(
  purpose: MemoryUseScope,
  audience: MemoryAudience,
  entries: MemoryContext["entries"],
  edges: MemoryContext["edges"],
): MemoryContext["audit"] {
  return {
    purpose,
    audience,
    memoryIds: entries.map((m) => m.id),
    edgeIds: edges.map((e) => e.id),
    useScopes: uniqueScopes(entries.flatMap((m) => m.useScopes)),
  };
}

function buildContext(
  purpose: MemoryUseScope,
  audience: MemoryAudience,
  entries: MemoryContext["entries"],
  edges: MemoryContext["edges"],
): MemoryContext {
  return {
    entries,
    edges,
    summary: summarizeContext(entries, edges),
    audit: contextAudit(purpose, audience, entries, edges),
  };
}

function activeMemoryWhere(purpose: MemoryUseScope): Prisma.MemoryEntryWhereInput {
  return {
    status: "active",
    useScopes: { has: purpose },
    AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
  };
}

function workerVisibilityFor(audience: MemoryAudience, includePrivate?: boolean): MemoryVisibility[] {
  if (audience === "worker" || audience === "owner" || includePrivate) return ["private", "operational", "shared"];
  return ["operational", "shared"];
}

function evidenceRefs(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

async function writeMemoryAudit(
  db: PrismaClient,
  action: string,
  entityType: string,
  entityId: string,
  inputs: Prisma.InputJsonValue,
  outputs: Prisma.InputJsonValue,
  outcome: string,
) {
  await db.auditEvent.create({
    data: {
      actorType: "agent",
      actorId: "memory",
      action,
      entityType,
      entityId,
      inputs,
      outputs,
      outcome,
    },
  });
}

export function createMemoryAgent(db: PrismaClient): MemoryAgent {
  async function createInferredEntries(input: MemoryEventInput, extraction: MemoryExtraction) {
    const created = [];
    for (const candidate of extraction.candidates) {
      const title = cleanText(candidate.title, 160);
      const content = cleanText(candidate.content);
      if (!title || !content) continue;

      const kind = normalizeKind(candidate.kind);
      const visibility = normalizeVisibility(candidate.visibility, input.ownerType);
      const key = candidate.key ? slug(candidate.key) : `${kind}_${slug(title)}`;
      const confidence = Math.max(0, Math.min(1, candidate.confidence));
      const status = memoryStatus({ ...candidate, confidence }, visibility);
      const useScopes: MemoryUseScope[] = candidate.sensitive ? ["profile"] : defaultUseScopes(input.ownerType, visibility);
      const valueValidation = validateMemoryValue(kind, candidate.value);
      if (!valueValidation.ok) continue;

      const duplicate = await db.memoryEntry.findFirst({
        where: {
          ownerType: input.ownerType,
          ownerId: input.ownerId,
          key,
          sourceRefType: input.sourceRefType,
          sourceRefId: input.sourceRefId,
          status: { not: "deleted" },
        },
      });
      if (duplicate) continue;

      const memory = await db.memoryEntry.create({
        data: {
          ownerType: input.ownerType,
          ownerId: input.ownerId,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          kind,
          key,
          title,
          content,
          value: candidate.value as Prisma.InputJsonValue | undefined,
          sourceType: "agent_inferred",
          sourceRefType: input.sourceRefType,
          sourceRefId: input.sourceRefId,
          visibility,
          status,
          useScopes,
          sensitivity: candidate.sensitive || visibility === "private" ? "sensitive" : "standard",
          sourceLabel: "Viora Memory inference",
          confidence,
          confirmedAt: status === "active" ? new Date() : undefined,
          confirmedBy: status === "active" ? "memory" : undefined,
        },
      });
      created.push(memory);
    }
    return created;
  }

  async function reinforceEdge(input: {
    ownerType: MemoryOwnerType;
    ownerId: string;
    fromType: MemorySubjectType;
    fromId: string;
    toType: MemorySubjectType;
    toId: string;
    kind: MemoryKind;
    label: string;
    delta: number;
    confidence: number;
    sourceType: MemorySourceType;
    sourceRefType?: string;
    sourceRefId?: string;
    visibility?: MemoryVisibility;
    entityType?: string;
    entityId?: string;
    outcome?: string;
    metadata?: Prisma.InputJsonValue;
  }) {
    const occurredAt = new Date();
    const evidenceRef = {
      sourceType: input.sourceType,
      sourceRefType: input.sourceRefType ?? null,
      sourceRefId: input.sourceRefId ?? null,
      entityType: input.entityType ?? input.sourceRefType ?? null,
      entityId: input.entityId ?? input.sourceRefId ?? null,
      outcome: input.outcome ?? "observed",
      occurredAt: occurredAt.toISOString(),
      delta: input.delta,
      confidence: input.confidence,
    };
    const existing = await db.memoryEdge.findFirst({
      where: {
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        fromType: input.fromType,
        fromId: input.fromId,
        toType: input.toType,
        toId: input.toId,
        kind: input.kind,
      },
    });
    let edge;
    if (existing) {
      edge = await db.memoryEdge.update({
        where: { id: existing.id },
        data: {
          weight: Math.max(-1, Math.min(1, existing.weight + input.delta)),
          confidence: Math.max(existing.confidence, input.confidence),
          evidenceCount: { increment: 1 },
          label: input.label,
          sourceType: input.sourceType,
          sourceRefType: input.sourceRefType,
          sourceRefId: input.sourceRefId,
          status: "active",
          lastEvidenceAt: occurredAt,
          evidenceRefs: [...evidenceRefs(existing.evidenceRefs), evidenceRef].slice(-20) as Prisma.InputJsonValue,
        },
      });
    } else {
      edge = await db.memoryEdge.create({
        data: {
          ownerType: input.ownerType,
          ownerId: input.ownerId,
          fromType: input.fromType,
          fromId: input.fromId,
          toType: input.toType,
          toId: input.toId,
          kind: input.kind,
          label: input.label,
          weight: Math.max(-1, Math.min(1, input.delta)),
          confidence: input.confidence,
          sourceType: input.sourceType,
          sourceRefType: input.sourceRefType,
          sourceRefId: input.sourceRefId,
          visibility: input.visibility ?? "operational",
          validFrom: occurredAt,
          lastEvidenceAt: occurredAt,
          decayPolicy: "none",
          evidenceRefs: [evidenceRef] as Prisma.InputJsonValue,
        },
      });
    }

    await db.memoryEpisode.create({
      data: {
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        subjectType: input.toType,
        subjectId: input.toId,
        kind: input.kind,
        label: input.label,
        sourceType: input.sourceType,
        sourceRefType: input.sourceRefType,
        sourceRefId: input.sourceRefId,
        entityType: input.entityType ?? input.sourceRefType,
        entityId: input.entityId ?? input.sourceRefId,
        outcome: input.outcome ?? "observed",
        occurredAt,
        affectedMemoryIds: [],
        affectedEdgeIds: [edge.id],
        metadata: {
          ...jsonObject(input.metadata),
          fromType: input.fromType,
          fromId: input.fromId,
          toType: input.toType,
          toId: input.toId,
          delta: input.delta,
          confidence: input.confidence,
          edgeWeight: edge.weight,
        } as Prisma.InputJsonValue,
      },
    });

    return edge;
  }

  return {
    async rememberFromEvent(input) {
      const system =
        "You write Viora Memory: durable, useful memories for a regulated flexible-staffing " +
        "platform. Extract only reusable facts, preferences, patterns, risks, briefing notes, " +
        "or fit signals grounded in the event. Do not infer compliance eligibility. Mark private " +
        "or sensitive memories conservatively.";
      const prompt = JSON.stringify({
        event: input.text,
        data: input.data ?? {},
        ownerType: input.ownerType,
        subjectType: input.subjectType,
      });

      try {
        const llm = await createLLMClient();
        const extraction = await llm.structured<MemoryExtraction>({
          system,
          prompt,
          toolName: "write_viora_memory",
          toolDescription: "Extract structured Viora Memory candidates from a staffing event.",
          schema: MEMORY_EXTRACTION_SCHEMA,
          maxTokens: 1400,
        });
        const memories = await createInferredEntries(input, extraction);
        await writeMemoryAudit(
          db,
          "memory.infer",
          input.subjectType,
          input.subjectId,
          input as unknown as Prisma.InputJsonValue,
          { memoryIds: memories.map((m) => m.id), count: memories.length } as Prisma.InputJsonValue,
          memories.length > 0 ? "created" : "no_memory",
        );
        return {
          success: true,
          data: memories,
          explanation: `${memories.length} memory candidate(s) written.`,
          requiresHumanApproval: memories.some((m) => m.status === "pending_confirmation"),
          auditPayload: { memoryIds: memories.map((m) => m.id) },
        };
      } catch (err) {
        await writeMemoryAudit(
          db,
          "memory.infer",
          input.subjectType,
          input.subjectId,
          input as unknown as Prisma.InputJsonValue,
          { error: err instanceof Error ? err.message : String(err) } as Prisma.InputJsonValue,
          "degraded_llm_unavailable",
        );
        return {
          success: false,
          data: [],
          explanation: "Memory inference unavailable.",
          requiresHumanApproval: false,
          auditPayload: { error: "llm_unavailable" },
        };
      }
    },

    async recordOfferOutcome(offerId, outcome) {
      const offer = await db.offer.findUnique({
        where: { id: offerId },
        include: { bookingRequest: { include: { site: true } }, worker: true },
      });
      if (!offer) {
        return {
          success: false,
          explanation: "Offer not found.",
          requiresHumanApproval: false,
          auditPayload: { offerId, error: "not_found" },
        };
      }

      const site = offer.bookingRequest.site;
      const role = offer.bookingRequest.roleType;
      const delta = outcome === "accepted" ? 0.18 : -0.1;
      const confidence = outcome === "accepted" ? 0.72 : 0.58;
      await Promise.all([
        reinforceEdge({
          ownerType: "worker",
          ownerId: offer.workerId,
          fromType: "worker",
          fromId: offer.workerId,
          toType: "site",
          toId: site.id,
          kind: "fit_signal",
          label: `${offer.worker.firstName} ${outcome} an offer at ${site.name}`,
          delta,
          confidence,
          sourceType: "system_event",
          sourceRefType: "Offer",
          sourceRefId: offer.id,
          visibility: "operational",
          entityType: "Offer",
          entityId: offer.id,
          outcome,
          metadata: { bookingRequestId: offer.bookingRequestId, roleType: role, siteId: site.id } as Prisma.InputJsonValue,
        }),
        reinforceEdge({
          ownerType: "worker",
          ownerId: offer.workerId,
          fromType: "worker",
          fromId: offer.workerId,
          toType: "role",
          toId: role,
          kind: "fit_signal",
          label: `${offer.worker.firstName} ${outcome} a ${role} offer`,
          delta,
          confidence,
          sourceType: "system_event",
          sourceRefType: "Offer",
          sourceRefId: offer.id,
          visibility: "operational",
          entityType: "Offer",
          entityId: offer.id,
          outcome,
          metadata: { bookingRequestId: offer.bookingRequestId, roleType: role, siteId: site.id } as Prisma.InputJsonValue,
        }),
        reinforceEdge({
          ownerType: "organisation",
          ownerId: offer.bookingRequest.organisationId,
          fromType: "site",
          fromId: site.id,
          toType: "role",
          toId: role,
          kind: "pattern",
          label: `${site.name} generated a ${outcome} ${role} offer`,
          delta: outcome === "accepted" ? 0.08 : -0.04,
          confidence,
          sourceType: "system_event",
          sourceRefType: "Offer",
          sourceRefId: offer.id,
          visibility: "operational",
          entityType: "Offer",
          entityId: offer.id,
          outcome,
          metadata: { bookingRequestId: offer.bookingRequestId, roleType: role, siteId: site.id } as Prisma.InputJsonValue,
        }),
      ]);

      await writeMemoryAudit(
        db,
        "memory.edge.update",
        "Offer",
        offerId,
        { offerId, outcome } as Prisma.InputJsonValue,
        { workerId: offer.workerId, siteId: site.id, roleType: role } as Prisma.InputJsonValue,
        "updated",
      );

      return {
        success: true,
        explanation: "Memory graph updated from offer outcome.",
        requiresHumanApproval: false,
        auditPayload: { offerId, outcome },
      };
    },

    async recordShiftEvent(shiftId, outcome) {
      const shift = await db.shift.findUnique({
        where: { id: shiftId },
        include: { booking: { include: { site: true, worker: true } } },
      });
      if (!shift) {
        return {
          success: false,
          explanation: "Shift not found.",
          requiresHumanApproval: false,
          auditPayload: { shiftId, error: "not_found" },
        };
      }

      const positive = outcome === "checked_out" || outcome === "completed";
      const delta = positive ? 0.12 : outcome.includes("rejected") || outcome.includes("no_show") ? -0.2 : 0.03;
      await reinforceEdge({
        ownerType: "worker",
        ownerId: shift.booking.workerId,
        fromType: "worker",
        fromId: shift.booking.workerId,
        toType: "site",
        toId: shift.booking.siteId,
        kind: positive ? "fit_signal" : "risk",
        label: `${shift.booking.worker.firstName} shift event at ${shift.booking.site.name}: ${outcome}`,
        delta,
        confidence: positive ? 0.75 : 0.65,
        sourceType: "system_event",
        sourceRefType: "Shift",
        sourceRefId: shift.id,
        entityType: "Shift",
        entityId: shift.id,
        outcome,
        metadata: {
          bookingId: shift.bookingId,
          workerId: shift.booking.workerId,
          siteId: shift.booking.siteId,
        } as Prisma.InputJsonValue,
      });

      await writeMemoryAudit(
        db,
        "memory.edge.update",
        "Shift",
        shiftId,
        { shiftId, outcome } as Prisma.InputJsonValue,
        { workerId: shift.booking.workerId, siteId: shift.booking.siteId } as Prisma.InputJsonValue,
        "updated",
      );

      return {
        success: true,
        explanation: "Memory graph updated from shift event.",
        requiresHumanApproval: false,
        auditPayload: { shiftId, outcome },
      };
    },

    async recordFeedbackEvent(feedbackId) {
      const feedback = await db.feedback.findUnique({
        where: { id: feedbackId },
        include: {
          shift: {
            include: {
              booking: {
                include: {
                  site: true,
                  worker: true,
                  organisation: true,
                },
              },
            },
          },
        },
      });
      if (!feedback) {
        return {
          success: false,
          explanation: "Feedback not found.",
          requiresHumanApproval: false,
          auditPayload: { feedbackId, error: "not_found" },
        };
      }

      const booking = feedback.shift.booking;
      const rating = feedback.rating ?? null;
      const positive = rating !== null && rating >= 4 && !feedback.contested;
      const negative = feedback.contested || (rating !== null && rating <= 2);
      const kind = feedback.fromType === "organisation"
        ? positive
          ? "fit_signal"
          : negative
            ? "risk"
            : "feedback_summary"
        : "feedback_summary";
      const ownerType = feedback.fromType === "organisation" ? "worker" : "organisation";
      const ownerId = feedback.fromType === "organisation" ? booking.workerId : booking.organisationId;
      const delta = feedback.fromType === "organisation"
        ? positive
          ? 0.16
          : negative
            ? -0.18
            : 0.04
        : positive
          ? 0.08
          : negative
            ? -0.08
            : 0.03;
      const confidence = feedback.contested ? 0.45 : positive || negative ? 0.74 : 0.58;
      const outcome = feedback.contested ? "contested" : rating === null ? "commented" : `rating_${rating}`;
      const label = feedback.fromType === "organisation"
        ? `${booking.organisation.name} feedback for ${booking.worker.firstName} at ${booking.site.name}: ${outcome}`
        : `${booking.worker.firstName} feedback about ${booking.site.name}: ${outcome}`;

      await reinforceEdge({
        ownerType,
        ownerId,
        fromType: ownerType,
        fromId: ownerId,
        toType: "site",
        toId: booking.siteId,
        kind,
        label,
        delta,
        confidence,
        sourceType: "feedback",
        sourceRefType: "Feedback",
        sourceRefId: feedback.id,
        entityType: "Feedback",
        entityId: feedback.id,
        outcome,
        metadata: {
          feedbackId: feedback.id,
          shiftId: feedback.shiftId,
          bookingId: booking.id,
          organisationId: booking.organisationId,
          workerId: booking.workerId,
          siteId: booking.siteId,
          roleType: booking.roleType,
          rating,
          comment: feedback.comment,
          contested: feedback.contested,
          feedbackFromType: feedback.fromType,
          feedbackFromId: feedback.fromId,
        } as Prisma.InputJsonValue,
      });

      await writeMemoryAudit(
        db,
        "memory.feedback.learn",
        "Feedback",
        feedback.id,
        { feedbackId, fromType: feedback.fromType, rating, contested: feedback.contested } as Prisma.InputJsonValue,
        { ownerType, ownerId, siteId: booking.siteId, roleType: booking.roleType, kind } as Prisma.InputJsonValue,
        "recorded",
      );

      return {
        success: true,
        explanation: "Memory graph updated from shift feedback.",
        requiresHumanApproval: false,
        auditPayload: { feedbackId, ownerType, ownerId, kind },
      };
    },

    async recordInfluence(input) {
      if (input.memoryIds.length === 0 && (input.edgeIds ?? []).length === 0) return;
      await writeMemoryAudit(
        db,
        "memory.influence",
        input.entityType,
        input.entityId,
        {
          purpose: input.purpose,
          audience: input.audience,
          action: input.action,
          memoryIds: input.memoryIds,
          edgeIds: input.edgeIds ?? [],
          useScopes: input.useScopes,
          note: input.note ?? null,
          metadata: input.metadata ?? null,
        } as Prisma.InputJsonValue,
        {
          influencedAction: input.action,
          memoryCount: input.memoryIds.length,
          edgeCount: input.edgeIds?.length ?? 0,
          metadata: input.metadata ?? null,
        } as Prisma.InputJsonValue,
        input.outcome,
      );
    },

    async getOrganisationContext(organisationId, opts) {
      const purpose = opts?.purpose ?? "intake_default";
      const audience = opts?.audience ?? "employer";
      const entries = await db.memoryEntry.findMany({
        where: {
          ...activeMemoryWhere(purpose),
          ownerType: "organisation",
          ownerId: organisationId,
          visibility: { in: ["operational", "shared"] },
          ...(opts?.siteId
            ? { OR: [{ subjectType: "organisation" }, { subjectType: "site", subjectId: opts.siteId }] }
            : {}),
        },
        orderBy: [{ confidence: "desc" }, { updatedAt: "desc" }],
        take: 20,
      });
      const edges = await db.memoryEdge.findMany({
        where: {
          ownerType: "organisation",
          ownerId: organisationId,
          status: "active",
          visibility: { in: ["operational", "shared"] },
          sourceRefType: { not: "MemoryEntry" },
          ...(opts?.siteId ? { OR: [{ fromId: opts.siteId }, { toId: opts.siteId }] } : {}),
        },
        orderBy: [{ confidence: "desc" }, { updatedAt: "desc" }],
        take: 20,
      });
      return buildContext(purpose, audience, entries, edges);
    },

    async getWorkerContext(workerId, opts) {
      const purpose = opts?.purpose ?? "profile";
      const audience = opts?.audience ?? "worker";
      const visibility = workerVisibilityFor(audience, opts?.includePrivate);
      const entries = await db.memoryEntry.findMany({
        where: {
          ...activeMemoryWhere(purpose),
          ownerType: "worker",
          ownerId: workerId,
          visibility: { in: visibility as MemoryVisibility[] },
        },
        orderBy: [{ confidence: "desc" }, { updatedAt: "desc" }],
        take: 20,
      });
      const edges = await db.memoryEdge.findMany({
        where: {
          ownerType: "worker",
          ownerId: workerId,
          status: "active",
          visibility: { in: visibility as MemoryVisibility[] },
          sourceRefType: { not: "MemoryEntry" },
          ...(opts?.siteId || opts?.roleType
            ? {
                OR: [
                  ...(opts.siteId ? [{ toType: "site" as const, toId: opts.siteId }] : []),
                  ...(opts.roleType ? [{ toType: "role" as const, toId: opts.roleType }] : []),
                ],
              }
            : {}),
        },
        orderBy: [{ weight: "desc" }, { confidence: "desc" }],
        take: 20,
      });
      return buildContext(purpose, audience, entries, edges);
    },

    async getWorkerRankingContext(workerIds, opts) {
      const purpose: MemoryUseScope = "ranking_signal";
      const audience: MemoryAudience = "employer";
      const [entries, edges] = await Promise.all([
        db.memoryEntry.findMany({
          where: {
            ...activeMemoryWhere(purpose),
            ownerType: "worker",
            ownerId: { in: workerIds },
            visibility: { in: ["operational", "shared"] },
          },
          orderBy: [{ confidence: "desc" }, { updatedAt: "desc" }],
          take: 100,
        }),
        db.memoryEdge.findMany({
          where: {
            ownerType: "worker",
            ownerId: { in: workerIds },
            status: "active",
            visibility: { in: ["operational", "shared"] },
            AND: [
              {
                OR: [
                  { toType: "site", toId: opts.siteId },
                  { toType: "role", toId: opts.roleType },
                ],
              },
            ],
          },
          orderBy: [{ weight: "desc" }, { confidence: "desc" }],
          take: 100,
        }),
      ]);
      return buildContext(purpose, audience, entries, edges);
    },

    async getOfferContext(offerId, opts) {
      const offer = await db.offer.findUnique({
        where: { id: offerId },
        include: { bookingRequest: true },
      });
      const audience = opts?.audience ?? "worker";
      if (!offer) return buildContext("explanation", audience, [], []);
      const [worker, organisation] = await Promise.all([
        this.getWorkerContext(offer.workerId, {
          audience,
          purpose: "explanation",
          includePrivate: audience === "worker",
          siteId: offer.bookingRequest.siteId,
          roleType: offer.bookingRequest.roleType,
        }),
        this.getOrganisationContext(offer.bookingRequest.organisationId, {
          purpose: "explanation",
          audience,
          siteId: offer.bookingRequest.siteId,
        }),
      ]);
      const entries = [...worker.entries, ...organisation.entries];
      const edges = [...worker.edges, ...organisation.edges];
      return buildContext("explanation", audience, entries, edges);
    },
  };
}
