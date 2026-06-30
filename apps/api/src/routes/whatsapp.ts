import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Prisma } from "@viora/database";
import { writeAuditEvent } from "../audit.js";
import { IntakeHttpError, processIntakeTurn } from "./intake.js";

const verifyQuerySchema = z.object({
  "hub.mode": z.string(),
  "hub.verify_token": z.string(),
  "hub.challenge": z.string(),
});

const textMessageSchema = z.object({
  id: z.string(),
  from: z.string(),
  timestamp: z.string().optional(),
  type: z.string(),
  text: z.object({ body: z.string().min(1) }).optional(),
});

const statusSchema = z.object({
  id: z.string(),
  status: z.string(),
  timestamp: z.string().optional(),
  recipient_id: z.string().optional(),
  errors: z.array(z.record(z.unknown())).optional(),
});

const whatsappPayloadSchema = z.object({
  object: z.string(),
  entry: z.array(
    z.object({
      id: z.string(),
      changes: z.array(
        z.object({
          field: z.string(),
          value: z.object({
            messaging_product: z.string().optional(),
            metadata: z
              .object({
                display_phone_number: z.string().optional(),
                phone_number_id: z.string().optional(),
              })
              .optional(),
            contacts: z.array(z.record(z.unknown())).optional(),
            messages: z.array(textMessageSchema).optional(),
            statuses: z.array(statusSchema).optional(),
          }),
        }),
      ),
    }),
  ),
});

type WhatsAppSendOutcome = "sent" | "stubbed" | "failed";

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function serializableError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { message: String(err) };
}

function verifySignature(rawBody: Buffer, signature: string | undefined): boolean {
  const appSecret = env("WHATSAPP_APP_SECRET");
  if (!appSecret || !signature?.startsWith("sha256=")) return false;

  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
}

function parseRawBody(request: FastifyRequest): Buffer {
  if (Buffer.isBuffer(request.body)) return request.body;
  if (typeof request.body === "string") return Buffer.from(request.body);
  return Buffer.from(JSON.stringify(request.body ?? {}));
}

async function auditWebhook(
  app: Parameters<FastifyPluginAsync>[0],
  action: string,
  entityId: string,
  inputs: Record<string, unknown>,
  outputs: Record<string, unknown>,
  outcome: string,
) {
  await writeAuditEvent(app.db, {
    actorType: "system",
    actorId: "whatsapp",
    action,
    entityType: "WhatsAppMessage",
    entityId,
    inputs: inputs as Prisma.InputJsonValue,
    outputs: outputs as Prisma.InputJsonValue,
    outcome,
  });
}

async function findConversationId(app: Parameters<FastifyPluginAsync>[0], organisationId: string, from: string) {
  const conversations = await app.db.conversation.findMany({
    where: {
      participantId: organisationId,
      participantType: "employer",
      channel: "whatsapp",
    },
    orderBy: { updatedAt: "desc" },
    take: 25,
    include: { messages: { orderBy: { createdAt: "desc" }, take: 10 } },
  });

  return (
    conversations.find((conversation) =>
      conversation.messages.some((message) => {
        const metadata = message.metadata;
        return (
          metadata &&
          typeof metadata === "object" &&
          !Array.isArray(metadata) &&
          "whatsappFrom" in metadata &&
          metadata.whatsappFrom === from
        );
      }),
    )?.id ?? null
  );
}

async function sendWhatsAppText(app: Parameters<FastifyPluginAsync>[0], to: string, text: string) {
  const token = env("WHATSAPP_API_TOKEN");
  const phoneNumberId = env("WHATSAPP_PHONE_NUMBER_ID");
  const apiVersion = env("WHATSAPP_API_VERSION") ?? "v20.0";

  if (!token || !phoneNumberId) {
    return { outcome: "stubbed" as WhatsAppSendOutcome, response: { stubbed: true } };
  }

  const response = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body: text },
    }),
  });

  const responseBody = (await response.json().catch(() => ({ statusText: response.statusText }))) as Record<
    string,
    unknown
  >;

  if (!response.ok) {
    app.log.warn({ status: response.status, responseBody }, "WhatsApp outbound send failed");
    return { outcome: "failed" as WhatsAppSendOutcome, response: { status: response.status, body: responseBody } };
  }

  return { outcome: "sent" as WhatsAppSendOutcome, response: responseBody };
}

export const whatsappRoutes: FastifyPluginAsync = async (app) => {
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });

  app.get("/whatsapp", async (request, reply) => {
    const query = verifyQuerySchema.safeParse(request.query);
    const expectedVerifyToken = env("WHATSAPP_VERIFY_TOKEN");
    const entityId = "webhook-verification";

    if (!query.success || !expectedVerifyToken || query.data["hub.verify_token"] !== expectedVerifyToken) {
      await auditWebhook(
        app,
        "whatsapp.webhook.rejected",
        entityId,
        { query: request.query },
        { reason: !expectedVerifyToken ? "verify_token_missing" : "verify_token_mismatch" },
        "rejected",
      );
      return reply.code(403).send({ error: "Invalid WhatsApp webhook verification token." });
    }

    await auditWebhook(
      app,
      "whatsapp.webhook.verified",
      entityId,
      { mode: query.data["hub.mode"] },
      { challenge: query.data["hub.challenge"] },
      "verified",
    );
    return reply.type("text/plain").send(query.data["hub.challenge"]);
  });

  app.post("/whatsapp", async (request, reply) => {
    const rawBody = parseRawBody(request);
    const signature = Array.isArray(request.headers["x-hub-signature-256"])
      ? request.headers["x-hub-signature-256"][0]
      : request.headers["x-hub-signature-256"];

    if (!verifySignature(rawBody, signature)) {
      await auditWebhook(
        app,
        "whatsapp.webhook.rejected",
        "webhook-post",
        { signaturePresent: Boolean(signature), bodyLength: rawBody.length },
        { reason: env("WHATSAPP_APP_SECRET") ? "signature_invalid" : "app_secret_missing" },
        "rejected",
      );
      return reply.code(401).send({ error: "Invalid WhatsApp webhook signature." });
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawBody.toString("utf8"));
    } catch (err) {
      await auditWebhook(
        app,
        "whatsapp.webhook.rejected",
        "webhook-post",
        { bodyLength: rawBody.length },
        { reason: "invalid_json", error: serializableError(err) },
        "malformed",
      );
      return reply.code(400).send({ error: "Malformed WhatsApp webhook payload." });
    }

    const payload = whatsappPayloadSchema.safeParse(parsedJson);
    if (!payload.success) {
      await auditWebhook(
        app,
        "whatsapp.webhook.rejected",
        "webhook-post",
        { bodyLength: rawBody.length },
        { reason: "invalid_payload", issues: payload.error.issues },
        "malformed",
      );
      return reply.code(400).send({ error: "Invalid WhatsApp webhook payload." });
    }

    const organisationId = env("WHATSAPP_DEFAULT_ORGANISATION_ID") ?? "demo-org";

    for (const entry of payload.data.entry) {
      for (const change of entry.changes) {
        const metadata = change.value.metadata ?? {};

        for (const status of change.value.statuses ?? []) {
          await auditWebhook(
            app,
            "whatsapp.status.received",
            status.id,
            { entryId: entry.id, field: change.field, status },
            { phoneNumberId: metadata.phone_number_id ?? null },
            status.status,
          );
        }

        for (const message of change.value.messages ?? []) {
          const duplicate = await app.db.auditEvent.findFirst({
            where: {
              entityType: "WhatsAppMessage",
              entityId: message.id,
              action: "whatsapp.message.received",
            },
            select: { id: true },
          });

          if (duplicate) {
            await auditWebhook(
              app,
              "whatsapp.message.duplicate",
              message.id,
              { from: message.from, type: message.type },
              { duplicateOfAuditEventId: duplicate.id },
              "duplicate",
            );
            continue;
          }

          await auditWebhook(
            app,
            "whatsapp.message.received",
            message.id,
            {
              from: message.from,
              type: message.type,
              timestamp: message.timestamp ?? null,
              phoneNumberId: metadata.phone_number_id ?? null,
            },
            { organisationId },
            "received",
          );

          if (message.type !== "text" || !message.text?.body) {
            const unsupportedText = "I can only handle text WhatsApp messages for this pilot. Please send the booking details as a message.";
            const sendResult = await sendWhatsAppText(app, message.from, unsupportedText);
            await auditWebhook(
              app,
              "whatsapp.message.unsupported",
              message.id,
              { from: message.from, type: message.type },
              { outbound: sendResult },
              "unsupported",
            );
            await auditWebhook(
              app,
              "whatsapp.outbound.send",
              message.id,
              { to: message.from, reason: "unsupported_message_type" },
              sendResult.response,
              sendResult.outcome,
            );
            continue;
          }

          try {
            const conversationId = await findConversationId(app, organisationId, message.from);
            const intakeResult = await processIntakeTurn(app, request.log, {
              organisationId,
              rawInput: message.text.body,
              channel: "whatsapp",
              conversationId,
              inboundMetadata: {
                channel: "whatsapp",
                whatsappMessageId: message.id,
                whatsappFrom: message.from,
                whatsappTimestamp: message.timestamp ?? null,
                whatsappPhoneNumberId: metadata.phone_number_id ?? null,
                whatsappDisplayPhoneNumber: metadata.display_phone_number ?? null,
              },
              outboundMetadata: {
                channel: "whatsapp",
                whatsappReplyTo: message.from,
                whatsappReplySourceMessageId: message.id,
              },
            });

            const sendResult = await sendWhatsAppText(app, message.from, intakeResult.message);
            await auditWebhook(
              app,
              "whatsapp.outbound.send",
              message.id,
              {
                to: message.from,
                conversationId: intakeResult.conversationId,
                bookingRequestId: intakeResult.bookingRequestId ?? null,
              },
              sendResult.response,
              sendResult.outcome,
            );
          } catch (err) {
            const statusCode = err instanceof IntakeHttpError ? err.statusCode : undefined;
            request.log.error({ err }, "WhatsApp intake processing failed");
            await auditWebhook(
              app,
              "whatsapp.webhook.rejected",
              message.id,
              { from: message.from, organisationId },
              {
                reason: "intake_processing_failed",
                statusCode: statusCode ?? null,
                error: err instanceof IntakeHttpError ? err.payload : serializableError(err),
              },
              "internal_error",
            );
          }
        }
      }
    }

    return reply.send({ received: true });
  });
};
