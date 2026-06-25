# Viora Roadmap

## Phase 0 — Pilot (0–6 months)

**Goal**: Prove the core loop in a single dense cluster (3–10 schools, 50–200 workers). Manual compliance, L1–L2 autonomy, export-only payroll.

See [`TODO_PHASE0.md`](./TODO_PHASE0.md) for granular engineering tasks.

**Demo/testing support**: Admin includes a deterministic sandbox for replaying the Phase 0 loop with seeded avatars, clean reset, audit timeline and scenario coverage.

**Pilot acquisition (adjunct, not a core Phase 0 item)**: the public site (`apps/site`) leads with a live V conversation that qualifies organisations vs workers and captures pilot/waitlist leads (`POST /v1/pilot/chat`, consent-gated, audited), with manual forms as fallback.

**Viora Memory v0/v1 governance**: collect clean memory signals as a learning layer, not a major graph build. Phase 0 stores structured organisation defaults, site instructions, worker preferences, booking outcomes, and feedback signals with use scopes, source/provenance, review-gated imports, influence audits, deletion controls, and a hard boundary between worker private memory and employer-facing ranking.

**Exit criteria** (from `PHASE_0_SUCCESS_METRICS`):
- ≥ 70% of bookings initiated conversationally
- ≥ 95% intent accuracy
- Median time-to-fill ≤ 12 minutes
- Fill rate ≥ 90%
- Zero compliance errors (no ineligible worker placed)

---

## Phase 1 — Scale & Trust (6–18 months)

**Viora Passport**
Portable, worker-owned credential profile. Workers verify once; compliance follows them across employers and sectors. Network effect: more employers → more value to workers → more workers.

**Viora Pay**
Earned wage access — workers can draw earned pay same-day after shift completion. Requires FCA liaison and payroll integrations.

**Automated Compliance**
Replace manual compliance queue with API integrations: DBS online, Right to Work digital checks, prohibition register lookup. Compliance becomes real-time rather than batched.

**L3 Autonomy**
Agent-driven pay negotiation within guardrail bounds. Market Agent proposes a rate; employer and worker guardrails approve or escalate automatically.

**Memory Controls**
Employer and worker screens show "what V remembers" with view, edit, delete, source, scope, sensitivity, connector eligibility, and private controls. Important inferred or imported memories are confirmed before V relies on them operationally. Live third-party memory connectors can start here, but must sit behind the Phase 0 review-gated import/export foundation.

**Fit Graph v1**
Phase 1 starts using confirmed memory signals in intake defaults, pre-shift briefings, offer ranking, and explanations. The goal is fewer repeated employer questions, higher worker offer acceptance, better pre-shift confidence, and improved repeat booking rate.

**Multi-Sector Expansion**
Open intake and compliance gates for NHS bank shifts and social care alongside education.

**Platform Subscription**
Employer subscription tier introduced alongside per-booking margin.

---

## Phase 2 — Network (18–30 months)

**Viora Connect**
Agency partner API: third-party agencies can plug their worker pools and credential data into the Viora marketplace. Enables cross-network supply.

**Fit Graph**
Graph-based intelligence layer built from booking history, organisation memory, worker memory, site preferences, worker reliability, role-site match scores, acceptance behaviour, travel patterns, and feedback. Improves ranking accuracy and fill probability estimates over time.

**Memory Connectors**
Bidirectional external memory interoperability belongs in Phase 2 once consent, provenance, deletion propagation, and operational-use review have been proven with the Phase 0/1 connector foundation.

**Geographic Expansion**
Move beyond the Phase 0 pilot cluster to additional regions; MAT-level rollout for multi-site organisations.

**L4 Autonomy** *(subject to regulatory approval)*
Agents close bookings end-to-end without human sign-off for pre-approved worker/employer pairs.

**Employer Mobile App**
Native app for cover managers: V intake, live booking status, shift alerts.

---

## Phase 3 — Platform (30+ months)

**Full Multi-Sector**
Security, hospitality, logistics — each sector gets its own compliance gate set and role taxonomy.

**Marketplace Network Effects**
Cross-employer worker supply pooling: an idle supply teacher at School A can be surfaced to School B in the same cluster without either employer maintaining separate rosters.

**L4 Autonomy at Scale**
Autonomous matching and negotiation as the default for high-trust, pre-approved relationships.

**Regulatory Pre-Approval**
Work with DfE, CQC, and SIA to achieve pre-approved autonomous staffing status in regulated sectors.
