# Viora Development Guide

AI-native staffing OS for regulated sectors. Phase 0 wedge: UK education (supply teachers, TAs, cover supervisors).

---

## Monorepo Layout

```
apps/
  api/        Fastify REST API — port 6200
  site/       Public website (Next.js) — port 6103
  web/        Employer dashboard (Next.js) — port 6100
  admin/      Ops console (Next.js) — port 6101
  worker-web/ Worker swipe deck preview (Next.js) — port 6102
  mobile/     Worker swipe deck (Expo/React Native) — Metro port 8100
packages/
  domain/     Shared TypeScript types, Phase 0 scope constants, education compliance gates
  database/   Prisma schema + PostgreSQL client singleton
  agents/     Agent interfaces, stubs, and LLM-backed implementations
  ui/         Shared React UI — V pixel-sphere identity, responsive AppShell, settings primitives (SectionCard/EditableField/etc.) (site + web + worker-web + admin)
  tsconfig/   Shared TypeScript configurations
```

---

## Dev Setup

```bash
npm install
npm run dev          # starts dev workspaces via Turbo on pinned ports
```

Voice provider note: server-side V voice lives under `POST /v1/voice/speech` and `POST /v1/voice/transcribe`. `createVoiceClient()` in `packages/agents` owns provider switching, TTS caching, ElevenLabs/OpenAI calls, and server-only credentials. Local dev can leave voice providers disabled; the site and admin fall back to browser speech. TTS cache keys include provider, model, voice, style version, format, and text; bump `VOICE_TTS_STYLE_VERSION` whenever V's locked voice style changes so cached audio regenerates.

Local ports are pinned in workspace scripts:
- API: 6200
- Public site: 6103
- Employer web: 6100
- Admin console: 6101
- Worker web preview: 6102
- Worker mobile Expo/Metro: 8100 (`npm run dev:mobile`)
- Secondary Expo/Metro slot: 8101 (`npm run dev:mobile:secondary`)

**Database**: PostgreSQL running locally (no Docker required for local dev). The `docker-compose.yml` is available if you prefer containers.

- Host: `localhost:5432`, DB: `viora`, user: `viora`, password: `viora`
- Schema managed via Prisma: `npm run db:migrate`
- Seed demo data: `npm run db:seed`
- All Prisma scripts require `--env-file ../../.env` (already scripted in `packages/database/package.json`)

**Demo sandbox**: open the admin console at http://localhost:6101 and use **Dev tools -> Demo sandbox** for deterministic end-to-end runs. The API lives under `/v1/admin/sandbox/*`; reset clears only sandbox-tagged data (`[sandbox:<runId>]`) and keeps seeded avatars available. CLI smoke: `npm run test:phase0` runs the real API in-process and verifies all sandbox scenarios, audit timelines, Dynamic Rate guardrail restore, and worker offer DTOs.

**Memory stack**: structured memories live in `MemoryEntry` / `MemoryEdge`. CRUD is under `/v1/{organisations|workers}/:id/memory`; connector foundation endpoints are `GET /v1/{organisations|workers}/:id/memory/connectors`, `POST /v1/{organisations|workers}/:id/memory/import`, and `GET /v1/{organisations|workers}/:id/memory/export`. Every durable memory records use scopes, sensitivity, source/provenance, visibility, status, edit/delete state, and audit trail. Imported connector memory is review-gated (`pending_confirmation`) and never live bidirectional sync in Phase 0. Worker private memory is profile-only unless the worker explicitly promotes it for operational use. Admin pending review is `GET /v1/admin/memory/pending`. In the admin console use **Dev tools -> Memory lab** to seed/edit demo memories and **Memory review** to confirm inferred/imported entries. Smoke test: `npm run test:memory` runs in-process by default; set `MEMORY_TEST_USE_HTTP=1` to target a separately running API at `API_URL`. Strategy and gap analysis live in [`docs/VIORA_MEMORY_DEEP_DIVE.md`](./docs/VIORA_MEMORY_DEEP_DIVE.md); planned next work is memory evals, impact analytics, typed high-impact memory values, memory influence UX, and CPD memory taxonomy.

**Public site (`apps/site`, http://localhost:6103)**: voice-first hero — heading + animated typewriter subheading, V as the centerpiece, a **Speak with V** CTA that opens an inline voice conversation (speech-to-text + `speechSynthesis`, with typed fallback). It calls `POST /v1/pilot/chat` (consent-gated, audited lead capture; shares `createPilotLead` with `POST /v1/pilot/leads`). Readiness/intent are decided server-side, not by the LLM; the chat turn may include a `remembered` note (Viora Memory). A quick-form modal and `/register` (Sign-in target) also create pilot leads. Requires the API on :6200. Env: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL` (OG metadata).

**Waitlist → access**: pilot leads (from chat, the quick-form modal, or `/register`) land in the admin **Pilot leads** tab (http://localhost:6101). **Approve & mint** calls `POST /v1/admin/pilot/leads/:id/approve`, which upserts the real `Organisation`/`Worker` (deterministic ids, idempotent) and returns a `?orgId=`/`?workerId=` access link into the employer (:6100) / worker (:6102) app. The API builds those links from `WEB_URL` / `WORKER_WEB_URL` (default localhost 6100/6102). Interim demo access until real auth replaces it.

**Environment**: copy `.env.example` → `.env` and fill in:
- `DATABASE_URL` — already set for local dev (postgresql://viora:viora@localhost:5432/viora)
- `JWT_SECRET` — any string for local dev
- `AI_PROVIDER` — `anthropic` (default) or `google`
- `ANTHROPIC_API_KEY` — required when `AI_PROVIDER=anthropic`
- `GOOGLE_API_KEY` — required when `AI_PROVIDER=google`
- `AI_MODEL` — optional global override; when set, all LLM tasks use this model unless a task-specific override below is set
- `AI_MODEL_INTENT` — optional smarter model for `parseIntent`; defaults to `gemini-2.5-pro` for Google or the Anthropic Opus default
- `AI_MODEL_FAST` — optional fast/cheap model for `clarify`, `confirmIntent`, and `explainFit`; defaults to `gemini-2.5-flash` for Google or the Anthropic fast default

> **Always run `npm run dev` from the repo root.** Running `tsx watch src/index.ts` from inside `apps/api` skips the dotenv wrapper and leaves `DATABASE_URL` and the AI key unset. The API will exit immediately with a clear error if any required var is missing.

Current voice output: the public site and admin console call `/v1/voice/speech` first. Browser `speechSynthesis` remains a fallback only when server TTS is disabled or unavailable.

Voice env:
- `VOICE_TTS_PROVIDER` - `disabled` locally, `elevenlabs` for production V voice, or `openai` if using OpenAI TTS
- `ELEVENLABS_API_KEY` / `ELEVENLABS_VOICE_ID` - required when `VOICE_TTS_PROVIDER=elevenlabs`
- `OPENAI_API_KEY` - required for `VOICE_STT_PROVIDER=openai` and for `VOICE_TTS_PROVIDER=openai`
- `VOICE_STT_PROVIDER` - `disabled` locally or `openai` for server-side transcription
- `VOICE_TTS_STYLE_VERSION` - bump this when changing V's locked voice style so cached audio regenerates
- `VIORA_VOICE_CACHE_DIR` - optional local/server TTS cache directory; defaults to the OS temp directory

---

## Coding Conventions

- **TypeScript strict mode** everywhere; no `any` without a comment explaining why
- **ESM modules** — always use `.js` extension in import paths (e.g. `import … from "./types.js"`)
- **Zod** for all API boundary validation in `apps/api/src/routes/`
- **Prisma** for all DB access — no raw SQL
- **No `console.log`** in production paths; use structured logging or omit
- All new packages use `"type": "module"` in `package.json`
- Line endings are normalized by `.gitattributes`: LF for repo text files, CRLF for Windows `.bat`/`.cmd` scripts
- Local agent/editor state is ignored in `.gitignore`; keep shared instructions trackable (`AGENTS.md`, `CLAUDE.md`, `.cursor/rules/`)

---

## Frontend & V Identity

Shared UI lives in `packages/ui` (`@viora/ui`), consumed by `site`, `web`, `worker-web`, and
`admin` via `transpilePackages`. The brand accent is the single `ACCENT` token in `PixelSphere.tsx`
(ultramarine `#1F4DFF`); light theme only.

- **`PixelSphere`** is the V identity. The animated, voice-reactive orb (`size` ~150–172) is the
  hero on the consumer home/landing screens (morphs V↔waveform on listen/speak). For small **logo
  lockups** pass `staticMark` — it renders once (no animation, no specular shine) on a denser grid
  with a deep-engraved V so the mark reads at header sizes. Header lockups are `size={44}` (mobile
  `34`), paired with `<Wordmark />` in a single sphere+wordmark lockup. Don't use a tiny animated
  sphere for a logo — it undersamples and the V disappears.
- **`AppShell`** (consumer apps) and the admin `console-shell.tsx` both use a collapsible left rail:
  a panel-left toggle at the top of the rail expands (labelled) ⇄ collapses (icon-only). Mobile uses
  bottom nav (AppShell) / a top strip (admin); collapse is desktop-only.
- **Favicon**: every app serves a flat ultramarine V at `app/icon.svg` (no tile) — keep the four in
  sync (`apps/{site,web,worker-web,admin}/src/app/icon.svg`).

---

## Agent Rules

The agent layer lives in `packages/agents/`. Key rules:

**Compliance is always deterministic.**
Use `isEligibleForEducationBooking()` from `packages/domain/src/education.ts`. Never ask an LLM to infer or estimate compliance eligibility — the gates are binary and legally required.

**New LLM-backed agents:**
- Import `createLLMClient` from `packages/agents/src/llm.ts`
- Use `.complete({ system, prompt })` for text generation
- Use `.structured<T>({ system, prompt, toolName, toolDescription, schema })` for forced structured output
- Provider (`AI_PROVIDER`) and model (`AI_MODEL`) come from env — never hardcode a model name or import a provider SDK in agent files
- For task-specific routing, pass `createLLMClient({ task: "parseIntent" })` for intake parsing and the matching fast-task names for `clarify`, `confirmIntent`, and `explainFit`
- Keep the stub in `stubs.ts` until the real agent is wired end-to-end and manually tested

**Every agent action must be auditable.**
Write an `AuditEvent` row for every agent decision: `actorType`, `actorId`, `action`, `entityType`, `entityId`, `inputs`, `outputs`, `outcome`. No silent side-effects.

**Memory influence must stay governed.**
Any feature that uses memory for intake, ranking, briefings, explanations, CPD, or worker/employer recommendations must preserve deterministic compliance gates, worker private-memory boundaries, and `memory.influence` auditability. Do not increase memory weight in ranking or add new operational memory categories without fixtures that cover extraction, retrieval, influence, private-memory leakage, and compliance-boundary cases. Planned command name for that future suite: `npm run test:memory:evals` (not implemented yet).

**Guardrail policies are not optional.**
Before any agent takes an autonomous action, fetch the `GuardrailPolicy` for the organisation (or worker) and enforce `autonomyLevel`, `budgetCeiling`, `payFloor`, and `approvedRoleTypes`. If the action exceeds the policy, set `requiresHumanApproval: true` and queue it — never proceed silently.

**Rate modes are explicit.**
Bookings use `rateMode: "standard" | "dynamic"`. Standard Rate broadcasts the fixed `BookingRequest.payRate`. Dynamic Rate is a Phase 1/L3 mode: require `autonomyLevel >= L3`, `BookingRequest.maxPayRate`, and worker `GuardrailPolicy.payFloor`; cap the cleared rate by both booking `maxPayRate` and employer `budgetCeiling`; write a `NegotiationRecord` and `AuditEvent` for every Dynamic Rate offer. Once accepted, `Offer.payRate` is the source of truth for `Booking.payRate`, timesheets, invoices, and payroll exports.

**Phase 0 scope is the source of truth.**
`packages/domain/src/phase0.ts` defines `PHASE_0_MUST_HAVE` (17 items) and `PHASE_0_SUCCESS_METRICS`. Don't build beyond Phase 0 scope without flagging it.

---

## Key Constants

| Constant | Value | Location |
|---|---|---|
| `PHASE_0.defaultAutonomyLevel` | `"l2"` | `packages/domain/src/phase0.ts` |
| `PHASE_0.clusterSize` | 3–10 employers, 50–200 workers | same |
| Intent accuracy target | 95% | `PHASE_0_SUCCESS_METRICS.intentAccuracy` |
| Time-to-fill target | ≤ 12 min | `PHASE_0_SUCCESS_METRICS.medianTimeToFillMinutes` |
| Fill rate target | 90% | `PHASE_0_SUCCESS_METRICS.fillRate` |

---

## WhatsApp Channel

Meta webhook endpoints live at `GET/POST /v1/webhooks/whatsapp`. `GET` verifies the Meta challenge with `WHATSAPP_VERIFY_TOKEN`; `POST` verifies `x-hub-signature-256` using `WHATSAPP_APP_SECRET`, audits message/status events, routes text messages into the V intake pipeline with `channel: "whatsapp"`, and replies through the WhatsApp Business API when `WHATSAPP_API_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` are set. Without send credentials, outbound replies are stubbed and audited for local development.

Phase 0 maps all inbound WhatsApp senders to `WHATSAPP_DEFAULT_ORGANISATION_ID` (use `demo-org` locally). Set `WHATSAPP_API_VERSION` to override the default Meta Graph API version (`v20.0`).

Manual test steps:
1. Start the API with `.env` populated for `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, and `WHATSAPP_DEFAULT_ORGANISATION_ID=demo-org`.
2. In Meta's webhook tester, subscribe the callback URL to `/v1/webhooks/whatsapp`; the `hub.challenge` response should match and write `whatsapp.webhook.verified`.
3. Send a sandbox text message. Confirm `AuditEvent` rows for `whatsapp.message.received`, `intake.parse`, and `whatsapp.outbound.send`, plus `Conversation` / `ConversationMessage` rows with `channel: "whatsapp"`.
4. Repeat the same signed payload with the same WhatsApp `wamid`; it should audit `whatsapp.message.duplicate` and skip intake.
5. Send a status event; it should write `whatsapp.status.received` without creating a new conversation.

## Build & Type-Check

```bash
npm run build        # build all packages and apps
npm run typecheck    # type-check everything via Turbo
npm run lint         # lint all workspaces
npm run test:phase0  # in-process Phase 0 sandbox/API smoke
npm run test:memory  # in-process Memory governance smoke
npm run benchmark:intake -- --limit 10
```

`benchmark:intake` builds the domain/agents packages, loads `.env`, runs sample UK employer
messages through `vAgent.parseIntent`, compares the result to gold JSON, and fails when sample
accuracy is below `PHASE_0_SUCCESS_METRICS.intentCaptureAccuracy` (95%). Use
`--samples path/to/gold.json` to run a replacement JSON sample set.

Build order is dependency-aware via Turbo: `domain` → `database` → `agents` → apps.

---

## Document Maintenance

**Update project docs when making a commit or push — not after every edit.**

Before committing or pushing, check and update:
- `docs/TODO_PHASE0.md` — mark completed items ✅; add any new sub-tasks discovered
- `docs/ROADMAP.md` — update if scope, timeline, or approach changed
- `DEVELOPMENT.md` — update if setup steps, ports, conventions, or env vars changed

This applies to all contributors — human or AI. Tying updates to commits keeps the docs accurate without interrupting flow mid-task.
