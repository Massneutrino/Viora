# Demo Data Reference

Viora ships with a seed script that creates a realistic but minimal demo environment for local development and API testing.

---

## Setup

```bash
# 1. Seed the base fixtures (org, site, employer, 5 workers)
npm run db:seed

# 2. Create a smoke-test booking and wire up Alex's position
cd packages/database
node prisma/smoke-setup.mjs
```

After both commands you have a complete booking request (`smoke-br-1`) with workers ranked and ready to receive offers.

---

## Fixed IDs

| Entity | ID | Description |
|---|---|---|
| Organisation | `demo-org` | Greenfield MAT (multi-academy trust) |
| Site | `demo-site` | Greenfield Primary, 12 School Lane, London |
| EmployerUser | `demo-employer` | Sarah Johnson, cover manager |
| BookingRequest | `smoke-br-1` | Supply teacher shift, starts in 48h (re-created by smoke-setup) |

---

## Employer

| Field | Value |
|---|---|
| Name | Sarah Johnson |
| Email | sarah.johnson@greenfieldmat.org |
| Role | `cover_manager` |
| Org | Greenfield MAT (`demo-org`) |

---

## Workers

| ID | Name | Role types | Distance to site | Reliability | Compliance state |
|---|---|---|---|---|---|
| `demo-worker` | Alex Taylor | `supply_teacher` | ~0.4 km | 4.8 ★ | Fully verified ✅ |
| `demo-worker-2` | Priya Sharma | `supply_teacher` | ~1.7 km | 4.2 ★ | Fully verified ✅ |
| `demo-worker-3` | James Mitchell | `cover_supervisor` | ~0.5 km | 3.5 ★ | Safeguarding pending ⚠ |
| `demo-worker-4` | Maria Chen | `teaching_assistant` | ~1.5 km | 3.9 ★ | Fully verified ✅ |
| `demo-worker-5` | Tom Blake | `supply_teacher` | ~3.7 km | 4.5 ★ | DBS pending ⚠ |

**For a `supply_teacher` booking:**
- **Eligible and ranked:** Alex (ranked 1st), Priya (ranked 2nd)
- **Excluded by role type:** James, Maria
- **Excluded by compliance:** Tom (DBS pending) — use the compliance verify flow below to unlock him

---

## Common Test Flows

All examples use port 6200 and the smoke-test booking (`smoke-br-1`).

### 1. Rank candidates and broadcast offers
```bash
# Rank eligible workers for the smoke booking
curl -s -X POST http://localhost:6200/v1/bookings/smoke-br-1/broadcast \
  -H "Content-Type: application/json" \
  -d '{"strategy":"simultaneous_top_n","autonomyLevel":"L2"}'
```
Offers go to Alex and Priya. Tom is blocked; James and Maria are excluded by role type.

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
curl -s -X POST http://localhost:6200/v1/bookings/smoke-br-1/broadcast \
  -H "Content-Type: application/json" \
  -d '{"strategy":"simultaneous_top_n","autonomyLevel":"L2"}'
```

### 9. View audit trail
```bash
curl http://localhost:6200/v1/admin/audit
```

---

## Guardrail Policy (Greenfield MAT)

| Setting | Value |
|---|---|
| Autonomy level | L2 (auto-broadcast, no human approval required) |
| Budget ceiling | £200/day |
| Approved role types | supply_teacher, cover_supervisor, teaching_assistant |
| Max commute | not set |
