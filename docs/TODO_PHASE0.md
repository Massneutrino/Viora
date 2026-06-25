# Phase 0 MVP — Engineering Backlog

Maps to the 17 items in `PHASE_0_MUST_HAVE` (`packages/domain/src/phase0.ts`).

Legend: ✅ done · 🔜 in progress · 🔲 todo

**Last reviewed:** 2026-06-25

**Remaining for Phase 0 close-out (2 items):** WhatsApp channel (2)

**Recent fixes (review follow-up):**
- Dynamic Rate foundation added as a Phase 1/L3 rate mode, not a Phase 0 must-have: `BookingRequest.rateMode`, Standard vs Dynamic intake selection (employer web toggle — `apps/web/src/app/page.tsx`), Dynamic Rate clearing guardrails, `NegotiationRecord` audit trail, worker offer explanation (mobile + worker-web), and admin ops **Dynamic Rate** panel (`GET /v1/admin/negotiations`, `apps/admin/src/app/sections.tsx`). Phase 0 remains Standard Rate by default.
- Public site hero UX — tap the V orb to start voice conversation (no separate nav CTA); education wedge moved to eyebrow pill; audience cards stack vertically on narrow viewports (`apps/site/src/app/{page,v-conversation,globals.css}`).
- Brand lockups — `PixelSphere` `staticMark` for header sizes + unified flat-V `icon.svg` favicons across site/web/worker-web/admin (`packages/ui`, `DEVELOPMENT.md` Frontend section).
- Demo sandbox in admin console - deterministic scenarios for single-loop booking, all-avatar market day, compliance unlock and replacement recovery; API endpoints live under `/v1/admin/sandbox/*` and sandbox data is tagged with `[sandbox:<runId>]`
- Mobile swipe deck calls accept/decline API — `apps/mobile/app/index.tsx`
- Worker web preview for browser testing — `apps/worker-web` at http://localhost:6102 (same API flow as mobile; `demo-worker`)
- Offer decline verifies `offer.workerId` — `apps/api/src/routes/workers.ts`
- Seed includes demo-worker coords + verified compliance docs for ranking — `packages/database/prisma/seed.ts`
- API dev loads `.env` automatically — `apps/api/package.json`

**Voice-first UI + shared shell (this iteration):**
- New `@viora/ui` package — V pixel-sphere identity (3D chrome, V↔waveform morph, cobalt accent) + responsive `AppShell` (desktop side-rail / mobile bottom-nav, sphere hero, dot grid, Web/Phone preview toggle); both web apps adopt it. Light/cool-white theme.
- Worker offer endpoint returns a flat UI DTO (role/site/payPerDay/travel/briefing) — `apps/api/src/routes/workers.ts`; demo `BookingRequest`+`Offer` seeded for `demo-worker` so the deck is populated out of the box.
- Worker Passport tab: document/CV upload (base64) + compliance status — `apps/worker-web`; admin verify/reject UI — `apps/admin/src/app/compliance-queue.tsx`.
- Local dev ports pinned (API 6200, public site 6103, web 6100, admin 6101, worker 6102, mobile Metro 8100).

**Profile, Settings & Account hub (this iteration):**
- Shared settings primitives in `@viora/ui` — `SectionCard`, `SettingRow`, `ToggleRow`, `EditableField`, `ChipsField`, `AccountRow`, `Avatar` (`packages/ui/src/components/Settings.tsx`); reused by both web apps.
- Worker **Profile** tab is now an Account hub (identity header + reliability, editable personal details & work preferences, link to Passport for compliance/docs, notifications, switch-account/sign-out) — `apps/worker-web/src/app/page.tsx`. Compliance stays in the Passport tab (matches `Worker` vs `Passport` data split).
- Employer **Settings** nav item — org profile (editable), sites + team (read-only), automation guardrails (editable), account section — `apps/web/src/app/page.tsx`.
- New endpoints: `GET/PATCH /v1/workers/:id` (profile + worker guardrail), `GET/PATCH /v1/organisations/:id` + `PATCH /v1/organisations/:id/guardrail` (`apps/api/src/routes/workers.ts`, `apps/api/src/routes/organisations.ts`). All PATCHes write `AuditEvent` rows. No schema change — fields already on `Worker`/`Organisation`/`GuardrailPolicy`.
- Identity is resolved via `?workerId=` / `?orgId=` (interim demo bypass; the auth-agent's session/switcher replaces switch-account/sign-out callbacks).

**Conversational marketing site (this iteration):**
- The public site (`apps/site`, port 6103) hero is now a **live V conversation**: tap the V orb to start (voice or typed; Web Speech API with progressive enhancement). V runs a short directed intake (org vs worker → required details → callback/waitlist). Manual capture remains via the quick-form modal / `#book-pilot` fallback.
- New endpoint `POST /v1/pilot/chat` — `createLLMClient().structured()` extracts fields + reply; **readiness/intent are computed deterministically server-side** (never LLM-decided), and a lead is only persisted on `readyToCapture && consent`. Reuses a shared `createPilotLead()` helper with `POST /v1/pilot/leads`; every capture writes an `AuditEvent` (`source: "chat"`). Degrades to the manual form if the LLM is unavailable.
- GDPR: consent gate + `/privacy` notice + footer added; the sphere now drives `WaveState` from the conversation (rest→listening→processing→speaking→confirmed) instead of a blind timer. Removed the demo cards/timeline (and the broken `\2713` checkmark). `apps/site/src/app/{page,layout,v-conversation,privacy/page}.tsx`, `globals.css`, `routes/pilot.ts`.
- ⚠️ **Scope flag:** this is a pilot-acquisition surface, outside the 17 `PHASE_0_MUST_HAVE` items — additive, not a core Phase 0 deliverable.

**Voice-first site + waitlist→approval + Viora Memory (this iteration):**
- Site hero is now **voice-first**: heading + animated typewriter subheading (cycling real asks), V orb as the centerpiece and **tap-to-talk trigger** (speech-to-text in, `speechSynthesis` out, with "Type instead" fallback and typed-mode when `SpeechRecognition` is unavailable). `apps/site/src/app/{page,v-conversation}.tsx`.
- **Quick-form modal** (org/worker toggle) replaces the full-screen dual forms — `apps/site/src/app/quick-form.tsx`; opened from a quiet link / the conversation / the degraded path.
- **Registration → waitlist**: `apps/site/src/app/register/page.tsx` (Sign-in target) posts to `/v1/pilot/leads`.
- **Ops-dash approval mints accounts**: `POST /v1/admin/pilot/leads/:id/approve` (`apps/api/src/routes/admin.ts`) upserts the real `Organisation` (+Site+GuardrailPolicy+EmployerUser) or `Worker` (+Passport+GuardrailPolicy) with deterministic ids (idempotent), flips `PilotLead.status` to `approved`, writes an `AuditEvent`, and returns a `?orgId=`/`?workerId=` access link into the employer/worker app. Approve UI lives in the admin Pilot leads tab (`apps/admin/src/app/{sections,pilot-approve}.tsx`). Interim access until real auth lands.
- **Viora Memory** presented as a shipped capability: interactive "What V remembers" section (`apps/site/src/app/memory-demo.tsx`, mirrors `MemoryEntry` kinds/visibility/source) with view/visibility/forget controls and an explicit "never overrides compliance" guarantee; V also surfaces a "V will remember: …" chip in conversation (optional `remembered` on the chat turn — `apps/api/src/routes/pilot.ts`).
- **Memory stack v0 (backend)**: `MemoryEntry` + `MemoryEdge` schema; `createMemoryAgent()` (`packages/agents/src/memory-agent.ts`) captures inferred signals on intake/booking paths; CRUD at `GET/POST/PATCH/DELETE /v1/{organisations|workers}/:id/memory` with `AuditEvent` rows (`apps/api/src/routes/memory.ts`); admin review at `GET /v1/admin/memory/pending` + `PATCH /v1/admin/memory/:memoryId`.
- **Memory governance v1**: memories now carry use scopes, sensitivity, source labels, expiry/delete metadata and connector provenance; memory retrieval is purpose-bound for intake/ranking/explanations, writes `memory.influence` audit events, and hard-separates worker private profile memory from employer-facing ranking. Connector foundation is review-gated import/export only (`manual_json`, `institutional_kb`, `personal_ai_memory`, `mcp_adapter`) with no live OAuth or bidirectional sync yet.
- **Admin Memory lab + review**: Dev tools → Memory lab (create/edit/forget for demo orgs/workers); Memory review queue for `pending_confirmation` entries — `apps/admin/src/app/{memory-lab,memory-review}.tsx`.
- **Smoke test**: `npm run test:memory` (`scripts/smoke-memory-stack.mjs`).
- Env: API builds access links from `WEB_URL` / `WORKER_WEB_URL` (default localhost 6100/6102).

---

## Intake & Booking

- ✅ V natural language intake — `parseIntent`, `clarify`, `confirmIntent` via `createLLMClient()` (`AI_PROVIDER` / `AI_MODEL` env)
- ✅ Intake API route — `POST /v1/intake/parse` (`apps/api/src/routes/intake.ts`)
- ✅ `vAgent` wired into API server — replaced `stubVAgent` in `apps/api/src/index.ts`
- ✅ Persist confirmed intent → `BookingRequest` row in DB — status `pending_confirmation`, returns `bookingRequestId`
- ✅ Load org's `GuardrailPolicy` before calling V; pass constraints into intake context
- ✅ Employer intake: Standard vs Dynamic `rateMode` toggle on web (`apps/web/src/app/page.tsx`); Dynamic requires `maxPayRate` before confirm (`apps/api/src/routes/intake.ts`)
- ✅ Write `Conversation` + `ConversationMessage` rows for each intake exchange

## Compliance Gates

- ✅ Replace `stubTrustComplianceAgent` with real implementation using `isEligibleForEducationBooking()` against worker's `Passport`
- ✅ Compliance document upload endpoint — `POST /v1/workers/:id/compliance/documents`
- ✅ Wire admin compliance queue panel to live `GET /v1/admin/compliance/queue` data
- ✅ Add admin compliance document review/verify actions — `POST /v1/admin/compliance/documents/:id/verify` and `/reject` (`apps/api/src/routes/compliance.ts`)
- ✅ Admin compliance queue: added interactive Verify / Reject buttons with optimistic UI — `apps/admin/src/app/compliance-queue.tsx` (client component)
- ✅ Worker document upload — `POST /v1/workers/:id/compliance/upload` (base64 JSON, 15 MB limit, local disk storage via `apps/api/src/storage.ts`); `GET /v1/workers/:id/compliance/documents`; `GET .../documents/:docId/file` serve
- ✅ Worker Passport tab — full document upload UI, compliance status grid, document list with download links (`apps/worker-web/src/app/page.tsx`)
- ✅ Added `fileName` + `contentType` columns to `ComplianceDocument` (migration `20260623194430_add_document_filename_contenttype`)
- ✅ Added `DocumentType` union type + `ComplianceDocument` interface to `packages/domain/src/index.ts`

## Candidate Ranking & Offers

- ✅ Replace `stubMarketAgent.rankCandidates()` — score workers by commute radius, role match, `Passport` status, reliability score (`packages/agents/src/market-agent.ts`)
- ✅ Replace `stubMarketAgent.broadcastOffers()` — write `Offer` rows per strategy + autonomy level; `POST /v1/bookings/:id/broadcast` triggers it (`packages/agents/src/market-agent.ts`)
- ✅ Replace `stubMarketAgent.estimateFillProbability()` — heuristic: eligible pool size × historical acceptance rate (`packages/agents/src/market-agent.ts`)
- 🔄 Dynamic Rate foundation — `RateMode` on `BookingRequest`, L3 clearing in Market Agent, `NegotiationRecord` + `dynamic_rate.clear` audit rows, worker rate explanation on offers; Phase 0 remains Standard Rate by default; full rollout waits on generic guardrail approval queue UX.

## Worker Feed

- ✅ Replace `stubWorkerContextAgent.surfaceNextOffer()` — query best-ranked open `Offer` for the worker (`packages/agents/src/worker-context-agent.ts`)
- ✅ Replace `stubWorkerContextAgent.explainFit()` — LLM via `createLLMClient()`; caches in `offer.fitExplanation` (`packages/agents/src/worker-context-agent.ts`); **not** auto-invoked on `GET /offer` — worker UIs show broadcast template until `explainFit(offerId)` is called
- ✅ Confirm mobile swipe accept/decline writes `Offer.status` to DB end-to-end — `apps/mobile/app/index.tsx` → `POST /v1/workers/:id/offers/:offerId/accept|decline`; accept declines competing offers atomically
- ✅ Worker web preview (browser swipe deck) — `apps/worker-web` at http://localhost:6102; `npm run dev` starts it with api/web/admin; same `demo-worker` offer load + accept/decline API as mobile

## Local dev surfaces (visual testing)

| Surface | URL | Package |
|---------|-----|---------|
| Public website | http://localhost:6103 | `@viora/site` |
| Employer (Tell V) | http://localhost:6100 | `@viora/web` |
| Admin console | http://localhost:6101 | `@viora/admin` |
| Worker preview (temp person) | http://localhost:6102 | `@viora/worker-web` |
| API | http://localhost:6200 | `@viora/api` |
| Worker mobile (Expo) | Metro :8100 — Expo Go / simulator | `@viora/mobile` |

**Worker offer flow:** seed worker `demo-worker` → employer intake on :6100 creates `BookingRequest` → broadcast offers (`POST /v1/bookings/:id/broadcast`) → load offer on :6102 or mobile. Without a pending offer, worker UI shows “No pending offers right now.”

**API troubleshooting:** if `GET http://localhost:6200/health/ready` returns `database: disconnected`, a stale API process is running without `.env` — stop it and restart `npm run dev` (or `npm run dev --workspace @viora/api`, which loads `../../.env`).

## Booking Lifecycle

- ✅ Replace `stubEmployerContextAgent.processRequest()` — create `Booking` + `Shift` rows from accepted compliant offer
- ✅ Worker check-in: validate GPS is within site radius (0.5 km) before marking `Shift.checkedInAt`
- ✅ Worker check-out: compute `hoursWorked`, write `Timesheet` row (`POST /v1/workers/:id/shifts/:id/check-out`)

## Self-Healing

- ✅ Replace `stubEmployerContextAgent.triggerReplacement()` — on booking cancellation, rebroadcast to `backupWorkerIds` or fall back to ranked matching (`packages/agents/src/employer-context-agent.ts`)
- ✅ Surface replacement alert in admin dashboard recovery activity — audit filter on `booking.cancel`, `booking.reopen`, `replacement.trigger` (`apps/admin/src/app/page.tsx`)
- 🔲 `monitorBooking()` — still returns stub success; wire real at-risk detection (post-MVP follow-on)

## Timesheets & Invoices

- ✅ Timesheet approval endpoint — `POST /v1/admin/timesheets/:id/approve`
- ✅ Invoice generation — aggregate approved timesheets per org per period → `Invoice` row (`POST /v1/admin/invoices/generate`)
- ✅ Invoice export endpoint — CSV download (`GET /v1/admin/invoices/:id/export`)

## Guardrails

- ✅ Backend guardrail enforcement — shared `evaluateGuardrailAction()` checks `autonomyLevel`, `budgetCeiling`, `payFloor`, and `approvedRoleTypes` before autonomous broadcast, assignment, replacement, and Dynamic Rate clearing.
- ✅ Human approval queue API — `PendingApproval` persists queued actions; `GET /v1/admin/approvals`, `POST /v1/admin/approvals/:id/approve`, and `/reject` are API-only (no admin UI yet). Queued broadcast/assignment/replacement paths write `AuditEvent` rows with `outcome: "queued_for_approval"` and do not mutate booking/offer state before approval.
- 🔄 Dynamic Rate guardrails — Market Agent blocks Dynamic Rate below L3 into the approval queue and hard-blocks missing `maxPayRate`, missing worker pay floors, or floors above the employer ceiling. Full admin UI remains post-MVP polish.

## Audit Logging

- ✅ Write `AuditEvent` rows in all agent action paths — covered: intake (+ `memory.influence`), compliance upload/verify/reject, market rank/broadcast/fill-probability (`ranking.complete`, `offers.broadcast`, `dynamic_rate.clear`, `fill_probability.estimate`), queued/approved/rejected human approvals, offer accept/decline, check-in/out, booking lifecycle, replacement, memory CRUD/import/review, pilot chat/leads + approval mint, sandbox runs, admin bookings/timesheets/invoice generate/export, worker/org profile + guardrail update
- ✅ Wire admin audit log panel to live `GET /v1/admin/audit`

## Human Override

- ✅ `POST /v1/admin/bookings/:id/assign` — manually assign worker to a booking
- ✅ `POST /v1/admin/bookings/:id/cancel` and `/reopen`
- ✅ All override actions write `AuditEvent` with `actorType: "admin"`

## Admin Console

- ✅ Wire unfilled shifts panel to live `GET /v1/admin/ops/unfilled` (`packages/agents/src/ops-agent.ts`)
- ✅ Wire market health panel to live `GET /v1/admin/ops/market-health` (`packages/agents/src/ops-agent.ts`)
- ✅ Demo sandbox panel - run/reset deterministic end-to-end scenarios and inspect timeline, entity counts and avatar coverage (`apps/admin/src/app/sandbox-panel.tsx`, `apps/api/src/routes/sandbox.ts`)
- ✅ Memory lab + review panels — create/edit/forget demo memories and confirm `pending_confirmation` entries (`apps/admin/src/app/{memory-lab,memory-review}.tsx`, `GET /v1/admin/memory/pending`)
- ✅ Pilot leads tab — list waitlist leads and **Approve & mint** into real org/worker accounts (`apps/admin/src/app/pilot-approve.tsx`, `POST /v1/admin/pilot/leads/:id/approve`)
- ✅ Dynamic Rate panel on ops dash — recent `NegotiationRecord` rows with floor/ceiling/rate (`GET /v1/admin/negotiations`, `apps/admin/src/app/sections.tsx`)
- 🔄 Admin mutation UI — compliance verify/reject now interactive (✅); approve timesheets, broadcast, and assign/cancel still API-only (post-MVP polish)

## WhatsApp Channel

- 🔲 WhatsApp Business API webhook receiver
- 🔲 Route WhatsApp messages through V intake pipeline (`channel: "whatsapp"`)

## AI / LLM (post-MVP)

- 🔲 **Per-task model routing** — today `AI_MODEL` is global in `packages/agents/src/llm.ts`. Route `parseIntent` to a smarter model (e.g. Opus / Gemini Pro) and `clarify` / `confirmIntent` / `explainFit` to a fast/cheap tier (Sonnet / Gemini Flash).
- 🔲 **Provider eval on real intake samples** — benchmark ambiguous UK employer messages (dates, roles, sites, pay) across providers; target ≥95% intent accuracy (`PHASE_0_SUCCESS_METRICS`).
- 🔲 **Optional OpenAI provider** — extend `createLLMClient()` if GPT strict-schema / function-calling is needed.
- 🔲 **Gemini schema cleanup** — revisit `toGoogleSchema()` / `additionalProperties` stripping once on structured JSON Schema mode; may improve `requirements` extraction.

**Interim (Phase 0):** `AI_PROVIDER=google`, `AI_MODEL=gemini-2.5-flash` while Google credits are available. Revisit when credits run out or intake accuracy slips.

---

## How to re-run TODO review

Ask in chat: **"Review TODO changes"** — after editing this file or before a commit.

The agent will: diff this file → trace each newly ✅/🔄 item to code → run `npm run typecheck` + `npm run build` → smoke-test the API → return verified / overstated / needs-review / suggested corrections.

**Prereqs:** `npm run db:migrate && npm run db:seed`, then `npm run dev` (api :6200, employer :6100, admin :6101, worker preview :6102, public site :6103, mobile Metro :8100; API loads `.env`). If port 6200 shows DB disconnected, kill the old API process and restart.
