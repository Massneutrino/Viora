import type { PrismaClient } from "@viora/database";
import type { MemoryImpactStats, OpsAgent, OpsCount } from "./types.js";

/** Map a Prisma `groupBy` result into a simple labelled-count array. */
function toCounts<T extends Record<string, unknown>>(rows: T[], key: keyof T): OpsCount[] {
  return rows
    .map((row) => ({ key: String(row[key]), count: Number(row._count ?? 0) }))
    .sort((a, b) => b.count - a.count);
}

function increment(map: Map<string, number>, key: unknown) {
  const label = typeof key === "string" && key.trim() ? key : "unknown";
  map.set(label, (map.get(label) ?? 0) + 1);
}

function mapToCounts(map: Map<string, number>): OpsCount[] {
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export function createOpsAgent(db: PrismaClient): OpsAgent {
  return {
    async getUnfilledShifts() {
      const now = new Date();
      const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const bookingRequests = await db.bookingRequest.findMany({
        where: {
          status: { in: ["confirmed", "broadcasting"] },
          startAt: { lt: in24h },
        },
        select: { id: true, startAt: true },
        orderBy: { startAt: "asc" },
      });

      return bookingRequests.map(({ id, startAt }) => {
        const hoursUntil = (startAt.getTime() - now.getTime()) / (60 * 60 * 1000);
        const urgency = hoursUntil <= 4 ? "critical" : hoursUntil <= 12 ? "warning" : "low";
        return { bookingRequestId: id, urgency };
      });
    },

    async getMarketHealthSummary() {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const [totalRecent, filledRecent, unfilledPast, acceptedOffers, resolvedOffers] =
        await Promise.all([
          db.bookingRequest.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
          db.bookingRequest.count({
            where: { status: "filled", createdAt: { gte: sevenDaysAgo } },
          }),
          db.bookingRequest.count({
            where: { status: { in: ["confirmed", "broadcasting"] }, startAt: { lt: new Date() } },
          }),
          db.offer.count({ where: { status: "accepted", createdAt: { gte: sevenDaysAgo } } }),
          db.offer.count({
            where: {
              status: { in: ["accepted", "declined", "expired"] },
              createdAt: { gte: sevenDaysAgo },
            },
          }),
        ]);

      return {
        unfilledCount: unfilledPast,
        fillRate: totalRecent > 0 ? filledRecent / totalRecent : null,
        offerAcceptanceRate: resolvedOffers > 0 ? acceptedOffers / resolvedOffers : null,
        periodDays: 7,
      };
    },

    async getOpsStats() {
      const now = new Date();
      const in30d = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const [
        totalWorkers,
        reliability,
        docsExpiringSoon,
        complianceDocs,
        bookingRequests,
        bookings,
        offers,
        shifts,
        auditOutcomes7d,
        invoices,
        invoiceTotals,
        unapprovedTimesheets,
      ] = await Promise.all([
        db.worker.count(),
        db.passport.aggregate({ _avg: { reliabilityScore: true } }),
        db.complianceDocument.count({ where: { status: "verified", expiresAt: { lte: in30d } } }),
        db.complianceDocument.groupBy({ by: ["status"], _count: true }),
        db.bookingRequest.groupBy({ by: ["status"], _count: true }),
        db.booking.groupBy({ by: ["status"], _count: true }),
        db.offer.groupBy({ by: ["status"], _count: true }),
        db.shift.groupBy({ by: ["status"], _count: true }),
        db.auditEvent.groupBy({
          by: ["outcome"],
          _count: true,
          where: { createdAt: { gte: sevenDaysAgo } },
        }),
        db.invoice.groupBy({ by: ["status"], _count: true }),
        db.invoice.aggregate({ _sum: { vioraFeeTotal: true, workerPayTotal: true } }),
        db.timesheet.count({ where: { approved: false } }),
      ]);

      return {
        workforce: {
          totalWorkers,
          avgReliability: reliability._avg.reliabilityScore,
          docsExpiringSoon,
          complianceDocs: toCounts(complianceDocs, "status"),
        },
        funnel: {
          bookingRequests: toCounts(bookingRequests, "status"),
          bookings: toCounts(bookings, "status"),
          offers: toCounts(offers, "status"),
        },
        operations: {
          shifts: toCounts(shifts, "status"),
          auditOutcomes7d: toCounts(auditOutcomes7d, "outcome"),
        },
        financial: {
          invoices: toCounts(invoices, "status"),
          revenue: invoiceTotals._sum.vioraFeeTotal ?? 0,
          workerPayTotal: invoiceTotals._sum.workerPayTotal ?? 0,
          unapprovedTimesheets,
        },
      };
    },

    async getMemoryImpactStats(): Promise<MemoryImpactStats> {
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const influenceEvents = await db.auditEvent.findMany({
        where: {
          action: "memory.influence",
          createdAt: { gte: thirtyDaysAgo },
        },
        orderBy: { createdAt: "desc" },
        take: 2000,
      });

      const purposeCounts = new Map<string, number>();
      const audienceCounts = new Map<string, number>();
      const actionCounts = new Map<string, number>();
      const outcomeCounts = new Map<string, number>();
      const memoryUseCounts = new Map<string, number>();
      const edgeUseCounts = new Map<string, number>();
      const influencedRankingBookingIds = new Set<string>();
      let intakeClarificationRequired = 0;
      let intakePendingConfirmation = 0;

      for (const event of influenceEvents) {
        const inputs = jsonObject(event.inputs);
        increment(purposeCounts, inputs.purpose);
        increment(audienceCounts, inputs.audience);
        increment(actionCounts, inputs.action);
        increment(outcomeCounts, event.outcome);

        for (const memoryId of stringArray(inputs.memoryIds)) increment(memoryUseCounts, memoryId);
        for (const edgeId of stringArray(inputs.edgeIds)) increment(edgeUseCounts, edgeId);

        if (event.entityType === "BookingRequest" && inputs.action === "ranking.complete") {
          influencedRankingBookingIds.add(event.entityId);
        }
        if (inputs.action === "intake.clarify" && event.outcome === "clarification_required") {
          intakeClarificationRequired += 1;
        }
        if (inputs.action === "intake.confirm" && event.outcome === "pending_confirmation") {
          intakePendingConfirmation += 1;
        }
      }

      const usedMemoryIds = [...memoryUseCounts.keys()];
      const usedEdgeIds = [...edgeUseCounts.keys()];
      const influencedBookingRequestIds = [...influencedRankingBookingIds];

      const [
        memoryRows,
        edgeRows,
        activeMemories,
        workerPrivateMemories,
        offers,
        bookingsCreated,
      ] = await Promise.all([
        usedMemoryIds.length > 0
          ? db.memoryEntry.findMany({
              where: { id: { in: usedMemoryIds } },
              select: { id: true, title: true, kind: true, ownerType: true, ownerId: true, visibility: true },
            })
          : Promise.resolve([]),
        usedEdgeIds.length > 0
          ? db.memoryEdge.findMany({
              where: { id: { in: usedEdgeIds } },
              select: { id: true, label: true, kind: true, ownerType: true, ownerId: true },
            })
          : Promise.resolve([]),
        db.memoryEntry.findMany({
          where: { status: "active" },
          select: { id: true, kind: true },
        }),
        db.memoryEntry.count({ where: { ownerType: "worker", visibility: "private", status: { not: "deleted" } } }),
        influencedBookingRequestIds.length > 0
          ? db.offer.findMany({
              where: {
                bookingRequestId: { in: influencedBookingRequestIds },
                createdAt: { gte: thirtyDaysAgo },
              },
              select: { status: true },
            })
          : Promise.resolve([]),
        influencedBookingRequestIds.length > 0
          ? db.booking.count({
              where: {
                bookingRequestId: { in: influencedBookingRequestIds },
                createdAt: { gte: thirtyDaysAgo },
              },
            })
          : Promise.resolve(0),
      ]);

      const memoryById = new Map(memoryRows.map((memory) => [memory.id, memory]));
      const edgeById = new Map(edgeRows.map((edge) => [edge.id, edge]));
      const employerFacingPrivateIds = new Set<string>();

      for (const event of influenceEvents) {
        const inputs = jsonObject(event.inputs);
        const audience = typeof inputs.audience === "string" ? inputs.audience : "";
        if (audience !== "employer" && audience !== "admin") continue;
        for (const memoryId of stringArray(inputs.memoryIds)) {
          const memory = memoryById.get(memoryId);
          if (memory?.ownerType === "worker" && memory.visibility === "private") {
            employerFacingPrivateIds.add(memoryId);
          }
        }
      }

      const unusedByKind = new Map<string, number>();
      let unusedActiveMemories = 0;
      for (const memory of activeMemories) {
        if (memoryUseCounts.has(memory.id)) continue;
        unusedActiveMemories += 1;
        increment(unusedByKind, memory.kind);
      }

      const resolvedOffers = offers.filter((offer) => ["accepted", "declined", "expired"].includes(offer.status));
      const acceptedOffers = offers.filter((offer) => offer.status === "accepted");
      const intakeTurns = intakeClarificationRequired + intakePendingConfirmation;

      return {
        periodDays: { recent: 7, baseline: 30 },
        influence: {
          total7d: influenceEvents.filter((event) => event.createdAt >= sevenDaysAgo).length,
          total30d: influenceEvents.length,
          byPurpose30d: mapToCounts(purposeCounts),
          byAudience30d: mapToCounts(audienceCounts),
          byAction30d: mapToCounts(actionCounts),
          byOutcome30d: mapToCounts(outcomeCounts),
        },
        intake: {
          influencedTurns30d: intakeTurns,
          clarificationRequired30d: intakeClarificationRequired,
          pendingConfirmation30d: intakePendingConfirmation,
          clarificationRate30d: rate(intakeClarificationRequired, intakeTurns),
        },
        ranking: {
          influencedBookingRequests30d: influencedBookingRequestIds.length,
          offers30d: offers.length,
          resolvedOffers30d: resolvedOffers.length,
          acceptedOffers30d: acceptedOffers.length,
          offerAcceptanceRate30d: rate(acceptedOffers.length, resolvedOffers.length),
          bookingsCreated30d: bookingsCreated,
        },
        memoryUsage: {
          topMemories30d: [...memoryUseCounts.entries()]
            .map(([id, count]) => {
              const memory = memoryById.get(id);
              return {
                id,
                title: memory?.title ?? id,
                kind: memory?.kind ?? "unknown",
                ownerType: memory?.ownerType ?? "unknown",
                ownerId: memory?.ownerId ?? "unknown",
                count,
              };
            })
            .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))
            .slice(0, 8),
          topEdges30d: [...edgeUseCounts.entries()]
            .map(([id, count]) => {
              const edge = edgeById.get(id);
              return {
                id,
                label: edge?.label ?? id,
                kind: edge?.kind ?? "unknown",
                ownerType: edge?.ownerType ?? "unknown",
                ownerId: edge?.ownerId ?? "unknown",
                count,
              };
            })
            .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
            .slice(0, 8),
          unusedActiveMemories,
          unusedActiveMemoriesByKind: mapToCounts(unusedByKind),
        },
        privacy: {
          workerPrivateMemories,
          employerFacingPrivateInfluenceCount30d: employerFacingPrivateIds.size,
          leakedMemoryIds30d: [...employerFacingPrivateIds],
        },
      };
    },
  };
}
