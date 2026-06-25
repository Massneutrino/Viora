import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { Prisma } from "@viora/database";
import { createLLMClient } from "@viora/agents";
import { writeAuditEvent } from "../audit.js";

const pilotLeadSchema = z
  .object({
    leadType: z.enum(["employer", "worker"]),
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().email().max(180),
    phone: z.string().trim().max(60).optional(),
    organisationName: z.string().trim().max(180).optional(),
    roleTitle: z.string().trim().max(120).optional(),
    postcode: z.string().trim().max(30).optional(),
    workerRoleTypes: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
    complianceReadiness: z.string().trim().max(120).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.leadType === "employer" && !value.organisationName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["organisationName"],
        message: "Organisation is required for employer leads.",
      });
    }
    if (value.leadType === "worker" && !value.postcode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["postcode"],
        message: "Postcode is required for worker leads.",
      });
    }
  });

type PilotLeadInput = z.infer<typeof pilotLeadSchema>;

function blankToUndefined(value: string | undefined) {
  return value && value.length > 0 ? value : undefined;
}

/**
 * Shared lead persistence + audit, reused by the manual form (POST /leads) and
 * the conversational capture (POST /chat). `source` distinguishes the channel
 * in the audit trail.
 */
async function createPilotLead(
  tx: Prisma.TransactionClient,
  body: PilotLeadInput,
  source: "form" | "chat",
) {
  const created = await tx.pilotLead.create({
    data: {
      leadType: body.leadType,
      name: body.name,
      email: body.email,
      phone: blankToUndefined(body.phone),
      organisationName: blankToUndefined(body.organisationName),
      roleTitle: blankToUndefined(body.roleTitle),
      postcode: blankToUndefined(body.postcode),
      workerRoleTypes: body.workerRoleTypes ?? [],
      complianceReadiness: blankToUndefined(body.complianceReadiness),
      notes: blankToUndefined(body.notes),
    },
  });

  await writeAuditEvent(tx, {
    actorType: "user",
    actorId: body.email,
    action: "pilot.lead.create",
    entityType: "PilotLead",
    entityId: created.id,
    inputs: {
      source,
      leadType: body.leadType,
      email: body.email,
      organisationName: body.organisationName ?? null,
      postcode: body.postcode ?? null,
    } as Prisma.InputJsonValue,
    outputs: { leadId: created.id, status: created.status } as Prisma.InputJsonValue,
    outcome: "created",
  });

  return created;
}

// --- Conversational capture (V chat) -------------------------------------

const chatMessageSchema = z.object({
  role: z.enum(["user", "v"]),
  content: z.string().trim().min(1).max(2000),
});

const chatSchema = z.object({
  messages: z.array(chatMessageSchema).min(1).max(40),
  consent: z.boolean().optional().default(false),
});

type VChatTurn = {
  reply: string;
  leadType: "employer" | "worker" | "unknown";
  fields: {
    name?: string;
    email?: string;
    phone?: string;
    organisationName?: string;
    roleTitle?: string;
    postcode?: string;
    workerRoleTypes?: string[];
    complianceReadiness?: string;
    notes?: string;
  };
  missing: string[];
  readyToCapture: boolean;
  intent: "callback" | "waitlist" | "none";
  remembered?: string;
};

const V_CHAT_SYSTEM = `You are V, the staffing agent for Viora. You are talking to a visitor on Viora's marketing website. Viora is a flexible-staffing service starting with the education sector in the UK.

Your job is a SHORT, DIRECTED conversation — not open-ended chat:
1. Work out whether the visitor is an ORGANISATION/EMPLOYER (wants to fill shifts) or a WORKER (wants to find work). Set leadType accordingly; use "unknown" only until you know.
2. Collect ONLY the REQUIRED details to register them:
   - Always required: name, email.
   - Employer also required: organisationName.
   - Worker also required: postcode.
   The fields phone, roleTitle, workerRoleTypes, and complianceReadiness (e.g. DBS/QTS/SIA) are OPTIONAL: capture them if the visitor offers them, but NEVER ask for them, NEVER list them in "missing", and NEVER let them block readyToCapture.
3. While any REQUIRED field is still outstanding, set readyToCapture=false, list only the missing required fields in "missing", and ask for ONE of them at a time in "reply".
4. The moment you have every REQUIRED field for the leadType, set readyToCapture=true and intent="callback" for employers or "waitlist" for workers — even if optional fields are blank. When readyToCapture is true your "reply" must ONLY warmly confirm what happens next (a callback for employers, a place on the early worker pool for workers) and must NOT ask any further question. Do NOT claim it is already registered — the system handles that.

If the visitor asks how Viora works, you may explain briefly and in plain, non-technical marketing language: V is an AI agent that understands what you need, finds the right people, runs the compliance checks automatically, and books the shift — lower agency overhead for organisations, better-paid and better-fit work for people. Keep it to 1-2 sentences and never invent specifics, prices, or guarantees.

Viora Memory: if the visitor states a durable preference worth remembering for next time (a recurring need, a preferred role or site, an availability pattern, a pay expectation), set "remembered" to a short third-person note, e.g. "Prefers cover supervisors in Manchester" or "Available Fridays, up to 10 hours". Otherwise leave it empty. Memory sharpens future matching but never overrides compliance eligibility — do not imply it does.

Rules:
- Keep "reply" to at most 2 short sentences, warm and human.
- Put everything you have learned so far into "fields" (carry values forward across turns; never drop a value you already captured).
- "missing" lists the required fields still outstanding for the current leadType.
- Never ask for more than the fields above. If the visitor goes off-topic, gently steer back.
- Always respond by calling the capture_lead_turn tool.`;

const V_CHAT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    reply: { type: "string", description: "V's next message to the visitor. At most 2 short sentences." },
    leadType: { type: "string", enum: ["employer", "worker", "unknown"] },
    fields: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        organisationName: { type: "string" },
        roleTitle: { type: "string" },
        postcode: { type: "string" },
        workerRoleTypes: { type: "array", items: { type: "string" } },
        complianceReadiness: { type: "string" },
        notes: { type: "string" },
      },
    },
    missing: { type: "array", items: { type: "string" } },
    readyToCapture: { type: "boolean" },
    intent: { type: "string", enum: ["callback", "waitlist", "none"] },
    remembered: {
      type: "string",
      description: "Optional short third-person memory note when the visitor states a durable preference; empty otherwise.",
    },
  },
  required: ["reply", "leadType", "fields", "missing", "readyToCapture", "intent"],
} as const;

function fallbackChatTurn(): VChatTurn {
  return {
    reply:
      "I'm having trouble responding right now — please use the quick form below and we'll be in touch.",
    leadType: "unknown",
    fields: {},
    missing: [],
    readyToCapture: false,
    intent: "none",
  };
}

function buildTranscript(messages: { role: "user" | "v"; content: string }[]): string {
  return messages.map((m) => `${m.role === "user" ? "Visitor" : "V"}: ${m.content}`).join("\n");
}

function cleanStr(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Map an LLM turn + the running transcript into a validated PilotLeadInput, or null if not capturable. */
function toLeadInput(
  turn: VChatTurn,
  messages: { role: "user" | "v"; content: string }[],
): PilotLeadInput | null {
  if (turn.leadType !== "employer" && turn.leadType !== "worker") return null;
  const f = turn.fields ?? {};
  const transcript = buildTranscript(messages).slice(0, 1600);
  const notes = [cleanStr(f.notes), `Captured via V chat.\n${transcript}`]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 2000);

  const candidate = {
    leadType: turn.leadType,
    name: cleanStr(f.name),
    email: cleanStr(f.email),
    phone: cleanStr(f.phone),
    organisationName: cleanStr(f.organisationName),
    roleTitle: cleanStr(f.roleTitle),
    postcode: cleanStr(f.postcode),
    workerRoleTypes: Array.isArray(f.workerRoleTypes)
      ? f.workerRoleTypes.map((r) => cleanStr(r)).filter((r): r is string => Boolean(r))
      : undefined,
    complianceReadiness: cleanStr(f.complianceReadiness),
    notes,
  };

  const parsed = pilotLeadSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/** Deterministic readiness — never let the LLM decide what's required. */
function requiredMissing(
  leadType: VChatTurn["leadType"],
  fields: VChatTurn["fields"],
): string[] {
  if (leadType !== "employer" && leadType !== "worker") return ["leadType"];
  const missing: string[] = [];
  if (!cleanStr(fields.name)) missing.push("name");
  if (!cleanStr(fields.email)) missing.push("email");
  if (leadType === "employer" && !cleanStr(fields.organisationName)) missing.push("organisationName");
  if (leadType === "worker" && !cleanStr(fields.postcode)) missing.push("postcode");
  return missing;
}

function confirmationReply(leadType: "employer" | "worker", name?: string, org?: string): string {
  const who = name ? `, ${name}` : "";
  return leadType === "employer"
    ? `Thanks${who} — I've logged a callback${org ? ` for ${org}` : ""}. We'll be in touch shortly.`
    : `You're on the early worker pool${who} — V will reach out as soon as we have matched shifts for you.`;
}

export const pilotRoutes: FastifyPluginAsync = async (app) => {
  app.post("/leads", async (request, reply) => {
    const body = pilotLeadSchema.parse(request.body);
    const lead = await app.db.$transaction((tx) => createPilotLead(tx, body, "form"));
    return reply.code(201).send({ lead });
  });

  /** POST /v1/pilot/chat — V-driven conversational lead capture for the marketing site. */
  app.post("/chat", async (request, reply) => {
    const body = chatSchema.parse(request.body);

    let turn: VChatTurn;
    try {
      const llm = await createLLMClient();
      turn = await llm.structured<VChatTurn>({
        system: V_CHAT_SYSTEM,
        prompt: `Conversation so far:\n${buildTranscript(body.messages)}\n\nReturn V's next turn.`,
        toolName: "capture_lead_turn",
        toolDescription:
          "Produce V's next reply plus the lead details captured so far and whether the lead is ready to register.",
        schema: V_CHAT_SCHEMA,
        maxTokens: 800,
      });
    } catch (err) {
      request.log.warn({ err }, "V chat failed; returning degraded fallback");
      const fallback = fallbackChatTurn();
      return reply.send({ ...fallback, captured: false, leadId: null, degraded: true });
    }

    // Readiness and intent are decided deterministically from the captured
    // fields — not by the model — so capture can't loop on optional fields.
    const missing = requiredMissing(turn.leadType, turn.fields);
    const readyToCapture = missing.length === 0;
    const intent =
      turn.leadType === "employer" ? "callback" : turn.leadType === "worker" ? "waitlist" : "none";

    let leadId: string | null = null;
    let captured = false;
    let replyText = turn.reply;
    if (readyToCapture && body.consent) {
      const leadInput = toLeadInput(turn, body.messages);
      if (leadInput) {
        const lead = await app.db.$transaction((tx) => createPilotLead(tx, leadInput, "chat"));
        leadId = lead.id;
        captured = true;
        replyText = confirmationReply(
          leadInput.leadType,
          cleanStr(turn.fields.name),
          cleanStr(turn.fields.organisationName),
        );
      }
    }

    return reply.send({
      reply: replyText,
      leadType: turn.leadType,
      fields: turn.fields,
      missing,
      readyToCapture,
      intent,
      remembered: cleanStr(turn.remembered) ?? null,
      captured,
      leadId,
      degraded: false,
    });
  });
};
