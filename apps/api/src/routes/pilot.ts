import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { Prisma } from "@viora/database";
import { createLLMClient, normalizeVFirstPerson, V_FIRST_PERSON_VOICE_RULE } from "@viora/agents";
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
  contactEmail: z.string().trim().email().max(180).optional(),
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

const V_CHAT_SYSTEM = `You are V, the calm staffing guide for Viora's marketing website. Viora is an AI-native flexible staffing agency starting with education in the UK.

Your first job is to help visitors explore what Viora can do. Signup is one possible outcome, not the opening pressure.

Core facts (always true):
- Organisations tell V what cover they need in plain language; V structures the request, finds suitable workers, checks compliance, books, tracks, and can help replace cover if things change.
- Viora starts with education because urgent cover, safeguarding, DBS, QTS, Right to Work, and site fit all need reliable compliance and audit trails.
- There is an agent on each side — for the organisation and for the worker — negotiating fit and better, fair pay through a shared Viora Memory core.
- Compliance eligibility is deterministic and never inferred by an LLM; DBS, Right to Work, safeguarding, QTS, and SIA are verified every time.
- Viora Memory remembers preferences and context to reduce repeated questions, but it never overrides compliance.
- Every action is audited end to end; the coordination layer is always-on and lower-overhead than a traditional agency. Do not promise exact prices, savings percentages, or guaranteed fill times.
- Workers get better-fit shifts, better and fairer pay, more control over preferences, and a portable profile over time.
- The pilot is for organisations that need cover and workers who want flexible shifts.

Topic playbooks — when the visitor asks about these themes, hit the key points below. You only have 2 short sentences per turn, so pick the 2 strongest points not already covered in this conversation; on follow-ups, cover the remaining points before offering registration.

1) "How does Viora work?" / how it works / what you do
   Must eventually cover: plain-language requests from organisations; V structures, matches, verifies compliance, books and tracks; replacement if cover falls through; agents negotiate fit and better, fair pay on both sides.
   Example angle: "Tell me what cover you need in plain language — I structure it, find the right people, and negotiate better, fair pay before anyone is booked."

2) "Why is it different?" / vs traditional agency / what makes Viora different
   Must eventually cover: agent on each side with shared Viora Memory; match and negotiate on fit and better, fair pay, never on eligibility; better pay and outcomes for workers than a traditional agency; compliance verified every time (DBS, RTW, safeguarding, QTS, SIA); timely cover; lower agency overhead; fully audited.
   Example angle: "Unlike a traditional agency, I coordinate both sides with agents — negotiating better, fair pay on fit while compliance stays verified every time."

3) "For organisations" / schools / employers / cover / fill shifts
   Must eventually cover: real-time cover; compliance built in; lower agency overhead; agents negotiate fair pay so cover is well-placed; plain-language intake; audited end to end.
   Example angle: "For organisations, you tell me what cover you need — I match, verify compliance, and negotiate fair pay so the right person fills the shift."

4) "For workers" / find work / shifts / supply teaching
   Must eventually cover: better-fit shifts; better and fairer pay than typical agency work; control over preferences; portable profile that improves over time; compliance still verified, never skipped.
   Example angle: "For workers, I find better-fit shifts with better, fairer pay — and you stay in control of your preferences."

5) "Help me register" / sign up / join / callback / waitlist
   Start directed capture immediately — do not re-pitch the product first.

If the visitor wants to register, run a short directed capture:
1. Work out whether they are an ORGANISATION/EMPLOYER (wants to fill shifts) or a WORKER (wants to find work). Set leadType accordingly; use "unknown" only until you know.
2. Collect ONLY the conversational details needed before the final typed email step:
   - Always required before email: name.
   - Employer also required before email: organisationName.
   - Worker also required before email: postcode.
   The fields phone, roleTitle, workerRoleTypes, and complianceReadiness (for example DBS/QTS/SIA) are optional: capture them if offered, but never ask for them, never list them in "missing", and never let them block readiness.
3. While any required pre-email field is outstanding, set readyToCapture=false, list only those missing fields in "missing", and ask for ONE of them at a time in "reply".
4. The moment the required pre-email fields are known, set readyToCapture=true and intent="callback" for employers or "waitlist" for workers. Do not ask for an email in speech; the interface shows a typed email box. Do not claim the lead is registered until the system confirms capture.

Rules:
- Keep "reply" to at most 2 short sentences, warm and human.
- Make each sentence caption-friendly: one clear idea, preferably under 14 words.
- ${V_FIRST_PERSON_VOICE_RULE}
- Put everything you have learned so far into "fields" and carry values forward across turns.
- "missing" lists only required pre-email fields still outstanding.
- Never invent prices, guarantees, partners, accreditation, or compliance shortcuts.
- If the visitor goes off-topic, answer briefly when relevant, then gently offer to explain Viora or help them register.
- Always respond by calling the capture_lead_turn tool.`;

const V_CHAT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    reply: { type: "string", description: "V's next message to the visitor. At most 2 short caption-friendly sentences." },
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
    reply: normalizeVFirstPerson("I'm having trouble responding right now - please use the quick form below and I will get in touch."),
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

/** Steer the model toward the right playbook when the latest visitor message matches a common chip or paraphrase. */
function topicHintForTurn(messages: { role: "user" | "v"; content: string }[]): string {
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const lower = lastUser.toLowerCase();
  if (!lower) return "";

  if (/\b(different|traditional agency|vs\b|versus|compare|what makes|why viora)\b/.test(lower)) {
    return "Topic: why Viora is different. Prioritise uncovered points from playbook 2 — agents both sides, shared memory, fit and better/fair pay (not eligibility), better pay for workers, verified compliance, timely cover, lower overhead, audited.";
  }
  if (/\b(how does|how do|how it works|what do you do|what does viora)\b/.test(lower)) {
    return "Topic: how Viora works. Prioritise uncovered points from playbook 1 — plain-language intake, structure/match/verify/book/track, replacement cover, agents negotiate better/fair pay.";
  }
  if (/\b(organisation|organization|employer|school|cover|fill shift|headteacher|head teacher)\b/.test(lower)) {
    return "Topic: for organisations. Prioritise uncovered points from playbook 3 — real-time cover, compliance built in, lower overhead, fair pay negotiation, plain language, audited.";
  }
  if (/\b(worker|find work|shift|supply teach|teaching assistant|cover supervisor)\b/.test(lower)) {
    return "Topic: for workers. Prioritise uncovered points from playbook 4 — better-fit shifts, better and fairer pay, preferences, portable profile, compliance verified.";
  }
  if (/\b(register|sign up|signup|join|callback|waitlist|get started|pilot)\b/.test(lower)) {
    return "Topic: registration. Start directed capture immediately per the registration flow — do not re-pitch.";
  }
  if (/\b(compliance|dbs|safeguarding|qts|right to work|sia|eligible)\b/.test(lower)) {
    return "Topic: compliance. Stress deterministic checks (never LLM-inferred), verified every time, and that matching is on fit and better/fair pay not eligibility.";
  }
  if (/\b(pay|rate|rates|salary|money|earn|wage|day rate)\b/.test(lower)) {
    return "Topic: pay. Explain agents negotiate better, fair pay on both sides; workers get better and fairer pay than typical agency work; do not quote specific rates or guarantees.";
  }
  if (/\b(memory|remember|preference)\b/.test(lower)) {
    return "Topic: Viora Memory. Explain preference/context memory that reduces repeat questions; never overrides compliance.";
  }
  return "";
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
  contactEmail: string | undefined,
): PilotLeadInput | null {
  if (turn.leadType !== "employer" && turn.leadType !== "worker") return null;
  const f = turn.fields ?? {};
  const transcript = buildTranscript(messages).slice(0, 1600);
  const notes = [cleanStr(f.notes), `Captured via V chat. Email typed in final inline step.\n${transcript}`]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 2000);

  const candidate = {
    leadType: turn.leadType,
    name: cleanStr(f.name),
    email: cleanStr(contactEmail) ?? cleanStr(f.email),
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

/** Deterministic readiness - never let the LLM decide what's required. */
function requiredMissing(
  leadType: VChatTurn["leadType"],
  fields: VChatTurn["fields"],
): string[] {
  if (leadType !== "employer" && leadType !== "worker") return ["leadType"];
  const missing: string[] = [];
  if (!cleanStr(fields.name)) missing.push("name");
  if (leadType === "employer" && !cleanStr(fields.organisationName)) missing.push("organisationName");
  if (leadType === "worker" && !cleanStr(fields.postcode)) missing.push("postcode");
  return missing;
}

function emailPromptReply(leadType: "employer" | "worker", name?: string): string {
  const who = name ? `, ${name}` : "";
  return leadType === "employer"
    ? `Great${who}, I've got the essentials. Type your email below and tick consent, then I'll register your callback.`
    : `Great${who}, I've got the essentials. Type your email below and tick consent, then I'll add you to the early worker pool.`;
}

function consentPromptReply(): string {
  return "Almost done - tick consent and I'll register you.";
}

function confirmationReply(leadType: "employer" | "worker", name?: string, org?: string): string {
  const who = name ? `, ${name}` : "";
  return leadType === "employer"
    ? `Okay${who}, I've got your email address and logged a callback${org ? ` for ${org}` : ""}. I will get in touch shortly.`
    : `Okay${who}, I've got your email address and added you to the early worker pool. I will get in touch when I have matched shifts.`;
}

export const pilotRoutes: FastifyPluginAsync = async (app) => {
  app.post("/leads", async (request, reply) => {
    const body = pilotLeadSchema.parse(request.body);
    const lead = await app.db.$transaction((tx) => createPilotLead(tx, body, "form"));
    return reply.code(201).send({ lead });
  });

  /** POST /v1/pilot/chat - V-driven conversational lead capture for the marketing site. */
  app.post("/chat", async (request, reply) => {
    const body = chatSchema.parse(request.body);

    let turn: VChatTurn;
    try {
      const llm = await createLLMClient();
      const hint = topicHintForTurn(body.messages);
      turn = await llm.structured<VChatTurn>({
        system: V_CHAT_SYSTEM,
        prompt: `Conversation so far:\n${buildTranscript(body.messages)}${hint ? `\n\n${hint}` : ""}\n\nReturn V's next turn. If key playbook points were already covered, add the next most important uncovered point or offer to help register.`,
        toolName: "capture_lead_turn",
        toolDescription:
          "Produce V's next reply plus the lead details captured so far and whether the visitor is ready for the typed email step.",
        schema: V_CHAT_SCHEMA,
        maxTokens: 800,
      });
    } catch (err) {
      request.log.warn({ err }, "V chat failed; returning degraded fallback");
      const fallback = fallbackChatTurn();
      return reply.send({
        ...fallback,
        readyForEmail: false,
        captured: false,
        leadId: null,
        degraded: true,
      });
    }

    // Readiness and intent are decided deterministically from captured fields,
    // not by the model. Email is typed in the UI after this pre-email step.
    const missing = requiredMissing(turn.leadType, turn.fields);
    const readyForEmail = missing.length === 0;
    const contactEmail = cleanStr(body.contactEmail);
    const readyToCapture = readyForEmail && Boolean(contactEmail);
    const intent =
      turn.leadType === "employer" ? "callback" : turn.leadType === "worker" ? "waitlist" : "none";

    let leadId: string | null = null;
    let captured = false;
    let replyText = normalizeVFirstPerson(turn.reply);
    if (readyForEmail && turn.leadType !== "unknown" && !contactEmail) {
      replyText = emailPromptReply(turn.leadType, cleanStr(turn.fields.name));
    } else if (readyToCapture && !body.consent) {
      replyText = consentPromptReply();
    } else if (readyToCapture && body.consent) {
      const leadInput = toLeadInput(turn, body.messages, contactEmail);
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
      reply: normalizeVFirstPerson(replyText),
      leadType: turn.leadType,
      fields: turn.fields,
      missing,
      readyForEmail,
      readyToCapture,
      intent,
      remembered: cleanStr(turn.remembered) ?? null,
      captured,
      leadId,
      degraded: false,
    });
  });
};
