# Phase 0 MVP — Engineering Backlog

Maps to the 20 items in `PHASE_0_MUST_HAVE` (`packages/domain/src/phase0.ts`).

Legend: ✅ done · 🔜 in progress · 🔲 todo

**Last reviewed:** 2026-06-30

**Marketing go-live quick wins (2026-06-30):**
- Lead form consent aligned with V chat — explicit checkbox on quick-form modal and `/register`; `POST /v1/pilot/leads` requires `consent: true` (`apps/site/src/app/lead-form.tsx`, `apps/api/src/routes/pilot.ts`).
- Open Graph preview image — `apps/site/src/app/opengraph-image.tsx` (generated 1200×630 card).
- Production env documented — `NEXT_PUBLIC_SITE_URL`, `WEB_URL`, `WORKER_WEB_URL`, `TRUST_PROXY`, `RATE_LIMIT_*` in `.env.example` and `DEVELOPMENT.md`.
- Public-route rate limits — `@fastify/rate-limit` on pilot chat/leads and voice speech/transcribe POST routes only (production, per-IP; `/voice/status` excluded); UX-safe defaults 30/10/60/60 per minute (`apps/api/src/rate-limit.ts`).
- Chat 429 UX — throttled responses show retry copy without auto-opening the quick form (`apps/site/src/app/v-conversation.tsx`).

**Phase 0 close-out:** Engineering close-out is complete for the core loop, guardrails, monitoring, schedule APIs, and the worker/employer schedule **UI** (worker `Schedule` tab and employer Bookings `List | Schedule` view). External Google/Outlook/iCal sync remains Phase 1.

**Recent fixes (review follow-up):**
- Phase 0 engineering close-out: `monitorBooking()` now marks bookings `at_risk` when a shift is within 4h or overdue without check-in (`packages/agents/src/employer-context-agent.ts`), exposed at `POST /v1/admin/bookings/:id/monitor` with admin **Monitor** action in `bookings-ops.tsx`, and covered by `npm run test:phase0` (`booking.monitor` audit + L1 approvals queue → approve → broadcast).
- Human approval queue admin UI confirmed shipped — `apps/admin/src/app/approvals-queue.tsx` on the Ops tab (approve/reject + refresh); backlog entry corrected from stale "API-only".
- Phase 0 schedule foundation added: shared schedule DTOs/helpers in `packages/domain/src/schedule.ts`, first-class worker availability blocks/patterns in Prisma, audited schedule/availability API routes under `/v1/workers/:id/schedule`, `/v1/organisations/:id/schedule`, and `/v1/workers/:id/availability/*`, seeded demo availability, hourly `granularity=hour` buckets, and `npm run test:phase0` smoke assertions.
- Phase 0 schedule **UI** shipped: worker `Schedule` tab (week strip + selected-day agenda, Day | Hour toggle, mark-unavailable block CRUD, weekly availability pattern editor, pending offers deep-link back to the deck) and employer Bookings `List | Schedule` coverage view (coverage by day/site, open vs confirmed, coverage donut, site filter chips). Shared audience-neutral widgets live in `@viora/ui` (`packages/ui/src/components/schedule/`); the employer view never renders worker availability (enforced by the org schedule API).
- V Workflows milestone added as an admin-only, code-defined playbook viewer/simulator: shared workflow registry and validator in `packages/domain/src/workflows.ts`, read-only admin endpoints under `/v1/admin/v-workflows`, deterministic simulation with a single `workflow.simulate` audit event, Admin **V Workflows** tab with lightweight SVG/HTML graph rendering, and `npm run test:workflows` coverage. Live runtime orchestration remains unchanged.
- MCP architecture decision documented: MCP is not a Phase 0 core architecture dependency; future MCP belongs behind a separate, permissioned edge gateway that delegates to existing API/agent/domain services and preserves audit, guardrail, compliance, and memory privacy boundaries.
- Phase 0 close-out hardening completed: added `npm run test:phase0` (`scripts/smoke-phase0.mjs`) to run the API in-process and verify health, demo directory, all five sandbox scenarios, Dynamic Rate guardrail restore, worker offer DTOs, negotiations, and audit visibility.
- Memory smoke is now repeatable without a separately running API: `npm run test:memory` runs the real Fastify app in-process by default; set `MEMORY_TEST_USE_HTTP=1` to target `API_URL`.
- Intake benchmark hardening: `vAgent.parseIntent()` now deterministically defaults Standard Rate, preserves lightweight requirements keywords, resolves named sites from the provided site list, normalizes Dynamic Rate "up to" ceilings, and applies guardrail-driven missing fields before returning.
- Close-out verification passed: `npm run typecheck`, `npm run build`, `npm run test:phase0`, `npm run test:memory`, and `npm run benchmark:intake -- --limit 10` (100% sample accuracy on the 10-sample fixture).
- Railway API deploy hardening: `railway.toml` now builds from the repo root with `turbo --force`, verifies `apps/api/dist/index.js` exists before deploy, and starts the API via the `@viora/api` workspace after running Prisma deploy migrations. `docs/deploy.md` covers config-as-code edits and `MODULE_NOT_FOUND` troubleshooting.
- Server-side V voice provider layer added: `/v1/voice/speech` for cached TTS, `/v1/voice/transcribe` for raw-audio STT, `createVoiceClient()` provider switching, ElevenLabs/OpenAI TTS, OpenAI/Azure STT env config, audit events, and browser fallback across site/web/worker/admin voice surfaces.
- Shared V speech output shipped across public site, employer web, worker web and admin console via `@viora/ui` (`playVSpeech`/`cancelVSpeech`): user-triggered V replies call `/v1/voice/speech` with browser speech fallback, and TTS cache identity is purpose-scoped.
- Dynamic Rate demo support added as a dedicated sandbox scenario (`dynamic-rate-clearing`) with seeded worker pay floors and guardrail restore; Standard Rate remains the default Greenfield demo path.
- Seed refreshes the canonical `demo-booking-request` onto a future date, recreates the pending seeded offer, and upserts Dynamic Rate worker pay floors so demo data does not go stale.
- Demo operational fixture pack added: `npm run db:seed` now recreates fixed `demo-fixture-*` bookings, offers, shifts, timesheets, invoices and memory so every employer/worker navigation tab has realistic data.
- Worker and site locations now display as street/city/postcode in the apps while retaining latitude/longitude internally for matching, commute estimates and check-in validation.
- Dynamic Rate foundation added as a Phase 1/L3 rate mode, not a Phase 0 must-have: `BookingRequest.rateMode`, Standard vs Dynamic intake selection (employer web toggle — `apps/web/src/app/page.tsx`), Dynamic Rate clearing guardrails, `NegotiationRecord` audit trail, worker offer explanation (mobile + worker-web), and admin ops **Dynamic Rate** panel (`GET /v1/admin/negotiations`, `apps/admin/src/app/sections.tsx`). Phase 0 remains Standard Rate by default.
- Public site hero UX — tap the V orb to start voice conversation (no separate nav CTA); education wedge moved to eyebrow pill; audience cards stack vertically on narrow viewports (`apps/site/src/app/{page,v-conversation,globals.css}`).
- Brand lockups — `PixelSphere` `staticMark` for header sizes + unified flat-V `icon.svg` favicons across site/web/worker-web/admin (`packages/ui`, `DEVELOPMENT.md` Frontend section).
- Demo sandbox in admin console - deterministic scenarios for single-loop booking, all-avatar market day, compliance unlock, replacement recovery and Dynamic Rate clearing; API endpoints live under `/v1/admin/sandbox/*` and sandbox data is tagged with `[sandbox:<runId>]`
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
- Site hero is now **voice-first**: heading + animated typewriter subheading (cycling real asks), V orb as the centerpiece and **tap-to-talk trigger**. Speech input now records audio through shared `@viora/ui` capture and calls `/v1/voice/transcribe` first, with browser `SpeechRecognition` only as fallback; V speech output calls `/v1/voice/speech` and falls back to `speechSynthesis` when server TTS is disabled/unavailable. `apps/site/src/app/{page,v-conversation,voice-audio}.tsx`.
- **Quick-form modal** (org/worker toggle) replaces the full-screen dual forms — `apps/site/src/app/quick-form.tsx`; opened from a quiet link / the conversation / the degraded path.
- **Registration → waitlist**: `apps/site/src/app/register/page.tsx` (Sign-in target) posts to `/v1/pilot/leads`.
- **Ops-dash approval mints accounts**: `POST /v1/admin/pilot/leads/:id/approve` (`apps/api/src/routes/admin.ts`) upserts the real `Organisation` (+Site+GuardrailPolicy+EmployerUser) or `Worker` (+Passport+GuardrailPolicy) with deterministic ids (idempotent), flips `PilotLead.status` to `approved`, writes an `AuditEvent`, and returns a `?orgId=`/`?workerId=` access link into the employer/worker app. Approve UI lives in the admin Pilot leads tab (`apps/admin/src/app/{sections,pilot-approve}.tsx`). Interim access until real auth lands.
- **Viora Memory** presented as a shipped capability: interactive "What V remembers" section (`apps/site/src/app/memory-demo.tsx`, mirrors `MemoryEntry` kinds/visibility/source) with view/visibility/forget controls and an explicit "never overrides compliance" guarantee; V also surfaces a "V will remember: …" chip in conversation (optional `remembered` on the chat turn — `apps/api/src/routes/pilot.ts`).
- **Memory stack v0 (backend)**: `MemoryEntry` + `MemoryEdge` schema; `createMemoryAgent()` (`packages/agents/src/memory-agent.ts`) captures inferred signals on intake/booking paths; CRUD at `GET/POST/PATCH/DELETE /v1/{organisations|workers}/:id/memory` with `AuditEvent` rows (`apps/api/src/routes/memory.ts`); admin review at `GET /v1/admin/memory/pending` + `PATCH /v1/admin/memory/:memoryId`.
- **Memory governance v1**: memories now carry use scopes, sensitivity, source labels, expiry/delete metadata and connector provenance; memory retrieval is purpose-bound for intake/ranking/explanations, writes `memory.influence` audit events, and hard-separates worker private profile memory from employer-facing ranking. Connector foundation is review-gated import/export only (`manual_json`, `institutional_kb`, `personal_ai_memory`, `mcp_adapter`) with no live OAuth or bidirectional sync yet.
- **Admin Memory lab + review**: Dev tools → Memory lab (create/edit/forget for demo orgs/workers); Memory review queue for `pending_confirmation` entries — `apps/admin/src/app/{memory-lab,memory-review}.tsx`.
- **Smoke test**: `npm run test:memory` (`scripts/smoke-memory-stack.mjs`).
- Env: API builds access links from `WEB_URL` / `WORKER_WEB_URL` (default localhost 6100/6102).

**Post-MVP Memory Intelligence (Phase 0-1 enablement):**
- ✅ Memory eval fixtures — `npm run test:memory:evals` runs deterministic fixture coverage for extraction-spec shape, retrieval, influence auditability, private-memory leakage, stale-memory exclusion and compliance-boundary ranking. Set `MEMORY_EVAL_RUN_LLM=1` to opt into live LLM extraction checks.
- ✅ Memory impact analytics — `GET /v1/admin/ops/memory-impact` and the admin Overview panel report `memory.influence` volume, intake clarification/confirmation mix, influenced offer acceptance, bookings created, top used memories/edges, unused active memory kinds, and worker-private leakage sentinel counts.
- ✅ Typed memory value conventions — `packages/domain/src/memory-values.ts` defines and validates `MemoryEntry.value.valueType` shapes for site instructions, worker availability, commute preference, pay expectation, role confidence, briefing notes, preferred/blocked workers, and CPD/training signals. CRUD/import rejects malformed declared typed values; inference skips invalid typed candidates; `npm run test:memory:evals` covers valid/invalid fixtures and API validation.
- ✅ Memory influence UX — worker offer DTOs now include audience-safe `memoryReasons` rendered in worker web/mobile under "Why V chose this"; employer-facing `/v1/bookings/:id/matches` includes filtered `memoryReasons` from the latest `memory.influence` audit. Private worker memory is re-fetched and filtered before employer DTOs; `npm run test:memory:evals` covers employer no-leak and worker-own-private explanation cases.
- ✅ CPD memory taxonomy — `cpd_training_signal` now has typed signal categories for skill interest, confidence gap, completed CPD, required induction, expiring training, employer-requested training and training impact evidence. Domain validation enforces required taxonomy fields; evals cover valid/invalid CPD values, ranking-eligible positive CPD evidence, worker-private CPD gap boundaries, and compliance override protection.
- ✅ Episodic / temporal Fit Graph groundwork — added `MemoryEpisode` as a learning projection and temporal/evidence metadata on `MemoryEdge` (`validFrom`, `validUntil`, `lastEvidenceAt`, `decayPolicy`, `supersededByEdgeId`, `evidenceRefs`). Offer/shift memory learning now writes episodes and stamps edge evidence without changing ranking weights; evals cover episode creation, repeated evidence metadata, and compliance boundaries.
- ✅ Temporal Fit Graph scoring v1 — ranking now scores active operational/shared `MemoryEdge` evidence with bounded temporal scoring (`weight`, `confidence`, evidence count, recency, expiry/supersession and decay policy) while keeping memory's overall ranking weight unchanged. `memory.influence` audits include temporal score components and exclusion reasons; evals cover recent/stale/expired/superseded/negative evidence plus compliance and privacy boundaries.
- ✅ Memory Controls / Review UX v1 — employer and worker apps expose richer "What V remembers" controls with governance metadata, confirm/archive/edit/delete actions, worker private-to-operational promotion, and source/typed/expiry context. Admin Memory review now includes episode, edge and temporal influence evidence; seeded demo data includes active, private, CPD and pending connector memory fixtures.
- ✅ Memory consolidation v1 — `MemoryReviewSuggestion` stores review-gated archive, merge, supersede, contradiction and confirm-pattern suggestions. Admin Memory review exposes consolidation actions via `GET /v1/admin/memory/consolidation` plus apply/reject routes; applying suggestions archives stale memories, merges duplicates, supersedes weak edges, or creates pending-confirmation pattern memories. Evals and smoke coverage verify no automatic operational mutation happens without review.
- ✅ Reviewed procedural learning v1 — repeated intake clarification patterns can propose `procedural_playbook` memories through the existing admin review queue. Approved playbooks are active organisation `pattern` memories scoped to `intake_default`/`explanation` only, with explicit no-ranking/no-compliance guardrails; rejected suggestions create no memory.
- ✅ Post-shift learning loops v1 — worker/employer feedback endpoints write `Feedback`, audit rows and memory episodes. Repeated non-contested feedback can propose reviewed briefing notes or fit-feedback memories; briefing notes become active only after admin apply, while fit feedback remains `pending_confirmation` so ranking-affecting learning stays review-gated.
- ✅ Retrieval thresholds / weak-memory fallback v1 — purpose-scoped memory retrieval now gates entries and edges with deterministic confidence/temporal thresholds. Weak intake defaults are excluded so V asks instead of assuming, weak ranking signals do not affect the existing bounded memory score, and `memory.influence` audits include included/excluded memory and edge reasons.

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

## Schedule

- ✅ Worker schedule API — `GET /v1/workers/:id/schedule?from=&to=&granularity=day|hour` merges confirmed shifts, pending offers and the worker's own unavailable blocks into a shared `ScheduleEvent` contract.
- ✅ Employer schedule API — `GET /v1/organisations/:id/schedule?from=&to=&siteId=&granularity=day|hour` returns filled shifts and open cover without exposing worker private availability.
- ✅ Worker availability management API — pattern read/update plus audited create/edit/delete for unavailable blocks under `/v1/workers/:id/availability`.
- ✅ Hourly timeframe support — schedule routes accept exact ISO datetimes and return hour buckets when `granularity=hour`; filtering uses overlap logic (`startAt < to && endAt > from`).
- ✅ Seed + smoke coverage — seeded `demo-worker` availability blocks/pattern and `npm run test:phase0` assertions for worker schedule, employer schedule, hourly buckets, and availability audit events.
- ✅ Worker UI schedule tab — `Schedule` tab in worker-web: week strip + selected-day agenda (confirmed shifts, pending offers, unavailable blocks), Day | Hour toggle, mark-unavailable block CRUD, and a weekly availability pattern editor; pending offers jump back into the deck/offer flow.
- ✅ Employer UI schedule view — Bookings `List | Schedule` toggle in `apps/web`: coverage-by-day/site dashboard (open cover vs confirmed, coverage donut, site filter chips, Day | Hour toggle); reuses shared `@viora/ui` widgets and never renders worker availability.

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
- ✅ `monitorBooking()` — deterministic at-risk detection when a confirmed shift is within 4h or overdue without check-in; writes `booking.monitor` audit rows; admin route `POST /v1/admin/bookings/:id/monitor` and Ops **Monitor** button (`packages/agents/src/employer-context-agent.ts`, `apps/api/src/routes/admin.ts`, `apps/admin/src/app/bookings-ops.tsx`)

## Timesheets & Invoices

- ✅ Timesheet approval endpoint — `POST /v1/admin/timesheets/:id/approve`
- ✅ Invoice generation — aggregate approved timesheets per org per period → `Invoice` row (`POST /v1/admin/invoices/generate`)
- ✅ Invoice export endpoint — CSV download (`GET /v1/admin/invoices/:id/export`)

## Guardrails

- ✅ Backend guardrail enforcement — shared `evaluateGuardrailAction()` checks `autonomyLevel`, `budgetCeiling`, `payFloor`, and `approvedRoleTypes` before autonomous broadcast, assignment, replacement, and Dynamic Rate clearing.
- ✅ Human approval queue API + admin UI — `PendingApproval` persists queued actions; `GET /v1/admin/approvals`, `POST /v1/admin/approvals/:id/approve`, and `/reject`; Ops tab **Approvals** panel with approve/reject (`apps/admin/src/app/approvals-queue.tsx`). Queued broadcast/assignment/replacement paths write `AuditEvent` rows with `outcome: "queued_for_approval"` and do not mutate booking/offer state before approval. `npm run test:phase0` covers L1 broadcast queue → approve → offer creation.
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
- ✅ Admin mutation UI — compliance verify/reject, timesheet approve, booking broadcast/assign/cancel/reopen/monitor (`apps/admin/src/app/{compliance-queue,timesheets-queue,bookings-ops}.tsx`, `GET /v1/admin/timesheets/pending`, `GET /v1/admin/bookings/ops`)

## WhatsApp Channel

- ✅ WhatsApp Business API webhook receiver — `GET/POST /v1/webhooks/whatsapp` verifies Meta challenge/signature, audits message/status events, and handles duplicate/non-text messages.
- ✅ Route WhatsApp messages through V intake pipeline (`channel: "whatsapp"`) — inbound text maps to `WHATSAPP_DEFAULT_ORGANISATION_ID` (`demo-org` locally), persists `Conversation` / `ConversationMessage`, and sends or stubs outbound WhatsApp replies.

## AI / LLM (post-MVP)

- ✅ **Per-task model routing** — `createLLMClient({ task })` now routes `parseIntent` to the smart tier (`AI_MODEL_INTENT`, default Google Pro / Anthropic Opus) and `clarify` / `confirmIntent` / `explainFit` to the fast tier (`AI_MODEL_FAST`, default Google Flash / Anthropic fast default). Plain `AI_MODEL` remains a global backward-compatible override.
- ✅ **Voice provider separation** — `AI_PROVIDER` / `AI_MODEL*` generate V's text only; `VOICE_STT_PROVIDER` hears the user through OpenAI Whisper, Azure Speech, or Gemini audio, and `VOICE_TTS_PROVIDER` speaks V through ElevenLabs/OpenAI TTS.
- ✅ **Provider eval on real intake samples** — `npm run benchmark:intake -- --limit 10` builds domain/agents, runs UK employer sample messages through `parseIntent`, compares to gold JSON, and checks the 95% `PHASE_0_SUCCESS_METRICS.intentCaptureAccuracy` target. Use `--samples path/to/gold.json` for larger real-world sets.
- 🔲 **Optional OpenAI provider** — extend `createLLMClient()` if GPT strict-schema / function-calling is needed.
- 🔲 **Gemini schema cleanup** — revisit `toGoogleSchema()` / `additionalProperties` stripping once on structured JSON Schema mode; may improve `requirements` extraction.

**Interim (Phase 0):** use `AI_MODEL_INTENT` for accuracy-sensitive intake parsing and `AI_MODEL_FAST` for lower-latency prose tasks; leave `AI_MODEL` unset unless you intentionally want one global model for every LLM call.

## Parked / post-close-out

- ✅ **Schedule UI** — worker Schedule tab + employer Bookings `List | Schedule` view shipped; shared widgets in `@viora/ui` (`packages/ui/src/components/schedule/`). Schedule/availability APIs and smoke coverage were already shipped.
- 🔲 **Calendar OAuth / iCal sync** — Phase 1 (Google Calendar, Outlook); subscribe export builds on the existing `ScheduleEvent` mapper.
- 🔲 **Optional LLM providers** — OpenAI provider extension; Gemini structured-schema cleanup.

## Pilot go-live checklist (operational)

| Metric | Target | How to measure |
|--------|--------|----------------|
| Conversational intake | ≥70% | `BookingRequest.channel` / `Conversation` rows |
| Intent accuracy | ≥95% | `npm run benchmark:intake` on pilot sample set |
| Median time-to-fill | ≤12 min | `BookingRequest.createdAt` → `Booking.createdAt` |
| Fill rate | ≥90% | Filled vs total requests in cluster window |
| Compliance errors | 0 | No ineligible worker on `Booking` (deterministic gate) |

Pilot parameters: 3–10 schools, 50–200 workers, manual compliance queue, export-only payroll — per `packages/domain/src/phase0.ts`.

---

## How to re-run TODO review

Ask in chat: **"Review TODO changes"** — after editing this file or before a commit.

The agent will: diff this file → trace each newly ✅/🔄 item to code → run `npm run typecheck` + `npm run build` → smoke-test the API → return verified / overstated / needs-review / suggested corrections.

**Prereqs:** `npm run db:migrate && npm run db:seed`, then `npm run dev` (api :6200, employer :6100, admin :6101, worker preview :6102, public site :6103, mobile Metro :8100; API loads `.env`). If port 6200 shows DB disconnected, kill the old API process and restart.
