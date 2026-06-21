import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { Prisma } from "@viora/database";

const parseIntentSchema = z.object({
  organisationId: z.string(),
  rawInput: z.string().min(1),
  channel: z.enum(["app", "whatsapp", "voice", "phone", "web"]).default("web"),
});

export const intakeRoutes: FastifyPluginAsync = async (app) => {
  /** POST /v1/intake/parse — V-powered natural language intake (Phase 0) */
  app.post("/parse", async (request, reply) => {
    const body = parseIntentSchema.parse(request.body);
    const intent = await app.agents.v.parseIntent(body.rawInput, {
      organisationId: body.organisationId,
    });

    const clarificationNeeded = intent.missingFields.length > 0;
    const message = clarificationNeeded
      ? await app.agents.v.clarify(intent.missingFields, { organisationId: body.organisationId })
      : await app.agents.v.confirmIntent(intent);

    // Persist once all required DB fields are present — guard against V missing a field.
    let bookingRequestId: string | undefined;
    if (!clarificationNeeded && intent.siteId && intent.payRate !== undefined) {
      const booking = await app.db.bookingRequest.create({
        data: {
          organisationId: body.organisationId,
          siteId: intent.siteId,
          roleType: intent.roleType,
          startAt: intent.startAt,
          endAt: intent.endAt,
          payRate: intent.payRate,
          maxPayRate: intent.maxPayRate,
          requirements: intent.requirements as Prisma.InputJsonValue | undefined,
          rawIntent: body.rawInput,
          channel: body.channel,
          status: "pending_confirmation",
          broadcastStrategy: "sequential",
        },
      });
      bookingRequestId = booking.id;
    }

    return reply.send({ intent, clarificationNeeded, message, bookingRequestId });
  });
};
