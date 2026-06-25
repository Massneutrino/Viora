import { haversineKm } from "@viora/domain";
import type { PrismaClient } from "@viora/database";
import type { MarketAgent, MemoryAgent, TrustComplianceAgent } from "./types.js";

export function createMarketAgent(
  db: PrismaClient,
  compliance: TrustComplianceAgent,
  memory: MemoryAgent,
): MarketAgent {
  return {
    async rankCandidates(bookingRequestId, limit = 20) {
      const bookingRequest = await db.bookingRequest.findUnique({
        where: { id: bookingRequestId },
        include: {
          site: true,
          organisation: { include: { guardrailPolicy: true } },
        },
      });

      if (!bookingRequest) {
        return {
          success: false,
          data: [],
          explanation: "BookingRequest not found.",
          requiresHumanApproval: true,
          auditPayload: { bookingRequestId, error: "not_found" },
        };
      }

      const { site } = bookingRequest;
      const guardrail = bookingRequest.organisation.guardrailPolicy;

      if (!site.latitude || !site.longitude) {
        return {
          success: false,
          data: [],
          explanation: "Site has no coordinates — cannot rank by commute.",
          requiresHumanApproval: true,
          auditPayload: { bookingRequestId, siteId: site.id, error: "missing_site_coordinates" },
        };
      }

      const workers = await db.worker.findMany({
        where: {
          roleTypes: { has: bookingRequest.roleType },
          homeLatitude: { not: null },
          homeLongitude: { not: null },
        },
        include: { passport: true },
      });
      const workerIds = workers.map((worker) => worker.id);
      const rankingMemory = await memory.getWorkerRankingContext(workerIds, {
        siteId: site.id,
        roleType: bookingRequest.roleType,
      });
      const memoryEdges = rankingMemory.edges;

      type Candidate = {
        workerId: string;
        score: number;
        reasoning: string;
        scores: Record<string, number>;
      };

      const candidates: Candidate[] = [];

      // Phase 0: sequential compliance checks — batch at Phase 1
      for (const worker of workers) {
        if (!worker.homeLatitude || !worker.homeLongitude) continue;

        const distanceKm = haversineKm(
          worker.homeLatitude,
          worker.homeLongitude,
          site.latitude,
          site.longitude,
        );

        const radiusKm = worker.workRadiusKm ?? 25;
        if (distanceKm > radiusKm) continue;

        if (guardrail?.maxCommuteMinutes) {
          const approxMinutes = distanceKm / 0.5;
          if (approxMinutes > guardrail.maxCommuteMinutes) continue;
        }

        const eligibility = await compliance.checkEligibility(worker.id, bookingRequestId);
        if (!eligibility.eligible) continue;

        const commuteScore = Math.max(0, Math.min(1, 1 - distanceKm / radiusKm));
        const reliabilityScore = worker.passport?.reliabilityScore ?? 0.5;
        const workerMemoryEdges = memoryEdges.filter((edge) => edge.ownerId === worker.id);
        const memoryScore = Math.max(
          -1,
          Math.min(1, workerMemoryEdges.reduce((sum, edge) => sum + edge.weight * edge.confidence, 0)),
        );
        const normalizedMemoryScore = (memoryScore + 1) / 2;
        const finalScore =
          reliabilityScore * 0.45 + commuteScore * 0.25 + normalizedMemoryScore * 0.2 + 0.1;
        const memoryReason =
          workerMemoryEdges.length > 0
            ? `, memory fit ${normalizedMemoryScore.toFixed(2)}`
            : "";

        candidates.push({
          workerId: worker.id,
          score: finalScore,
          reasoning: `${distanceKm.toFixed(1)} km away, reliability score ${reliabilityScore.toFixed(2)}${memoryReason}`,
          scores: { commuteKm: distanceKm, commuteScore, reliabilityScore, memoryScore, finalScore },
        });
      }

      candidates.sort((a, b) => b.score - a.score);
      const top = candidates.slice(0, limit);

      // Re-rank: delete stale matches that have no offers yet, then insert fresh ones
      const matchesWithOffers = await db.match.findMany({
        where: { bookingRequestId, offers: { some: {} } },
        select: { id: true },
      });
      const protectedIds = matchesWithOffers.map((m) => m.id);
      await db.match.deleteMany({
        where: { bookingRequestId, id: { notIn: protectedIds } },
      });

      if (top.length > 0) {
        await db.match.createMany({
          data: top.map((c, i) => ({
            bookingRequestId,
            workerId: c.workerId,
            rank: i + 1,
            acceptanceProbability: c.score,
            reasoning: c.reasoning,
            scores: c.scores,
          })),
        });
      }

      const matches = await db.match.findMany({
        where: { bookingRequestId },
        orderBy: { rank: "asc" },
      });

      await db.auditEvent.create({
        data: {
          actorType: "agent",
          actorId: "market",
          action: "ranking.complete",
          entityType: "BookingRequest",
          entityId: bookingRequestId,
          inputs: { bookingRequestId, roleType: bookingRequest.roleType, limit },
          outputs: {
            matchCount: matches.length,
            workerPool: workers.length,
            topWorkerIds: top.slice(0, 5).map((c) => c.workerId),
            memoryEdges: memoryEdges.length,
            memoryIds: rankingMemory.audit.memoryIds,
            edgeIds: rankingMemory.audit.edgeIds,
          },
          outcome: matches.length > 0 ? "candidates_ranked" : "no_eligible_candidates",
        },
      });

      await memory.recordInfluence({
        purpose: rankingMemory.audit.purpose,
        audience: rankingMemory.audit.audience,
        entityType: "BookingRequest",
        entityId: bookingRequestId,
        action: "ranking.complete",
        memoryIds: rankingMemory.audit.memoryIds,
        edgeIds: rankingMemory.audit.edgeIds,
        useScopes: rankingMemory.audit.useScopes,
        outcome: matches.length > 0 ? "candidates_ranked" : "no_eligible_candidates",
        note: "Worker ranking used governed operational/shared memory signals only.",
      });

      return {
        success: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: matches as any,
        explanation: `${matches.length} eligible candidate(s) ranked.`,
        requiresHumanApproval: false,
        auditPayload: { bookingRequestId, matchCount: matches.length },
      };
    },

    async estimateFillProbability(bookingRequestId) {
      const bookingRequest = await db.bookingRequest.findUnique({
        where: { id: bookingRequestId },
        select: { organisationId: true, roleType: true },
      });

      if (!bookingRequest) return 0;

      const eligibleCount = await db.match.count({ where: { bookingRequestId } });

      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const [accepted, resolved] = await Promise.all([
        db.offer.count({
          where: {
            bookingRequest: {
              organisationId: bookingRequest.organisationId,
              roleType: bookingRequest.roleType,
            },
            status: "accepted",
            createdAt: { gte: ninetyDaysAgo },
          },
        }),
        db.offer.count({
          where: {
            bookingRequest: {
              organisationId: bookingRequest.organisationId,
              roleType: bookingRequest.roleType,
            },
            status: { in: ["accepted", "declined", "expired"] },
            createdAt: { gte: ninetyDaysAgo },
          },
        }),
      ]);

      const acceptanceRate = resolved >= 10 ? accepted / resolved : 0.65;
      const probability = Math.min(1, (eligibleCount / 5) * acceptanceRate);

      await db.bookingRequest.update({
        where: { id: bookingRequestId },
        data: { fillProbability: probability },
      });

      return probability;
    },

    async broadcastOffers(bookingRequestId, strategy, autonomyLevel) {
      const bookingRequest = await db.bookingRequest.findUnique({
        where: { id: bookingRequestId },
        include: {
          organisation: { include: { guardrailPolicy: true } },
        },
      });

      if (!bookingRequest) {
        return {
          success: false,
          data: [],
          explanation: "BookingRequest not found.",
          requiresHumanApproval: true,
          auditPayload: { bookingRequestId, error: "not_found" },
        };
      }

      const matches = await db.match.findMany({
        where: { bookingRequestId },
        orderBy: { rank: "asc" },
      });

      if (matches.length === 0) {
        return {
          success: false,
          data: [],
          explanation: "No ranked candidates — run rankCandidates first.",
          requiresHumanApproval: true,
          auditPayload: { bookingRequestId },
        };
      }

      const requiresHumanApproval =
        autonomyLevel === "L0" || autonomyLevel === "L1" || strategy === "manual_approval";

      const whitelist =
        bookingRequest.organisation.guardrailPolicy?.workerWhitelist ?? [];

      let selectedMatches = matches;
      if (strategy === "simultaneous_top_n") {
        selectedMatches = matches.slice(0, 5);
      } else if (strategy === "known_worker_only" && whitelist.length > 0) {
        selectedMatches = matches.filter((m) => whitelist.includes(m.workerId));
      }

      // Skip workers who already have a pending or accepted offer for this booking
      const existingOffers = await db.offer.findMany({
        where: { bookingRequestId, status: { in: ["pending", "accepted"] } },
        select: { workerId: true },
      });
      const alreadyOffered = new Set(existingOffers.map((o) => o.workerId));
      const newMatches = selectedMatches.filter((m) => !alreadyOffered.has(m.workerId));

      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const offers = await Promise.all(
        newMatches.map((match) =>
          db.offer.create({
            data: {
              bookingRequestId,
              workerId: match.workerId,
              matchId: match.id,
              payRate: bookingRequest.payRate,
              fitExplanation: match.reasoning,
              expiresAt,
              status: "pending",
            },
          }),
        ),
      );

      await db.bookingRequest.update({
        where: { id: bookingRequestId },
        data: { status: "broadcasting" },
      });

      await db.auditEvent.create({
        data: {
          actorType: "agent",
          actorId: "market",
          action: "offers.broadcast",
          entityType: "BookingRequest",
          entityId: bookingRequestId,
          inputs: { bookingRequestId, strategy, autonomyLevel },
          outputs: {
            offerCount: offers.length,
            offerIds: offers.map((o) => o.id),
            requiresHumanApproval,
          },
          outcome: requiresHumanApproval ? "queued_for_approval" : "offers_sent",
        },
      });

      return {
        success: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: offers as any,
        explanation: `${offers.length} offer(s) broadcast. ${requiresHumanApproval ? "Pending human approval." : "Sent automatically."}`,
        requiresHumanApproval,
        auditPayload: { bookingRequestId, offerCount: offers.length },
      };
    },
  };
}
