import type { PrismaClient } from "@viora/database";
import { createLLMClient } from "./llm.js";
import type { MemoryAgent, WorkerContextAgent } from "./types.js";
import { normalizeVFirstPerson, V_FIRST_PERSON_VOICE_RULE } from "./v-copy.js";

export function createWorkerContextAgent(db: PrismaClient, memory: MemoryAgent): WorkerContextAgent {
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
        return normalizeVFirstPerson(offer.fitExplanation);
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
        memory: (await memory.getOfferContext(offerId, { audience: "worker" })).summary,
      };

      const fallback = offer.fitExplanation ?? "This shift matches your profile and location.";

      try {
        const llm = await createLLMClient({ task: "explainFit" });
        const text = await llm.complete({
          maxTokens: 300,
          system:
            `You are V, a friendly staffing platform assistant for Viora. Write 2-3 warm sentences explaining to the worker why this shift is a great fit for them. Be specific, encouraging, and concise. ${V_FIRST_PERSON_VOICE_RULE} Output only the explanation - no preamble.`,
          prompt: JSON.stringify(context),
        });

        if (text) {
          const normalized = normalizeVFirstPerson(text);
          await db.offer
            .update({ where: { id: offerId }, data: { fitExplanation: normalized } })
            .catch(() => {});
          const offerMemory = await memory.getOfferContext(offerId, { audience: "worker" });
          await memory.recordInfluence({
            purpose: offerMemory.audit.purpose,
            audience: offerMemory.audit.audience,
            entityType: "Offer",
            entityId: offerId,
            action: "offer.explain_fit",
            memoryIds: offerMemory.audit.memoryIds,
            edgeIds: offerMemory.audit.edgeIds,
            excluded: offerMemory.audit.excluded,
            useScopes: offerMemory.audit.useScopes,
            outcome: "explanation_generated",
            note: "Worker-facing explanation may include the worker's own private profile memory.",
          });
          return normalized;
        }
        return normalizeVFirstPerson(fallback);
      } catch {
        return normalizeVFirstPerson(fallback);
      }
    },
  };
}
