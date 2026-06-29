# Demo Data Reference

Viora ships with a seed script that creates a realistic but minimal demo environment for local development and API testing.

---

## Setup

```bash
# Seed the base fixtures (6 education settings, 6 employers, 15 workers)
npm run db:seed
```

The seed refreshes the canonical demo request (`demo-booking-request`) onto tomorrow's date, recreates its pending Alex offer, upserts worker pay floors used by the Dynamic Rate sandbox scenario, and recreates fixed `demo-fixture-*` operational rows for bookings, offers, shifts, timesheets, invoices and memory. Dates are relative to the seed run so the demo does not go stale.

Employer and worker apps use street/city/postcode for display. Latitude/longitude are still seeded internally for matching, commute estimates and GPS check-in.

---

## Demo access (no passwords)

Phase 0 has **no login credentials** — seed rows store email/name only. Real login UI is being built separately.

**Admin launch panel:** open http://localhost:6101 — the **Demo personas** panel at the top lists all 6 employers and 15 workers. Click **Employer app** or **Worker app** to open that persona in a new tab.

**URL params (bookmarkable):**

| App | URL pattern | Default |
|-----|-------------|---------|
| Employer | `http://localhost:6100?orgId=demo-org-daycare` | `demo-org` |
| Worker | `http://localhost:6102?workerId=demo-worker-6` | `demo-worker` |

Example deep links:

- Day care employer: http://localhost:6100?orgId=demo-org-daycare
- Nursery employer: http://localhost:6100?orgId=demo-org-nursery
- Secondary employer: http://localhost:6100?orgId=demo-org-secondary
- University employer: http://localhost:6100?orgId=demo-org-university
- Early-years worker (Amina): http://localhost:6102?workerId=demo-worker-6
- University invigilator (Elena): http://localhost:6102?workerId=demo-worker-10

**API directory** (for login-picker / persona lists): `GET http://localhost:6200/v1/admin/demo/directory` — **not** `/v1/demo/directory`. Registered via `demoRoutes` under the `/v1/admin` prefix in `apps/api/src/index.ts`.

### Agent coordination (demo identity)

| Owner | Responsibility |
|-------|----------------|
| Demo switcher (shipped) | Admin **Demo personas** panel (`apps/admin/src/app/demo-personas.tsx`); `?orgId=` / `?workerId=` URL params in employer/worker web; `GET /v1/admin/demo/directory` |
| Auth agent | `useIdentity()` hook, login screens, sessions; URL params remain **dev bypass inside the hook** (session wins when logged in) |
| Settings UI agent | Account hub / Settings screens; consumes resolved `orgId`/`workerId` + `onSwitchAccount` / `onSignOut` callbacks — **do not** re-add a second switcher panel or URL parser |

**`useIdentity()` contract (agreed):**

```ts
useIdentity(): {
  workerId?: string
  orgId?: string
  displayName: string
  switchAccount(): void
  signOut(): void
}
```

---

## Fixed IDs

| Entity | ID | Description |
|---|---|---|
| Organisation | `demo-org` | Greenfield MAT (multi-academy trust, primary) |
| Site | `demo-site` | Greenfield Primary, 12 School Lane, London, SW1A 1AA |
| EmployerUser | `demo-employer` | Sarah Johnson, cover manager |
| BookingRequest | `demo-booking-request` | Seeded Greenfield supply teacher shift, refreshed to tomorrow by `npm run db:seed` |

---

## Education settings

| Org ID | Type | Site | Employer |
|---|---|---|---|
| `demo-org` | `mat` | Greenfield Primary | Sarah Johnson (`demo-employer`) |
| `demo-org-daycare` | `daycare` | Little Sprouts — Camden | Emma Walsh (`demo-employer-daycare`) |
| `demo-org-nursery` | `nursery` | Rainbow Nursery — Islington | David Okonkwo (`demo-employer-nursery`) |
| `demo-org-primary` | `primary` | Oakwood Primary | Helen Patel (`demo-employer-primary`) |
| `demo-org-secondary` | `secondary` | Riverside Academy | Marcus Thompson (`demo-employer-secondary`) |
| `demo-org-university` | `university` | Kingsbridge — South Campus | Dr Fiona Nguyen (`demo-employer-university`) |

Each org has its own guardrail policy with role types and budget ceilings tuned to the setting (e.g. day care £120/day for TAs, university £280/day for lecturers/invigilators).

---

Every seeded employer has visible Home, Bookings, Workers, Finance and Settings data in the employer app. Every seeded worker has profile/passport data plus either shift, offer or earnings history in the worker app.

## Workers (15)

| ID | Name | Role types | Best fit for | Reliability | Compliance state |
|---|---|---|---|---|---|
| `demo-worker` | Alex Taylor | `supply_teacher` | Primary / MAT | 4.8 ★ | Fully verified ✅ |
| `demo-worker-2` | Priya Sharma | `supply_teacher` | Primary / MAT | 4.2 ★ | Fully verified ✅ |
| `demo-worker-3` | James Mitchell | `cover_supervisor` | Nursery / secondary | 3.5 ★ | Safeguarding pending ⚠ |
| `demo-worker-4` | Maria Chen | `teaching_assistant` | Primary | 3.9 ★ | Fully verified ✅ |
| `demo-worker-5` | Tom Blake | `supply_teacher` | Any (blocked) | 4.5 ★ | DBS pending ⚠ |
| `demo-worker-6` | Amina Hassan | `teaching_assistant`, `learning_support_assistant` | Day care / nursery | 4.6 ★ | Fully verified ✅ |
| `demo-worker-7` | Oliver Bennett | `learning_support_assistant` | Nursery | 4.0 ★ | Fully verified ✅ |
| `demo-worker-8` | Sophie Williams | `supply_teacher`, `cover_supervisor` | Primary / secondary | 4.9 ★ | Fully verified ✅ |
| `demo-worker-9` | Daniel Okafor | `supply_teacher` | Secondary | 3.2 ★ | Fully verified ✅ |
| `demo-worker-10` | Elena Vasquez | `invigilator`, `learning_support_assistant` | University | 4.3 ★ | Fully verified ✅ |
| `demo-worker-11` | Raj Mehta | `supply_teacher` | Any (blocked) | 4.1 ★ | Right to work pending ⚠ |
| `demo-worker-12` | Grace Murphy | `teaching_assistant` | Day care / nursery | 3.7 ★ | Fully verified ✅ |
| `demo-worker-13` | Kwame Asante | `cover_supervisor`, `invigilator` | Secondary / university | 4.4 ★ | Fully verified ✅ |
| `demo-worker-14` | Yuki Tanaka | `supply_teacher` | Any (blocked) | 3.0 ★ | QTS pending ⚠ |
| `demo-worker-15` | Fatima Al-Rashid | `learning_support_assistant`, `teaching_assistant` | Early years / SEN | 4.7 ★ | Fully verified ✅ |

**For a `supply_teacher` booking at Greenfield Primary:**
- **Eligible and ranked:** Alex (ranked 1st), Priya (ranked 2nd), Sophie, Daniel
- **Excluded by role type:** James, Maria, Amina, Oliver, Elena, Grace, Kwame, Fatima
- **Excluded by compliance:** Tom (DBS), Raj (RTW), Yuki (QTS) — use the compliance verify flow below to unlock

---

## Common Test Flows

All examples use port 6200 and the seeded booking (`demo-booking-request`).

### Voice provider examples

Local development can leave server-side voice disabled:

```env
VOICE_TTS_PROVIDER=disabled
VOICE_STT_PROVIDER=disabled
```

With those defaults, the site/admin still work because the browser falls back to `speechSynthesis`
for V's spoken replies and browser `SpeechRecognition` for speech input.

Enable ElevenLabs for V's production TTS:

```env
VOICE_TTS_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=your_elevenlabs_key
ELEVENLABS_VOICE_ID=your_v_voice_id
ELEVENLABS_MODEL_ID=eleven_flash_v2_5
VOICE_TTS_STYLE_VERSION=v1
```

Enable OpenAI transcription for server-side STT:

```env
VOICE_STT_PROVIDER=openai
OPENAI_API_KEY=your_openai_key
OPENAI_TRANSCRIBE_MODEL=whisper-1
```

Generate a V speech sample:

```bash
curl -s -X POST http://localhost:6200/v1/voice/speech \
  -H "Content-Type: application/json" \
  -d '{"text":"Got it. I will look for an eligible cover supervisor for Greenfield tomorrow morning.","purpose":"reply"}' \
  --output viora-v-sample.mp3
```

The route writes `voice.speech.generate` audit events. Repeating the same text with the same
provider/model/voice/style version returns cached audio.

Transcribe a local browser recording or voice note:

```bash
curl -s -X POST http://localhost:6200/v1/voice/transcribe \
  -H "Content-Type: audio/webm" \
  -H "X-Viora-Language: en" \
  -H "X-Viora-Filename: request.webm" \
  --data-binary "@request.webm"
```

Example Viora conversation:

```text
Employer: Hi V, I need a cover supervisor tomorrow morning in Manchester.
V: Got it. Which school or organisation should I attach this request to?
Employer: Greenfield Academy.
V: Thanks. What time does the shift start and finish?
Employer: 8:30 to 3:30.
V: Perfect. I will look for an eligible cover supervisor for Greenfield Academy tomorrow, 8:30 to 3:30, and only surface workers who pass the required checks.
Employer: Can you send me options?
V: Yes. I will prepare matched candidates and flag anything that needs human approval before booking.
```

### 0. Demo sandbox

The admin console includes a deterministic sandbox for demos and local testing:

- Open http://localhost:6101 and use **Dev tools -> Demo sandbox**.
- `GET http://localhost:6200/v1/admin/sandbox/scenarios` lists available scenarios and avatar coverage.
- `POST http://localhost:6200/v1/admin/sandbox/reset` clears only sandbox-created requests, offers, bookings, shifts, timesheets, invoices, conversations and related audit events. Seeded employers, workers, passports and guardrails are preserved.
- `POST http://localhost:6200/v1/admin/sandbox/scenarios/single-cover-loop/run` runs the Greenfield request -> offer -> accept -> booking -> shift -> timesheet -> invoice loop.
- Other scenario IDs: `all-avatars-market-day`, `compliance-block-unlock`, `replacement-recovery`, `dynamic-rate-clearing`.

Sandbox booking requests are tagged in `BookingRequest.rawIntent` with `[sandbox:<runId>]`, and the run timeline is stored as `AuditEvent` rows with `entityType = SandboxRun`.

### 0a. Ephemeral sandbox regression harness

Use the CLI harness when you want a clean sandbox rooted in the current checkout rather than the shared local demo database:

```bash
# Fast disposable DB check: migrations + seed + report
npm run test:sandbox -- --loops 0 --skip-baseline --seed 999

# Full deterministic Phase 0 sandbox smoke in a disposable DB
npm run test:sandbox:baseline

# Live generated employer/V/worker loops; requires working AI provider/network access
npm run test:sandbox:live
```

The harness creates `viora_sandbox_<seed>_<pid>`, applies Prisma migrations, seeds the latest demo avatars, runs the existing Phase 0 sandbox smoke unless `--skip-baseline` is passed, then runs generated employer/V/worker loops through live API routes. By default, generated employer requests are deterministic templates and V still parses them through the live LLM-backed intake path.

Useful options:

- `--loops <n>` controls generated loop count.
- `--seed <number>` makes generated choices reproducible.
- `--avatar-mode deterministic|llm` switches employer request generation; `llm` requires live AI access before V intake also runs.
- `--report path/to/report.json` writes the structured pass/fail report.
- `--keep-db` keeps the ephemeral database for inspection instead of dropping it.

On failure, the harness always writes a structured JSON report. If `--report` is not provided, the default filename is `sandbox-regression-failure-<seed>-<pid>.json` and is ignored by git.

### 1. Rank candidates and broadcast offers
```bash
# Rank eligible workers for the smoke booking
curl -s -X POST http://localhost:6200/v1/bookings/demo-booking-request/broadcast \
  -H "Content-Type: application/json" \
  -d '{"strategy":"simultaneous_top_n","autonomyLevel":"L2"}'
```
Offers go to Alex and Priya. Tom is blocked; James and Maria are excluded by role type.

### 1a. Dynamic Rate sandbox
```bash
curl -s -X POST http://localhost:6200/v1/admin/sandbox/scenarios/dynamic-rate-clearing/run \
  -H "Content-Type: application/json" \
  -d '{}'
```
This keeps the main Greenfield flow on Standard Rate, but runs a dedicated L3 Dynamic Rate scenario. It creates a dynamic request with a GBP 145 starting rate and GBP 170 ceiling, clears seeded worker pay floors, writes `NegotiationRecord` rows, and restores Greenfield's L2 guardrail afterwards.

### 2. Worker swipe deck
```bash
# Alex's next pending offer
curl http://localhost:6200/v1/workers/demo-worker/offer
```

### 3. Accept an offer (worker flow)
```bash
# Replace OFFER_ID with the id returned above
curl -s -X POST http://localhost:6200/v1/workers/demo-worker/offers/OFFER_ID/accept
```
Creates a Booking + Shift. Returns the booking.

### 4. GPS check-in
```bash
curl -s -X POST http://localhost:6200/v1/workers/demo-worker/shifts/SHIFT_ID/check-in \
  -H "Content-Type: application/json" \
  -d '{"latitude":51.508,"longitude":-0.128}'
```

### 5. Check-out (creates Timesheet)
```bash
curl -s -X POST http://localhost:6200/v1/workers/demo-worker/shifts/SHIFT_ID/check-out
```

### 6. Admin: approve timesheet
```bash
curl -s -X POST http://localhost:6200/v1/admin/timesheets/TIMESHEET_ID/approve \
  -H "Content-Type: application/json" \
  -d '{"approvedBy":"demo-employer"}'
```

### 7. Admin: generate invoice
```bash
curl -s -X POST http://localhost:6200/v1/admin/invoices/generate \
  -H "Content-Type: application/json" \
  -d '{
    "organisationId": "demo-org",
    "periodStart": "2025-01-01T00:00:00.000Z",
    "periodEnd": "2027-12-31T23:59:59.000Z"
  }'
```

### 8. Unlock Tom Blake (compliance verify flow)
```bash
# Find Tom's pending DBS document
curl http://localhost:6200/v1/admin/compliance/queue

# Verify it (replace DOC_ID with Tom's enhanced_dbs document id)
curl -s -X POST http://localhost:6200/v1/admin/compliance/documents/DOC_ID/verify \
  -H "Content-Type: application/json" \
  -d '{"adminId":"demo-employer"}'

# Re-broadcast — Tom now appears in the eligible pool
curl -s -X POST http://localhost:6200/v1/bookings/demo-booking-request/broadcast \
  -H "Content-Type: application/json" \
  -d '{"strategy":"simultaneous_top_n","autonomyLevel":"L2"}'
```

### 9. View audit trail
```bash
curl http://localhost:6200/v1/admin/audit
```

### 10. Pilot waitlist → approve & mint

Public site (http://localhost:6103) captures leads via `POST /v1/pilot/chat` or `POST /v1/pilot/leads`. In the admin console **Pilot leads** tab, **Approve & mint** calls:

```bash
curl -s -X POST http://localhost:6200/v1/admin/pilot/leads/LEAD_ID/approve \
  -H "Content-Type: application/json" \
  -d '{"adminId":"demo-admin"}'
```

Returns a `?orgId=` or `?workerId=` access link into the employer (:6100) or worker (:6102) app.

### 11. Memory stack

List memories for the demo org:

```bash
curl http://localhost:6200/v1/organisations/greenfield-mat/memory
```

Create a user-entered memory:

```bash
curl -s -X POST http://localhost:6200/v1/organisations/greenfield-mat/memory \
  -H "Content-Type: application/json" \
  -d '{"kind":"instruction","title":"Gate code","content":"Use side entrance — code 4821","visibility":"operational"}'
```

Admin pending review queue:

```bash
curl http://localhost:6200/v1/admin/memory/pending
```

Full smoke test: `npm run test:memory` (from repo root, API on :6200).

---

## Guardrail Policy (Greenfield MAT)

| Setting | Value |
|---|---|
| Autonomy level | L2 (auto-broadcast, no human approval required) |
| Budget ceiling | £200/day |
| Approved role types | supply_teacher, cover_supervisor, teaching_assistant, learning_support_assistant, invigilator |
| Max commute | not set |
