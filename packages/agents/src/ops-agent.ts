import type { PrismaClient } from "@viora/database";
import type { OpsAgent } from "./types.js";

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
  };
}
