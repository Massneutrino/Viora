# Phase 0 MVP — Engineering Backlog

Maps to the 17 items in `PHASE_0_MUST_HAVE` (`packages/domain/src/phase0.ts`).

Legend: ✅ done · 🔜 in progress · 🔲 todo

---

## Intake & Booking

- ✅ V natural language intake — `parseIntent`, `clarify`, `confirmIntent` (Anthropic claude-opus-4-8)
- ✅ Intake API route — `POST /v1/intake/parse` (`apps/api/src/routes/intake.ts`)
- ✅ `vAgent` wired into API server — replaced `stubVAgent` in `apps/api/src/index.ts`
- ✅ Persist confirmed intent → `BookingRequest` row in DB — status `pending_confirmation`, returns `bookingRequestId`
- 🔲 Load org's `GuardrailPolicy` before calling V; pass constraints into intake context
- 🔲 Write `Conversation` + `ConversationMessage` rows for each intake exchange

## Compliance Gates

- 🔲 Replace `stubTrustComplianceAgent` with real implementation using `isEligibleForEducationBooking()` against worker's `Passport`
- 🔲 Compliance document upload endpoint — `POST /v1/workers/:id/compliance/documents`
- 🔲 Wire admin compliance queue panel to live `GET /v1/admin/compliance/queue` data

## Candidate Ranking & Offers

- 🔲 Replace `stubMarketAgent.rankCandidates()` — score workers by commute radius, role match, `Passport` status, reliability score
- 🔲 Replace `stubMarketAgent.broadcastOffers()` — write `Offer` rows, notify workers
- 🔲 Replace `stubMarketAgent.estimateFillProbability()` — heuristic: eligible pool size × historical acceptance rate

## Worker Feed

- 🔲 Replace `stubWorkerContextAgent.surfaceNextOffer()` — query best-ranked open `Offer` for the worker
- 🔲 Replace `stubWorkerContextAgent.explainFit()` — Claude-generated explanation from offer + worker profile
- 🔲 Confirm mobile swipe accept/decline writes `Offer.status` to DB end-to-end

## Booking Lifecycle

- 🔲 Replace `stubEmployerContextAgent.processRequest()` — create `Booking` + `Shift` rows from confirmed `BookingRequest`
- 🔲 Worker check-in: validate GPS is within site radius before marking `Shift.checkedInAt`
- 🔲 Worker check-out: compute `hoursWorked`, write `Timesheet` row

## Self-Healing

- 🔲 Replace `stubEmployerContextAgent.triggerReplacement()` — on booking cancellation, rebroadcast to `backupWorkerIds`
- 🔲 Surface replacement alert in employer web dashboard

## Timesheets & Invoices

- 🔲 Timesheet approval endpoint — `POST /v1/timesheets/:id/approve`
- 🔲 Invoice generation — aggregate approved timesheets per org per week → `Invoice` row
- 🔲 Invoice export endpoint — CSV download

## Guardrails

- 🔲 Enforce `GuardrailPolicy` (autonomyLevel, budgetCeiling, payFloor, approvedRoleTypes) before every autonomous agent action
- 🔲 When `requiresHumanApproval: true`, queue action to admin console rather than auto-proceeding

## Audit Logging

- 🔲 Write `AuditEvent` rows in all agent action paths (currently none are written)
- 🔲 Wire admin audit log panel to live `GET /v1/admin/audit`

## Human Override

- 🔲 `POST /v1/admin/bookings/:id/assign` — manually assign worker to a booking
- 🔲 `POST /v1/admin/bookings/:id/cancel` and `/reopen`
- 🔲 All override actions write `AuditEvent` with `actorType: "human"`

## Admin Console

- 🔲 Wire unfilled shifts panel to live `GET /v1/admin/ops/unfilled`
- 🔲 Wire market health panel to live `GET /v1/admin/ops/market-health`

## WhatsApp Channel

- 🔲 WhatsApp Business API webhook receiver
- 🔲 Route WhatsApp messages through V intake pipeline (`channel: "whatsapp"`)
