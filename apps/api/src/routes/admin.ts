import type { FastifyPluginAsync } from "fastify";

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.get("/ops/unfilled", async () => {
    const unfilled = await app.agents.ops.getUnfilledShifts();
    return { unfilled };
  });

  app.get("/ops/market-health", async () => {
    return app.agents.ops.getMarketHealthSummary();
  });

  app.get("/audit", async () => {
    const events = await app.db.auditEvent.findMany({
      take: 100,
      orderBy: { createdAt: "desc" },
    });
    return { events };
  });

  app.get("/compliance/queue", async () => {
    const pending = await app.db.complianceDocument.findMany({
      where: { status: "pending" },
      include: { passport: { include: { worker: true } } },
      take: 50,
    });
    return { pending };
  });
};
