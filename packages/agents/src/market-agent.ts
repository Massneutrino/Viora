import { haversineKm } from "@viora/domain";
import type { Offer, Prisma, PrismaClient } from "@viora/database";
import { evaluateGuardrailAction } from "./guardrails.js";
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

      await db.auditEvent.create({
        data: {
          actorType: "agent",
          actorId: "market",
          action: "fill_probability.estimate",
          entityType: "BookingRequest",
          entityId: bookingRequestId,
          inputs: {
            bookingRequestId,
            eligibleCount,
            acceptanceRate,
            resolvedOfferCount: resolved,
          },
          outputs: { fillProbability: probability },
          outcome: "estimated",
        },
      });

      return probability;
    },

    async broadcastOffers(bookingRequestId, strategy, autonomyLevel, options) {
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

      const policy = bookingRequest.organisation.guardrailPolicy;
      const broadcastGuardrail = await evaluateGuardrailAction(db, {
        organisationId: bookingRequest.organisationId,
        action: "broadcast",
        roleType: bookingRequest.roleType,
        payRate: bookingRequest.payRate,
        strategy,
        approvedBy: options?.approvedBy,
      });

      if (!broadcastGuardrail.allowed || broadcastGuardrail.requiresHumanApproval) {
        return {
          success: false,
          data: [],
          explanation: broadcastGuardrail.reason,
          requiresHumanApproval: true,
          auditPayload: {
            queueAction: "offers.broadcast",
            organisationId: bookingRequest.organisationId,
            bookingRequestId,
            strategy,
            autonomyLevel,
            guardrail: {
              allowed: broadcastGuardrail.allowed,
              requiresHumanApproval: broadcastGuardrail.requiresHumanApproval,
              reason: broadcastGuardrail.reason,
            },
          },
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
      const dynamicDecisions: Record<
        string,
        { payRate: number; workerFloor: number; cap: number; explanation: string }
      > = {};

      if (bookingRequest.rateMode === "dynamic") {
        const dynamicGuardrail = await evaluateGuardrailAction(db, {
          organisationId: bookingRequest.organisationId,
          action: "dynamic_rate_clear",
          roleType: bookingRequest.roleType,
          payRate: bookingRequest.payRate,
          approvedBy: options?.approvedBy,
        });
        if (!dynamicGuardrail.allowed || dynamicGuardrail.requiresHumanApproval) {
          return {
            success: false,
            data: [],
            explanation: dynamicGuardrail.reason,
            requiresHumanApproval: true,
            auditPayload: {
              queueAction: "offers.broadcast",
              organisationId: bookingRequest.organisationId,
              bookingRequestId,
              strategy,
              autonomyLevel,
              rateMode: "dynamic",
              guardrail: {
                allowed: dynamicGuardrail.allowed,
                requiresHumanApproval: dynamicGuardrail.requiresHumanApproval,
                reason: dynamicGuardrail.reason,
              },
            },
          };
        }

        if (bookingRequest.maxPayRate == null) {
          await db.auditEvent.create({
            data: {
              actorType: "agent",
              actorId: "market",
              action: "offers.broadcast",
              entityType: "BookingRequest",
              entityId: bookingRequestId,
              inputs: { bookingRequestId, strategy, autonomyLevel },
              outputs: { rateMode: "dynamic", maxPayRate: null },
              outcome: "blocked_dynamic_rate_missing_ceiling",
            },
          });
          return {
            success: false,
            data: [],
            explanation: "Dynamic Rate requires a maximum rate ceiling.",
            requiresHumanApproval: true,
            auditPayload: { bookingRequestId, rateMode: "dynamic", error: "missing_max_pay_rate" },
          };
        }

        const employerCap = Math.min(
          bookingRequest.maxPayRate,
          policy?.budgetCeiling ?? bookingRequest.maxPayRate,
        );
        if (employerCap < bookingRequest.payRate) {
          await db.auditEvent.create({
            data: {
              actorType: "agent",
              actorId: "market",
              action: "offers.broadcast",
              entityType: "BookingRequest",
              entityId: bookingRequestId,
              inputs: { bookingRequestId, strategy, autonomyLevel },
              outputs: {
                rateMode: "dynamic",
                payRate: bookingRequest.payRate,
                maxPayRate: bookingRequest.maxPayRate,
                budgetCeiling: policy?.budgetCeiling ?? null,
                employerCap,
              },
              outcome: "blocked_dynamic_rate_invalid_range",
            },
          });
          return {
            success: false,
            data: [],
            explanation: "Dynamic Rate ceiling is below the starting rate.",
            requiresHumanApproval: true,
            auditPayload: { bookingRequestId, rateMode: "dynamic", error: "invalid_rate_range" },
          };
        }

        const workerPolicies = await db.guardrailPolicy.findMany({
          where: { workerId: { in: newMatches.map((match) => match.workerId) } },
          select: { workerId: true, payFloor: true },
        });
        const workerPayFloors = new Map(
          workerPolicies
            .filter((workerPolicy) => workerPolicy.workerId != null)
            .map((workerPolicy) => [workerPolicy.workerId as string, workerPolicy.payFloor]),
        );

        for (const match of newMatches) {
          const workerFloor = workerPayFloors.get(match.workerId);
          if (workerFloor == null) continue;
          if (workerFloor > employerCap) continue;

          const payRate = Number(Math.max(bookingRequest.payRate, workerFloor).toFixed(2));
          dynamicDecisions[match.workerId] = {
            payRate,
            workerFloor,
            cap: employerCap,
            explanation:
              `Dynamic Rate cleared at GBP ${payRate}: starting rate GBP ${bookingRequest.payRate}, ` +
              `worker floor GBP ${workerFloor}, ceiling GBP ${employerCap}.`,
          };
        }

        if (newMatches.length > 0 && Object.keys(dynamicDecisions).length === 0) {
          await db.auditEvent.create({
            data: {
              actorType: "agent",
              actorId: "market",
              action: "offers.broadcast",
              entityType: "BookingRequest",
              entityId: bookingRequestId,
              inputs: { bookingRequestId, strategy, autonomyLevel },
              outputs: {
                rateMode: "dynamic",
                selectedWorkerIds: newMatches.map((match) => match.workerId),
                maxPayRate: bookingRequest.maxPayRate,
                budgetCeiling: policy?.budgetCeiling ?? null,
              },
              outcome: "blocked_dynamic_rate_no_clearable_workers",
            },
          });
          return {
            success: false,
            data: [],
            explanation: "Dynamic Rate could not clear because selected workers have no pay floor or exceed the ceiling.",
            requiresHumanApproval: true,
            auditPayload: { bookingRequestId, rateMode: "dynamic", error: "no_clearable_workers" },
          };
        }
      }

      const offers = await db.$transaction(async (tx) => {
        const createdOffers: Offer[] = [];
        for (const match of newMatches) {
          const dynamicDecision = dynamicDecisions[match.workerId];
          if (bookingRequest.rateMode === "dynamic" && !dynamicDecision) continue;
          const offerPayRate = dynamicDecision?.payRate ?? bookingRequest.payRate;
          const fitExplanation = dynamicDecision
            ? `${match.reasoning}. ${dynamicDecision.explanation}`
            : match.reasoning;

          const offer = await tx.offer.create({
            data: {
              bookingRequestId,
              workerId: match.workerId,
              matchId: match.id,
              payRate: offerPayRate,
              fitExplanation,
              expiresAt,
              status: "pending",
            },
          });
          createdOffers.push(offer);

          if (dynamicDecision) {
            await tx.negotiationRecord.create({
              data: {
                bookingRequestId,
                workerId: match.workerId,
                employerCeiling: dynamicDecision.cap,
                workerFloor: dynamicDecision.workerFloor,
                agreedRate: dynamicDecision.payRate,
                explanation: dynamicDecision.explanation,
              },
            });

            await tx.auditEvent.create({
              data: {
                actorType: "agent",
                actorId: "market",
                action: "dynamic_rate.clear",
                entityType: "Offer",
                entityId: offer.id,
                inputs: {
                  bookingRequestId,
                  workerId: match.workerId,
                  startingRate: bookingRequest.payRate,
                  maxPayRate: bookingRequest.maxPayRate,
                  budgetCeiling: policy?.budgetCeiling ?? null,
                  workerFloor: dynamicDecision.workerFloor,
                } as Prisma.InputJsonValue,
                outputs: {
                  offerId: offer.id,
                  agreedRate: dynamicDecision.payRate,
                  employerCeiling: dynamicDecision.cap,
                  explanation: dynamicDecision.explanation,
                } as Prisma.InputJsonValue,
                outcome: "cleared",
              },
            });
          }
        }
        return createdOffers;
      });

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
            rateMode: bookingRequest.rateMode,
          },
          outcome: "offers_sent",
        },
      });

      return {
        success: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: offers as any,
        explanation: `${offers.length} offer(s) broadcast. Sent automatically.`,
        requiresHumanApproval: false,
        auditPayload: { bookingRequestId, offerCount: offers.length },
      };
    },
  };
}
