import type { FastifyPluginAsync } from "fastify";
import type { Prisma } from "@viora/database";
import { evaluateGuardrailAction } from "@viora/agents";
import { queuePendingApproval } from "../approvals.js";

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

    const guardrail = await evaluateGuardrailAction(app.db, {
      organisationId: bookingRequest.organisationId,
      action: "broadcast",
      roleType: bookingRequest.roleType,
      payRate: bookingRequest.payRate,
      strategy: bookingRequest.broadcastStrategy,
    });

    if (!guardrail.allowed || guardrail.requiresHumanApproval) {
      const approval = await queuePendingApproval(app.db, {
        organisationId: bookingRequest.organisationId,
        actorType: "agent",
        actorId: "market",
        action: "offers.broadcast",
        entityType: "BookingRequest",
        entityId: bookingRequest.id,
        inputs: {
          bookingRequestId: bookingRequest.id,
          strategy: bookingRequest.broadcastStrategy,
          guardrail: {
            allowed: guardrail.allowed,
            requiresHumanApproval: guardrail.requiresHumanApproval,
            reason: guardrail.reason,
          },
        } as Prisma.InputJsonValue,
        explanation: guardrail.reason,
      });
      return reply.code(202).send({
        requiresHumanApproval: true,
        approval,
        explanation: guardrail.reason,
      });
    }

    if (bookingRequest.rateMode === "dynamic") {
      if (bookingRequest.maxPayRate == null) {
        return reply.code(409).send({
          error: "Dynamic Rate requires a maximum rate ceiling.",
          requiresHumanApproval: false,
        });
      }

      const dynamicGuardrail = await evaluateGuardrailAction(app.db, {
        organisationId: bookingRequest.organisationId,
        action: "dynamic_rate_clear",
        roleType: bookingRequest.roleType,
        payRate: bookingRequest.payRate,
      });

      if (!dynamicGuardrail.allowed || dynamicGuardrail.requiresHumanApproval) {
        const approval = await queuePendingApproval(app.db, {
          organisationId: bookingRequest.organisationId,
          actorType: "agent",
          actorId: "market",
          action: "offers.broadcast",
          entityType: "BookingRequest",
          entityId: bookingRequest.id,
          inputs: {
            bookingRequestId: bookingRequest.id,
            strategy: bookingRequest.broadcastStrategy,
            rateMode: bookingRequest.rateMode,
            guardrail: {
              allowed: dynamicGuardrail.allowed,
              requiresHumanApproval: dynamicGuardrail.requiresHumanApproval,
              reason: dynamicGuardrail.reason,
            },
          } as Prisma.InputJsonValue,
          explanation: dynamicGuardrail.reason,
        });
        return reply.code(202).send({
          requiresHumanApproval: true,
          approval,
          explanation: dynamicGuardrail.reason,
        });
      }
    }

    const matches = await app.agents.market.rankCandidates(id);
    const offers = await app.agents.market.broadcastOffers(
      id,
      bookingRequest.broadcastStrategy,
      guardrail.policy?.autonomyLevel ?? "L4",
    );

    if (!offers.success) {
      if (
        offers.requiresHumanApproval &&
        offers.auditPayload.queueAction === "offers.broadcast"
      ) {
        const approval = await queuePendingApproval(app.db, {
          organisationId: bookingRequest.organisationId,
          actorType: "agent",
          actorId: "market",
          action: "offers.broadcast",
          entityType: "BookingRequest",
          entityId: bookingRequest.id,
          inputs: {
            bookingRequestId: bookingRequest.id,
            strategy: bookingRequest.broadcastStrategy,
            guardrail: offers.auditPayload.guardrail ?? null,
          } as Prisma.InputJsonValue,
          explanation: offers.explanation,
        });
        return reply.code(202).send({
          requiresHumanApproval: true,
          approval,
          explanation: offers.explanation,
        });
      }
      return reply.code(409).send({
        error: offers.explanation,
        requiresHumanApproval: offers.requiresHumanApproval,
      });
    }

    return reply.send({ matches, offers });
  });
};
