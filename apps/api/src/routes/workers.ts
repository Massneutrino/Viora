import type { FastifyPluginAsync } from "fastify";

export const workerRoutes: FastifyPluginAsync = async (app) => {
  /** GET /v1/workers/:id/offer — next ranked opportunity (swipe deck) */
  app.get("/:id/offer", async (request) => {
    const { id } = request.params as { id: string };
    return app.agents.worker.surfaceNextOffer(id);
  });

  app.post("/:id/offers/:offerId/accept", async (request, reply) => {
    const { offerId } = request.params as { id: string; offerId: string };
    const offer = await app.db.offer.update({
      where: { id: offerId },
      data: { status: "accepted" },
    });
    return reply.send({ offer, message: "Shift accepted." });
  });

  app.post("/:id/offers/:offerId/decline", async (request, reply) => {
    const { offerId } = request.params as { id: string; offerId: string };
    const offer = await app.db.offer.update({
      where: { id: offerId },
      data: { status: "declined" },
    });
    return reply.send({ offer, message: "Shift declined." });
  });

  app.post("/:id/shifts/:shiftId/check-in", async (request, reply) => {
    const { shiftId } = request.params as { id: string; shiftId: string };
    const body = request.body as { latitude?: number; longitude?: number };
    const shift = await app.db.shift.update({
      where: { id: shiftId },
      data: {
        status: "checked_in",
        checkedInAt: new Date(),
        checkInLatitude: body.latitude,
        checkInLongitude: body.longitude,
      },
    });
    return reply.send({ shift });
  });
};
