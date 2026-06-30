import { createLLMClient } from "./llm.js";
import type { VAgent, ParsedBookingIntent, VIntakeContext } from "./types.js";
import { normalizeVFirstPerson, V_FIRST_PERSON_VOICE_RULE } from "./v-copy.js";

const INTENT_SCHEMA = {
  type: "object",
  properties: {
    roleType: { type: "string", description: "Staffing role in snake_case" },
    siteId: { type: "string", description: "Site id from the known sites list when the employer names or references a site" },
    siteName: { type: "string", description: "Human-readable site/school name as the employer wrote it" },
    startAt: { type: "string", description: "ISO 8601 datetime for shift start" },
    endAt: { type: "string", description: "ISO 8601 datetime for shift end" },
    rateMode: {
      type: "string",
      enum: ["standard", "dynamic"],
      description: "standard for one fixed rate, dynamic when the employer explicitly asks V to adjust within a range",
    },
    payRate: { type: "number", description: "Daily/session pay rate in GBP if stated" },
    maxPayRate: { type: "number", description: "Maximum daily/session pay rate in GBP if a Dynamic Rate range or ceiling is stated" },
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
    confidence: { type: "number", description: "Confidence score 0.0-1.0" },
  },
  required: ["roleType", "startAt", "endAt", "missingFields", "confidence"],
};

const REQUIREMENT_KEYWORDS = [
  "ks1",
  "ks2",
  "send",
  "sen",
  "maths",
  "mathematics",
  "science",
  "gcse",
] as const;

function normaliseRequirementKeyword(keyword: string): string {
  return keyword === "mathematics" ? "maths" : keyword;
}

function normalizeRequirements(
  rawInput: string,
  requirements: unknown,
): Record<string, unknown> | undefined {
  if (requirements && typeof requirements === "object" && Object.keys(requirements).length > 0) {
    return requirements as Record<string, unknown>;
  }

  const lower = rawInput.toLowerCase();
  const keywords = [
    ...new Set(
      REQUIREMENT_KEYWORDS
        .filter((keyword) => new RegExp(`\\b${keyword}\\b`, "i").test(lower))
        .map(normaliseRequirementKeyword),
    ),
  ];
  return keywords.length > 0 ? { keywords } : undefined;
}

function normalizeLookupText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function resolveSiteId(
  rawInput: string,
  siteName: string | undefined,
  siteId: string | undefined,
  context: VIntakeContext,
): { siteId?: string; siteName?: string } {
  if (siteId) return { siteId, siteName };
  const haystack = normalizeLookupText(`${rawInput} ${siteName ?? ""}`);
  const match = context.sites?.find((site) => {
    const normalizedId = normalizeLookupText(site.id);
    const normalizedName = normalizeLookupText(site.name);
    const nameTokens = normalizedName.split(" ").filter((token) => token.length > 2);
    return (
      haystack.includes(normalizedId) ||
      haystack.includes(normalizedName) ||
      (nameTokens.length > 0 && nameTokens.every((token) => haystack.includes(token)))
    );
  });
  return match ? { siteId: match.id, siteName: match.name } : { siteId, siteName };
}

function normalizeRates(
  rawInput: string,
  rateMode: ParsedBookingIntent["rateMode"],
  payRate: number | undefined,
  maxPayRate: number | undefined,
): { payRate?: number; maxPayRate?: number } {
  if (
    rateMode === "dynamic" &&
    payRate !== undefined &&
    maxPayRate !== undefined &&
    payRate === maxPayRate &&
    /\b(up\s+to|max(?:imum)?|ceiling|cap)\b/i.test(rawInput)
  ) {
    return { payRate: undefined, maxPayRate };
  }
  return { payRate, maxPayRate };
}

function normalizeMissingFields(
  rawMissingFields: unknown,
  intent: ParsedBookingIntent,
  context: VIntakeContext,
): string[] {
  const missing = new Set(
    Array.isArray(rawMissingFields)
      ? rawMissingFields.filter((field): field is string => typeof field === "string" && field !== "requirements")
      : [],
  );

  if (!intent.roleType) missing.add("roleType");
  if (!intent.siteId) missing.add("siteId");
  if (!(intent.startAt instanceof Date) || Number.isNaN(intent.startAt.getTime())) missing.add("startAt");
  if (!(intent.endAt instanceof Date) || Number.isNaN(intent.endAt.getTime())) missing.add("endAt");
  if (intent.payRate === undefined) missing.add("payRate");
  if (intent.rateMode === "dynamic" && intent.maxPayRate === undefined) missing.add("maxPayRate");

  if (
    intent.roleType &&
    context.guardrails.approvedRoleTypes.length > 0 &&
    !context.guardrails.approvedRoleTypes.includes(intent.roleType)
  ) {
    missing.add("roleType");
  }

  if (
    intent.payRate !== undefined &&
    ((context.guardrails.budgetCeiling !== undefined && intent.payRate > context.guardrails.budgetCeiling) ||
      (context.guardrails.payFloor !== undefined && intent.payRate < context.guardrails.payFloor))
  ) {
    missing.add("payRate");
  }

  return [...missing];
}

export const vAgent: VAgent = {
  channel: "web",

  async parseIntent(rawInput: string, context: VIntakeContext): Promise<ParsedBookingIntent> {
    const llm = await createLLMClient({ task: "parseIntent" });
    const now = new Date();
    const currentContext = new Intl.DateTimeFormat("en-GB", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: "Europe/London",
    }).format(now);
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
    const memorySummary = context.memory?.summary?.trim() || "No active Viora Memory loaded.";

    const raw = await llm.structured<Record<string, unknown>>({
      toolName: "capture_booking_intent",
      toolDescription: "Record the structured booking intent parsed from the employer's message",
      schema: INTENT_SCHEMA,
      maxTokens: 2048,
      system: `You are V, the AI intake agent for Viora - an intelligent staffing platform for regulated sectors (schools, NHS, social care).
Parse the employer's natural-language staffing request into structured data.
Organisation ID in scope: ${context.organisationId}
Current date/time: ${currentContext} Europe/London (${now.toISOString()})
Known sites for this organisation:
${sitesSummary}
Employer guardrails in scope:
${guardrailSummary}
Viora Memory in scope:
${memorySummary}

Rules:
- roleType: normalise to snake_case (e.g. "supply_teacher", "teaching_assistant", "cover_supervisor", "TA")
- Viora Memory can suggest likely defaults and context, but do not invent a booking field unless it is clearly supported by the latest message or prior conversation
- if roleType is outside approvedRoleTypes, keep the parsed role but include "roleType" in missingFields for human clarification
- if payRate is above budgetCeiling or below payFloor, keep the parsed rate but include "payRate" in missingFields for human clarification
- payRate: use the stated daily/session rate in GBP unless the employer explicitly says hourly; "GBP 150 a day" must be payRate 150, not an hourly conversion
- startAt / endAt: infer from context using the Current date/time above; never return a date in the past; if the date is missing assume the next working day; default shift 08:30-15:30 UK time
- when the employer names a site id or school name, set siteId to the matching id from the known sites list
- if this is a follow-up message, merge new details with previously extracted booking fields; do not drop information already provided
- if the latest message is only acknowledgement such as "thanks" or "thank you", keep the previously extracted fields rather than creating a new booking intent
- missingFields: list every field that is still absent or genuinely ambiguous (siteId, payRate, startAt, endAt, requirements)
- confidence: 0.0-1.0 reflecting how clearly the request was stated`,
      prompt: rawInput,
    });

    const rateMode = raw["rateMode"] === "dynamic" ? "dynamic" : "standard";
    const site = resolveSiteId(
      rawInput,
      raw["siteName"] as string | undefined,
      raw["siteId"] as string | undefined,
      context,
    );
    const rates = normalizeRates(
      rawInput,
      rateMode,
      raw["payRate"] as number | undefined,
      raw["maxPayRate"] as number | undefined,
    );
    const intent: ParsedBookingIntent = {
      roleType: raw["roleType"] as string,
      siteId: site.siteId,
      siteName: site.siteName,
      startAt: new Date(raw["startAt"] as string),
      endAt: new Date(raw["endAt"] as string),
      rateMode,
      payRate: rates.payRate,
      maxPayRate: rates.maxPayRate,
      requirements: normalizeRequirements(rawInput, raw["requirements"]),
      missingFields: [],
      confidence: raw["confidence"] as number,
    };
    return {
      ...intent,
      missingFields: normalizeMissingFields(raw["missingFields"], intent, context),
    };
  },

  async clarify(missingFields: string[], context: Record<string, unknown>): Promise<string> {
    const llm = await createLLMClient({ task: "clarify" });
    const text = await llm.complete({
      maxTokens: 512,
      system: `You are V, a warm and professional AI assistant for the Viora staffing platform.
Your job is to ask a brief, friendly follow-up question to gather missing information about a staffing booking.
Ask for at most two things at once. Be conversational, not robotic.
${V_FIRST_PERSON_VOICE_RULE}
If the context includes Viora Memory procedural playbooks, use them only as phrasing and clarification guidance. They must not change compliance, ranking, pay guardrails, or booking eligibility.`,
      prompt: `The following details are missing from the booking request: ${missingFields.join(", ")}.
Context: ${JSON.stringify(context)}
Ask the employer for this information.`,
    });
    return normalizeVFirstPerson(text);
  },

  async confirmIntent(intent: ParsedBookingIntent): Promise<string> {
    const llm = await createLLMClient({ task: "confirmIntent" });
    const text = await llm.complete({
      maxTokens: 512,
      system: `You are V, a warm and professional AI assistant for the Viora staffing platform.
Summarise the staffing booking in 2-3 friendly sentences.
${V_FIRST_PERSON_VOICE_RULE}
Include: role, site (if known), date/time, and pay rate (if known). End by saying I am matching eligible workers now.`,
      prompt: `Confirm this booking intent:\n${JSON.stringify(intent, null, 2)}`,
    });
    return normalizeVFirstPerson(text || `Booking confirmed: ${intent.roleType} from ${intent.startAt.toISOString()} to ${intent.endAt.toISOString()}.`);
  },
};
