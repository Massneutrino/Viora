import type { PrismaClient } from "@viora/database";
import type { OpsAgent, OpsCount } from "./types.js";

/** Map a Prisma `groupBy` result into a simple labelled-count array. */
function toCounts<T extends Record<string, unknown>>(rows: T[], key: keyof T): OpsCount[] {
  return rows
    .map((row) => ({ key: String(row[key]), count: Number(row._count ?? 0) }))
    .sort((a, b) => b.count - a.count);
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
  };
}
