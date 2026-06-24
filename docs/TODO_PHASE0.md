# Phase 0 MVP — Engineering Backlog

Maps to the 17 items in `PHASE_0_MUST_HAVE` (`packages/domain/src/phase0.ts`).

Legend: ✅ done · 🔜 in progress · 🔲 todo

**Last reviewed:** 2026-06-23

**Remaining for Phase 0 close-out (4 items):** Guardrails enforcement (2) · WhatsApp channel (2)

**Recent fixes (review follow-up):**
- Mobile swipe deck calls accept/decline API — `apps/mobile/app/index.tsx`
- Worker web preview for browser testing — `apps/worker-web` at http://localhost:6102 (same API flow as mobile; `demo-worker`)
- Offer decline verifies `offer.workerId` — `apps/api/src/routes/workers.ts`
- Seed includes demo-worker coords + verified compliance docs for ranking — `packages/database/prisma/seed.ts`
- API dev loads `.env` automatically — `apps/api/package.json`

**Voice-first UI + shared shell (this iteration):**
- New `@viora/ui` package — V pixel-sphere identity (3D chrome, V↔waveform morph, cobalt accent) + responsive `AppShell` (desktop side-rail / mobile bottom-nav, sphere hero, dot grid, Web/Phone preview toggle); both web apps adopt it. Light/cool-white theme.
- Worker offer endpoint returns a flat UI DTO (role/site/payPerDay/travel/briefing) — `apps/api/src/routes/workers.ts`; demo `BookingRequest`+`Offer` seeded for `demo-worker` so the deck is populated out of the box.
- Worker Passport tab: document/CV upload (base64) + compliance status — `apps/worker-web`; admin verify/reject UI — `apps/admin/src/app/compliance-queue.tsx`.
- Local dev ports pinned (API 6200, web 6100, admin 6101, worker 6102, mobile Metro 8100).

---

## Intake & Booking

- ✅ V natural language intake — `parseIntent`, `clarify`, `confirmIntent` (Anthropic claude-opus-4-8)
- ✅ Intake API route — `POST /v1/intake/parse` (`apps/api/src/routes/intake.ts`)
- ✅ `vAgent` wired into API server — replaced `stubVAgent` in `apps/api/src/index.ts`
- ✅ Persist confirmed intent → `BookingRequest` row in DB — status `pending_confirmation`, returns `bookingRequestId`
- ✅ Load org's `GuardrailPolicy` before calling V; pass constraints into intake context
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

## Worker Feed

- ✅ Replace `stubWorkerContextAgent.surfaceNextOffer()` — query best-ranked open `Offer` for the worker (`packages/agents/src/worker-context-agent.ts`)
- ✅ Replace `stubWorkerContextAgent.explainFit()` — claude-opus-4-8 with adaptive thinking; caches in `offer.fitExplanation` (`packages/agents/src/worker-context-agent.ts`); **not** auto-invoked on `GET /offer` — worker UIs show broadcast template until `explainFit(offerId)` is called
- ✅ Confirm mobile swipe accept/decline writes `Offer.status` to DB end-to-end — `apps/mobile/app/index.tsx` → `POST /v1/workers/:id/offers/:offerId/accept|decline`; accept declines competing offers atomically
- ✅ Worker web preview (browser swipe deck) — `apps/worker-web` at http://localhost:6102; `npm run dev` starts it with api/web/admin; same `demo-worker` offer load + accept/decline API as mobile

## Local dev surfaces (visual testing)

| Surface | URL | Package |
|---------|-----|---------|
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

- 🔲 Enforce `GuardrailPolicy` (autonomyLevel, budgetCeiling, payFloor, approvedRoleTypes) before every autonomous agent action
- 🔲 When `requiresHumanApproval: true`, queue action to admin console rather than auto-proceeding

## Audit Logging

- 🔄 Write `AuditEvent` rows in all agent action paths — covered: intake, compliance upload/verify/reject, offer accept/decline, check-in/out, admin bookings, timesheets, invoice generate; **gaps:** invoice CSV export (`GET /v1/admin/invoices/:id/export`) and `estimateFillProbability()` (updates `BookingRequest` with no audit row)
- ✅ Wire admin audit log panel to live `GET /v1/admin/audit`

## Human Override

- ✅ `POST /v1/admin/bookings/:id/assign` — manually assign worker to a booking
- ✅ `POST /v1/admin/bookings/:id/cancel` and `/reopen`
- ✅ All override actions write `AuditEvent` with `actorType: "admin"`

## Admin Console

- ✅ Wire unfilled shifts panel to live `GET /v1/admin/ops/unfilled` (`packages/agents/src/ops-agent.ts`)
- ✅ Wire market health panel to live `GET /v1/admin/ops/market-health` (`packages/agents/src/ops-agent.ts`)
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

**Prereqs:** `npm run db:migrate && npm run db:seed`, then `npm run dev` (api :6200, employer :6100, admin :6101, worker preview :6102, mobile Metro :8100; API loads `.env`). If port 6200 shows DB disconnected, kill the old API process and restart.
