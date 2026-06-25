import type { PrismaClient } from "@viora/database";
import { createLLMClient } from "./llm.js";
import type { WorkerContextAgent } from "./types.js";

export function createWorkerContextAgent(db: PrismaClient): WorkerContextAgent {
  return {
    async surfaceNextOffer(workerId) {
      const offer = await db.offer.findFirst({
        where: {
          workerId,
          status: "pending",
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: "asc" },
        include: {
          bookingRequest: {
            include: { site: true },
          },
        },
      });

      await db.auditEvent.create({
        data: {
          actorType: "agent",
          actorId: "worker_context",
          action: "offer.surfaced",
          entityType: "Worker",
          entityId: workerId,
          inputs: { workerId },
          outputs: { offerId: offer?.id ?? null, hasOffer: offer !== null },
          outcome: offer ? "offer_found" : "no_offer",
        },
      });

      return {
        success: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: offer as any,
        explanation: offer ? "Next offer surfaced." : "No pending offers available.",
        requiresHumanApproval: false,
        auditPayload: { workerId, offerId: offer?.id ?? null },
      };
    },

    async explainFit(offerId) {
      const offer = await db.offer.findUnique({
        where: { id: offerId },
        include: {
          match: true,
          bookingRequest: { include: { site: true } },
          worker: { include: { passport: true } },
        },
      });

      if (!offer) return "This shift matches your profile and location.";

      // Return cached explanation if already upgraded from the broadcast template
      const templateReasoning = offer.match?.reasoning ?? null;
      const knownTemplates = new Set([
        "Manual admin assignment.",
        "This shift matches your profile and location.",
      ]);
      if (offer.fitExplanation !== templateReasoning && !knownTemplates.has(offer.fitExplanation)) {
        return offer.fitExplanation;
      }

      const context = {
        worker: {
          firstName: offer.worker.firstName,
          roleTypes: offer.worker.roleTypes,
          workRadiusKm: offer.worker.workRadiusKm ?? 25,
          reliabilityScore: offer.worker.passport?.reliabilityScore ?? null,
        },
        shift: {
          roleType: offer.bookingRequest.roleType,
          startAt: offer.bookingRequest.startAt.toISOString(),
          endAt: offer.bookingRequest.endAt.toISOString(),
          payRate: offer.payRate,
          site: {
            name: offer.bookingRequest.site.name,
            address: offer.bookingRequest.site.address,
          },
        },
        matchReasoning: offer.match?.reasoning ?? null,
        memory: await loadOfferMemoryContext(db, offer.workerId, offer.bookingRequest.organisationId, offer.bookingRequest.siteId),
      };

      const fallback = offer.fitExplanation ?? "This shift matches your profile and location.";

      try {
        const llm = await createLLMClient();
        const text = await llm.complete({
          maxTokens: 300,
          system:
            "You are Viora, a friendly staffing platform assistant. Write 2–3 warm sentences explaining to the worker why this shift is a great fit for them. Be specific, encouraging, and concise. Output only the explanation — no preamble.",
          prompt: JSON.stringify(context),
        });

        if (text) {
          await db.offer
            .update({ where: { id: offerId }, data: { fitExplanation: text } })
            .catch(() => {});
          return text;
        }
        return fallback;
      } catch {
        return fallback;
      }
    },
  };
}

async function loadOfferMemoryContext(
  db: PrismaClient,
  workerId: string,
  organisationId: string,
  siteId: string,
): Promise<string> {
  const [workerEntries, workerEdges, organisationEntries, organisationEdges] = await Promise.all([
    db.memoryEntry.findMany({
      where: {
        ownerType: "worker",
        ownerId: workerId,
        status: "active",
        visibility: { in: ["private", "operational", "shared"] },
      },
      orderBy: [{ confidence: "desc" }, { updatedAt: "desc" }],
      take: 6,
    }),
    db.memoryEdge.findMany({
      where: {
        ownerType: "worker",
        ownerId: workerId,
        status: "active",
        visibility: { in: ["private", "operational", "shared"] },
      },
      orderBy: [{ weight: "desc" }, { confidence: "desc" }],
      take: 6,
    }),
    db.memoryEntry.findMany({
      where: {
        ownerType: "organisation",
        ownerId: organisationId,
        status: "active",
        visibility: { in: ["operational", "shared"] },
        OR: [{ subjectType: "organisation" }, { subjectType: "site", subjectId: siteId }],
      },
      orderBy: [{ confidence: "desc" }, { updatedAt: "desc" }],
      take: 6,
    }),
    db.memoryEdge.findMany({
      where: {
        ownerType: "organisation",
        ownerId: organisationId,
        status: "active",
        visibility: { in: ["operational", "shared"] },
        OR: [{ fromId: siteId }, { toId: siteId }],
      },
      orderBy: [{ weight: "desc" }, { confidence: "desc" }],
      take: 6,
    }),
  ]);

  const entries = [...workerEntries, ...organisationEntries].map((m) => `- ${m.title}: ${m.content}`);
  const edges = [...workerEdges, ...organisationEdges].map(
    (e) => `- ${e.label} (${e.kind}, weight ${e.weight.toFixed(2)})`,
  );
  return [...entries, ...edges].join("\n");
}
