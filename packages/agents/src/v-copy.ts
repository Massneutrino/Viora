export const V_FIRST_PERSON_VOICE_RULE =
  `When writing as V to an employer, worker, or visitor, speak in first person singular for V's own actions. ` +
  `Say "I will", "I am", "I have", and "I can"; do not say "V will", "V is", "V has", or "V can" for actions V is taking. ` +
  `Use "Viora" only for the company or product, not as the speaker.`;

const ACTION_VERBS =
  "(match(?:ing)?|look(?:ing)?|search(?:ing)?|check(?:ing)?|work(?:ing)?|respond(?:ing)?|think(?:ing)?|find(?:ing)?|prepare|preparing|book(?:ing)?|confirm(?:ing)?|register(?:ing)?|add(?:ing)?|handle|handling|wait(?:ing)?|review(?:ing)?|call(?:ing)?|contact(?:ing)?|follow(?:ing)?|send(?:ing)?|surface|surfacing|flag(?:ging)?|track(?:ing)?|replace|replacing|remember(?:ing)?)";

export function normalizeVFirstPerson(text: string): string {
  return text
    .replace(/\b(?:we['’]ll|we will)\s+be in touch\b/gi, "I will get in touch")
    .replace(/\bwe have matched\b/gi, "I have matched")
    .replace(/\bwe have shifts\b/gi, "I have shifts")
    .replace(new RegExp(`\\bV\\s+is\\s+${ACTION_VERBS}\\b`, "gi"), (_match, verb: string) => `I am ${verb}`)
    .replace(/\bV\s+will\s+reach out\b/gi, "I will get in touch")
    .replace(new RegExp(`\\bV\\s+will\\s+${ACTION_VERBS}\\b`, "gi"), (_match, verb: string) => `I will ${verb}`)
    .replace(new RegExp(`\\bV\\s+can\\s+${ACTION_VERBS}\\b`, "gi"), (_match, verb: string) => `I can ${verb}`)
    .replace(new RegExp(`\\bV\\s+has\\s+${ACTION_VERBS}\\b`, "gi"), (_match, verb: string) => `I have ${verb}`)
    .replace(new RegExp(`\\bV\\s+does\\s+${ACTION_VERBS}\\b`, "gi"), (_match, verb: string) => `I ${verb}`)
    .replace(/\bV\s+could not handle\b/gi, "I could not handle")
    .replace(/\bV\s+heard you\b/gi, "I heard you");
}
