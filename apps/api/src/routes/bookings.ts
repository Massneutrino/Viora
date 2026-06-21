import type { FastifyPluginAsync } from "fastify";

export const bookingRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async () => {
    const requests = await app.db.bookingRequest.findMany({
      take: 50,
      orderBy: { createdAt: "desc" },
      include: { site: true, organisation: true },
    });
    return { bookingRequests: requests };
  });

  app.get("/:id/matches", async (request) => {
    const { id } = request.params as { id: string };
    const result = await app.agents.market.rankCandidates(id);
    return result;
  });

  app.get("/:id/fill-probability", async (request) => {
    const { id } = request.params as { id: string };
    const probability = await app.agents.market.estimateFillProbability(id);
    return { bookingRequestId: id, fillProbability: probability };
  });
};
