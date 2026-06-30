import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { Prisma } from "@viora/database";
import { createVoiceClient, getActiveVoiceConfig, VoiceProviderError } from "@viora/agents";
import { writeAuditEvent } from "../audit.js";

const speechSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  purpose: z.enum(["greeting", "reply", "confirmation", "admin"]).optional().default("reply"),
});

const MAX_TRANSCRIBE_BYTES = 10 * 1024 * 1024;

async function auditVoiceAction(
  app: FastifyInstance,
  event: {
    action: string;
    entityId: string;
    inputs: Prisma.InputJsonValue;
    outputs: Prisma.InputJsonValue;
    outcome: string;
  },
) {
  try {
    await writeAuditEvent(app.db, {
      actorType: "agent",
      actorId: "v",
      action: event.action,
      entityType: "Voice",
      entityId: event.entityId,
      inputs: event.inputs,
      outputs: event.outputs,
      outcome: event.outcome,
    });
  } catch (err) {
    app.log.warn({ err }, "failed to write voice audit event");
  }
}

function voiceErrorResponse(err: unknown): { statusCode: number; message: string } {
  if (err instanceof VoiceProviderError) {
    return { statusCode: err.statusCode, message: err.message };
  }
  return { statusCode: 503, message: "Voice provider unavailable." };
}

export const voiceRoutes: FastifyPluginAsync = async (app) => {
  app.addContentTypeParser(/^audio\/.*/i, { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });

  app.get("/status", async () => getActiveVoiceConfig());

  app.post("/speech", async (request, reply) => {
    const body = speechSchema.parse(request.body);
    const voice = createVoiceClient();

    try {
      const result = await voice.speak({ text: body.text, purpose: body.purpose });
      await auditVoiceAction(app, {
        action: "voice.speech.generate",
        entityId: result.cacheKey,
        inputs: {
          purpose: body.purpose,
          textLength: body.text.length,
        },
        outputs: {
          provider: result.provider,
          model: result.model,
          voiceId: result.voiceId,
          cacheKey: result.cacheKey,
          cached: result.cached,
          contentType: result.contentType,
          audioBytes: result.audio.byteLength,
        },
        outcome: result.cached ? "cached" : "generated",
      });

      reply.header("Content-Type", result.contentType);
      reply.header("Cache-Control", "private, max-age=86400");
      reply.header("X-Viora-Voice-Provider", result.provider);
      reply.header("X-Viora-Voice-Cache", result.cached ? "hit" : "miss");
      return reply.send(Buffer.from(result.audio));
    } catch (err) {
      const response = voiceErrorResponse(err);
      await auditVoiceAction(app, {
        action: "voice.speech.generate",
        entityId: `failed:${Date.now()}`,
        inputs: {
          purpose: body.purpose,
          textLength: body.text.length,
        },
        outputs: { error: response.message },
        outcome: "failed",
      });
      request.log.warn({ err }, "voice speech generation failed");
      return reply.code(response.statusCode).send({ error: response.message });
    }
  });

  app.post("/transcribe", async (request, reply) => {
    const contentType = request.headers["content-type"]?.split(";")[0]?.trim() ?? "application/octet-stream";
    const language = typeof request.headers["x-viora-language"] === "string" ? request.headers["x-viora-language"] : "en";
    const filename =
      typeof request.headers["x-viora-filename"] === "string" ? request.headers["x-viora-filename"] : undefined;
    const audio = Buffer.isBuffer(request.body) ? request.body : undefined;

    if (!audio || audio.byteLength === 0 || audio.byteLength > MAX_TRANSCRIBE_BYTES) {
      await auditVoiceAction(app, {
        action: "voice.transcribe",
        entityId: `rejected:${Date.now()}`,
        inputs: { contentType, audioBytes: audio?.byteLength ?? 0 },
        outputs: { error: "Missing or oversized audio payload." },
        outcome: "rejected",
      });
      return reply.code(400).send({ error: "Send a non-empty audio payload up to 10MB." });
    }

    const voice = createVoiceClient();
    try {
      const result = await voice.transcribe({
        audio,
        mimeType: contentType,
        filename,
        language,
      });
      await auditVoiceAction(app, {
        action: "voice.transcribe",
        entityId: `transcribe:${Date.now()}`,
        inputs: { contentType, audioBytes: audio.byteLength, language },
        outputs: {
          provider: result.provider,
          model: result.model,
          textLength: result.text.length,
        },
        outcome: "transcribed",
      });
      return reply.send(result);
    } catch (err) {
      const response = voiceErrorResponse(err);
      await auditVoiceAction(app, {
        action: "voice.transcribe",
        entityId: `failed:${Date.now()}`,
        inputs: { contentType, audioBytes: audio.byteLength, language },
        outputs: { error: response.message },
        outcome: "failed",
      });
      request.log.warn({ err }, "voice transcription failed");
      return reply.code(response.statusCode).send({ error: response.message });
    }
  });
};
