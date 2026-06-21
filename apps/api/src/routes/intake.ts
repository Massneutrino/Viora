import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

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

    return reply.send({
      intent,
      clarificationNeeded: intent.missingFields.length > 0,
      message:
        intent.missingFields.length > 0
          ? await app.agents.v.clarify(intent.missingFields, { organisationId: body.organisationId })
          : await app.agents.v.confirmIntent(intent),
    });
  });
};
