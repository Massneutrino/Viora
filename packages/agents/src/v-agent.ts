import { createLLMClient } from "./llm.js";
import type { VAgent, ParsedBookingIntent, VIntakeContext } from "./types.js";

const INTENT_SCHEMA = {
  type: "object",
  properties: {
    roleType: { type: "string", description: "Staffing role in snake_case" },
    siteId: { type: "string", description: "Site id from the known sites list when the employer names or references a site" },
    siteName: { type: "string", description: "Human-readable site/school name as the employer wrote it" },
    startAt: { type: "string", description: "ISO 8601 datetime for shift start" },
    endAt: { type: "string", description: "ISO 8601 datetime for shift end" },
    payRate: { type: "number", description: "Hourly pay rate in GBP if stated" },
    maxPayRate: { type: "number", description: "Maximum hourly pay rate in GBP if stated" },
    requirements: {
      type: "object",
      description: "Any additional requirements (DBS level, subject specialism, etc.)",
      additionalProperties: true,
    },
    missingFields: {
      type: "array",
      items: { type: "string" },
      description: "Names of fields that are missing or unclear",
    },
    confidence: { type: "number", description: "Confidence score 0.0–1.0" },
  },
  required: ["roleType", "startAt", "endAt", "missingFields", "confidence"],
};

export const vAgent: VAgent = {
  channel: "web",

  async parseIntent(rawInput: string, context: VIntakeContext): Promise<ParsedBookingIntent> {
    const llm = await createLLMClient();
    const guardrailSummary = [
      `autonomyLevel: ${context.guardrails.autonomyLevel}`,
      `budgetCeiling: ${context.guardrails.budgetCeiling ?? "not_set"}`,
      `payFloor: ${context.guardrails.payFloor ?? "not_set"}`,
      `maxCommuteMinutes: ${context.guardrails.maxCommuteMinutes ?? "not_set"}`,
      `approvedRoleTypes: ${context.guardrails.approvedRoleTypes.join(", ") || "not_set"}`,
      `escalationContacts: ${context.guardrails.escalationContacts.join(", ") || "not_set"}`,
    ].join("\n");

    const sitesSummary =
      context.sites?.map((s) => `- ${s.id}: ${s.name}`).join("\n") ?? "none loaded";

    const raw = await llm.structured<Record<string, unknown>>({
      toolName: "capture_booking_intent",
      toolDescription: "Record the structured booking intent parsed from the employer's message",
      schema: INTENT_SCHEMA,
      maxTokens: 2048,
      system: `You are V, the AI intake agent for Viora — an intelligent staffing platform for regulated sectors (schools, NHS, social care).
Parse the employer's natural-language staffing request into structured data.
Organisation ID in scope: ${context.organisationId}
Known sites for this organisation:
${sitesSummary}
Employer guardrails in scope:
${guardrailSummary}

Rules:
- roleType: normalise to snake_case (e.g. "supply_teacher", "teaching_assistant", "cover_supervisor", "TA")
- if roleType is outside approvedRoleTypes, keep the parsed role but include "roleType" in missingFields for human clarification
- if payRate is above budgetCeiling or below payFloor, keep the parsed rate but include "payRate" in missingFields for human clarification
- startAt / endAt: infer from context; if the date is missing assume the next working day; default shift 08:30–15:30 UK time
- when the employer names a site id or school name, set siteId to the matching id from the known sites list
- if this is a follow-up message, merge new details with previously extracted booking fields — do not drop information already provided
- missingFields: list every field that is still absent or genuinely ambiguous (siteId, payRate, startAt, endAt, requirements)
- confidence: 0.0–1.0 reflecting how clearly the request was stated`,
      prompt: rawInput,
    });

    return {
      roleType: raw["roleType"] as string,
      siteId: raw["siteId"] as string | undefined,
      siteName: raw["siteName"] as string | undefined,
      startAt: new Date(raw["startAt"] as string),
      endAt: new Date(raw["endAt"] as string),
      payRate: raw["payRate"] as number | undefined,
      maxPayRate: raw["maxPayRate"] as number | undefined,
      requirements: raw["requirements"] as Record<string, unknown> | undefined,
      missingFields: raw["missingFields"] as string[],
      confidence: raw["confidence"] as number,
    };
  },

  async clarify(missingFields: string[], context: Record<string, unknown>): Promise<string> {
    const llm = await createLLMClient();
    return llm.complete({
      maxTokens: 512,
      system: `You are V, a warm and professional AI assistant for the Viora staffing platform.
Your job is to ask a brief, friendly follow-up question to gather missing information about a staffing booking.
Ask for at most two things at once. Be conversational, not robotic.`,
      prompt: `The following details are missing from the booking request: ${missingFields.join(", ")}.
Context: ${JSON.stringify(context)}
Ask the employer for this information.`,
    });
  },

  async confirmIntent(intent: ParsedBookingIntent): Promise<string> {
    const llm = await createLLMClient();
    const text = await llm.complete({
      maxTokens: 512,
      system: `You are V, a warm and professional AI assistant for the Viora staffing platform.
Summarise the staffing booking about to be submitted in 2–3 friendly sentences.
Include: role, site (if known), date/time, and pay rate (if known). End with a reassuring note.`,
      prompt: `Confirm this booking intent:\n${JSON.stringify(intent, null, 2)}`,
    });
    return text || `Booking confirmed: ${intent.roleType} from ${intent.startAt.toISOString()} to ${intent.endAt.toISOString()}.`;
  },
};
