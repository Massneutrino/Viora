# Viora Roadmap

## Phase 0 — Pilot (0–6 months)

**Goal**: Prove the core loop in a single dense cluster (3–10 schools, 50–200 workers). Manual compliance, L1–L2 autonomy, export-only payroll.

See [`TODO_PHASE0.md`](./TODO_PHASE0.md) for granular engineering tasks.

**Demo/testing support**: Admin includes a deterministic sandbox for replaying the Phase 0 loop with seeded avatars, clean reset, audit timeline and scenario coverage. `npm run test:phase0` runs the same API paths in-process as a close-out gate. The canonical Greenfield demo remains Standard Rate and is refreshed by seed data; Dynamic Rate is covered by a dedicated sandbox scenario with temporary L3 guardrails and seeded worker pay floors. Seeded operational fixtures keep employer/worker navigation populated, and apps display street/city/postcode while retaining coordinates internally for matching.

**Pilot acquisition (adjunct, not a core Phase 0 item)**: the public site (`apps/site`) leads with a live V conversation that qualifies organisations vs workers and captures pilot/waitlist leads (`POST /v1/pilot/chat`, consent-gated, audited), with manual forms as fallback. V's spoken output is now routed through the backend voice provider layer (`/v1/voice/speech`) so ElevenLabs or OpenAI TTS can be selected server-side without rewriting React surfaces.

**Viora Memory v0/v1 governance**: collect clean memory signals as a learning layer, not a major graph build. Phase 0 stores structured organisation defaults, site instructions, worker preferences, CPD/training taxonomy signals, booking outcomes, and feedback signals with use scopes, source/provenance, review-gated imports, influence audits, deletion controls, fixture-based evals, impact analytics, typed high-impact `MemoryEntry.value` conventions, audience-safe "why V used this memory" explanations, episodic learning projections, bounded temporal/evidence scoring on fit edges, admin-reviewed consolidation suggestions, and a hard boundary between worker private memory and employer-facing ranking. See [`VIORA_MEMORY_DEEP_DIVE.md`](./VIORA_MEMORY_DEEP_DIVE.md).

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

**Dynamic Rate / L3 Autonomy**
Dynamic Rate is the Phase 1 rate mode alongside Standard Rate. Standard Rate broadcasts one fixed `payRate`; Dynamic Rate lets the Market Agent clear an offer rate between the employer's starting rate/ceiling and the worker's pay floor. Employer and worker guardrails approve or escalate automatically, and every cleared rate is recorded for audit and explanation.

**Memory Controls**
Employer and worker screens show "what V remembers" with view, edit, archive/delete, source, scope, sensitivity, connector eligibility, typed-value context, expiry and private controls. Important inferred or imported memories are confirmed before V relies on them operationally. Worker offers and employer shortlists include audience-safe "why V used this memory" context, and admin review exposes episodes, graph edges, temporal influence evidence, and review-gated consolidation suggestions for stale, duplicate, conflicting, weak-edge, and repeated-pattern signals. Live third-party memory connectors can start here, but must sit behind the Phase 0 review-gated import/export foundation.

**Fit Graph v1**
Phase 1 starts using confirmed memory signals in intake defaults, pre-shift briefings, offer ranking, and explanations. Fit Graph v1 adds memory evals, influence analytics, typed `MemoryEntry.value` conventions for high-impact operational memories, CPD/skills memory, episodic edge evidence, and conservative temporal scoring that can improve recommendations without becoming a hidden exclusion or compliance system. Memory's ranking weight stays bounded, every influence is audited with score components, and deterministic compliance remains a hard gate. The goal is fewer repeated employer questions, higher worker offer acceptance, better pre-shift confidence, and improved repeat booking rate.

**Multi-Sector Expansion**
Open intake and compliance gates for NHS bank shifts and social care alongside education.

**Platform Subscription**
Employer subscription tier introduced alongside per-booking margin.

---

## Phase 2 — Network (18–30 months)

**Viora Connect**
Agency partner API: third-party agencies can plug their worker pools and credential data into the Viora marketplace. Enables cross-network supply.

**Fit Graph**
Graph-based intelligence layer built from booking history, organisation memory, worker memory, site preferences, worker reliability, role-site match scores, acceptance behaviour, travel patterns, CPD signals, briefings and feedback. Phase 2 extends the reviewed consolidation foundation with richer procedural learning, graph/semantic hybrid retrieval, and operational analytics over temporal episodes and edge evidence/decay. Improves ranking accuracy and fill probability estimates over time.

**Memory Connectors**
Bidirectional external memory interoperability belongs in Phase 2 once consent, provenance, deletion propagation, and operational-use review have been proven with the Phase 0/1 connector foundation.

**Viora MCP Gateway**
MCP belongs at the interoperability edge, not inside the core booking architecture. A future gateway can expose narrow read-only or review-gated resources/tools for trusted AI hosts, delegating all business logic to the existing API, agent, domain, guardrail, and audit paths. It must not expose direct matching, offer broadcast, compliance override, Dynamic Rate negotiation, or worker-private memory until production auth, tenant scoping, consent, deletion propagation, and audit coverage are proven.

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
