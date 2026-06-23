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

  /** POST /v1/bookings/:id/broadcast — rank candidates then send offers */
  app.post("/:id/broadcast", async (request, reply) => {
    const { id } = request.params as { id: string };

    const bookingRequest = await app.db.bookingRequest.findUnique({
      where: { id },
      include: { organisation: { include: { guardrailPolicy: true } } },
    });

    if (!bookingRequest) {
      return reply.code(404).send({ error: "BookingRequest not found." });
    }

    const policy = bookingRequest.organisation.guardrailPolicy;
    if (!policy) {
      return reply.code(409).send({ error: "GuardrailPolicy missing for organisation." });
    }

    const matches = await app.agents.market.rankCandidates(id);
    const offers = await app.agents.market.broadcastOffers(
      id,
      bookingRequest.broadcastStrategy,
      policy.autonomyLevel,
    );

    return reply.send({ matches, offers });
  });
};
