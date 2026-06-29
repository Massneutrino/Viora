# Viora Memory Deep Dive

Date: 2026-06-29

## Executive Summary

Viora now has a strong Phase 0/1 memory foundation: governed `MemoryEntry`,
`MemoryEdge`, `MemoryEpisode`, and `MemoryReviewSuggestion` records, typed values,
use scopes, visibility controls, review-gated imports, influence UX, audit events,
memory impact analytics, temporal scoring, retrieval thresholds, consolidation
suggestions, reviewed procedural intake playbooks, post-shift learning loops,
and a hard compliance boundary. That is better than a generic "vector store of memories" because it
treats memory as an operational system with ownership, provenance, edit/delete
paths, review, and scoped use.

The main gap is not basic memory storage. The gap is turning memory into a
measured learning system for agentic staffing:

- Prove the outcome lift of memory-assisted workflows over time.
- Expand reviewed procedural learning beyond intake and post-shift briefing/fit
  learning into CPD recommendations and eventually carefully bounded ranking
  guidance.
- Add real connector integrations with consent, provenance, deletion propagation,
  and operational-use review.
- Move toward graph/semantic hybrid retrieval once Viora has enough real booking,
  feedback, briefing, and CPD data to justify it.

The recommendation is to keep the current memory layer governed and measurable,
then deepen it through reviewed procedural learning and real outcome analysis.
A large standalone graph rebuild should still wait until the product has enough
high-quality booking, feedback, briefing, connector, and CPD data to justify it.

## Current Viora Baseline

Current implementation:

- API startup wires the memory agent alongside V, employer, worker, market,
  compliance, and ops agents in `apps/api/src/index.ts`.
- `MemoryEntry` stores durable organisation and worker memories with owner,
  subject, kind, content, value, source, visibility, status, use scopes,
  sensitivity, source label, connector provenance, expiry, deletion metadata,
  confidence, and confirmation fields.
- `MemoryEdge` stores weighted relationship signals between workers, sites,
  roles, bookings, shifts, and relationships, with temporal/evidence metadata.
- `MemoryEpisode` stores learning projections from operational events.
- `MemoryReviewSuggestion` stores review-gated archive, merge, contradiction,
  confirm-pattern, and procedural-playbook suggestions.
- The memory agent writes inferred memories from intake and booking events,
  reinforces edges from offer/shift outcomes, retrieves purpose-scoped context,
  and writes `memory.influence` audit events.
- Intake retrieves organisation memory for `intake_default` use before asking V
  to parse or clarify.
- Ranking retrieves worker memory for `ranking_signal`; current scoring uses
  reliability, commute, memory, and a base score.
- Worker and employer surfaces include audience-safe "why V used this memory"
  explanations.
- Memory CRUD, import, export, admin review, consolidation review, analytics,
  smoke tests, evals, and sandbox tooling exist.
- Compliance remains deterministic through `isEligibleForEducationBooking()`.

Current strengths:

- Governance is unusually mature for an early product.
- Memory is purpose-bound rather than blindly injected everywhere.
- Worker private memory is separated from employer-facing ranking.
- Memory influence is auditable.
- Imported and inferred memories can be review-gated.
- The architecture already distinguishes semantic entries, graph edges, episodes,
  review suggestions, and typed procedural playbooks.

Current gaps:

- Memory impact is instrumented, but not yet backed by controlled experiments or
  enough real production volume.
- Procedural learning v1 now covers reviewed intake clarification playbooks and
  post-shift briefing/fit suggestions; CPD and ranking playbooks remain future
  work.
- Memory connectors are still review-gated foundations, not live bidirectional
  integrations.
- Retrieval is scoped, threshold-gated, and tested, but not yet graph/semantic
  hybrid retrieval.

## AI Memory Landscape

The strongest current AI-memory systems are converging on layered memory rather
than one generic memory store.

LangGraph's memory docs separate short-term thread state from long-term memory
and explicitly describe semantic facts, episodic experiences, and procedural
rules as separate memory types. They also call out hot-path vs background memory
writing as a major design tradeoff. This maps directly to Viora: live intake
needs low-latency context, while booking outcomes, feedback, and CPD signals can
be consolidated asynchronously.

OpenAI's current ChatGPT memory controls show the product direction for user
trust: visible memory summaries, source explanations, corrections, deletion,
temporary chats, and the ability to understand why memory influenced a response.
For Viora, the equivalent is not just "what V remembers", but "which memory
affected this offer, ranking, briefing, or clarification".

Letta's stateful-agent model treats memory, messages, tool calls, and reasoning
as persisted state. It also distinguishes pinned/core memories from archival
memory. Viora has the start of this through `MemoryEntry` and conversations, but
it does not yet have a clear "core context pack" for each employer, site, worker,
or active booking.

Graphiti/Zep represents the graph-memory direction: temporal knowledge graphs,
episodic ingestion, provenance, fact invalidation, hybrid semantic/full-text/
graph retrieval, and point-in-time reasoning. This is highly relevant for Viora
because staffing fit is not static. A worker may improve after CPD, a school may
change behaviour policies, a commute pattern may become invalid, and a negative
event may be disputed or later resolved.

The Mem0 paper reinforces a practical point: structured, persistent memory can
outperform full-context approaches while reducing latency and token cost. The
useful takeaway for Viora is not to adopt Mem0 wholesale, but to avoid stuffing
long history into prompts and instead build scoped, evaluated retrieval.

The Generative Agents paper remains important because it established the
observation -> reflection -> planning pattern. Viora should adapt that pattern as
event -> governed memory -> market action, with human review where the memory
can affect operational outcomes.

Sources:

- LangChain/LangGraph memory overview:
  https://docs.langchain.com/oss/python/concepts/memory
- OpenAI Memory FAQ:
  https://help.openai.com/en/articles/8590148-memory-faq
- Letta stateful agents:
  https://docs.letta.com/guides/core-concepts/stateful-agents
- Graphiti overview:
  https://help.getzep.com/graphiti/getting-started/overview
- Mem0 paper:
  https://arxiv.org/abs/2504.19413
- Generative Agents paper:
  https://arxiv.org/abs/2304.03442

## Best-In-Class Target For Viora

Best-in-class Viora Memory should become the work-memory layer for regulated
shift matching. It should remember enough to improve outcomes, but not enough to
become opaque, unfair, or compliance-unsafe.

Target layers:

1. Thread memory
   - Conversation state for current intake, onboarding, support, or booking
     recovery.
   - Already partly covered by `Conversation` and `ConversationMessage`.

2. Semantic memory
   - Durable facts and preferences: employer defaults, site instructions,
     worker preferences, pay expectations, commute limits, briefing notes.
   - Already covered by `MemoryEntry`, but needs stronger typed values for
     high-impact categories.

3. Episodic memory
   - Event-level history: request, clarification, broadcast, offer, accept,
     decline, cancellation, check-in, check-out, feedback, dispute, briefing
     shown, briefing acknowledged, CPD recommended, CPD completed.
   - Should preserve ground truth before summarization.

4. Temporal graph memory
   - Relationship facts with time and evidence: worker-site fit, worker-role
     confidence, site-role demand, employer-worker rebooking pattern, induction
     completion, CPD impact.
   - Evolves from `MemoryEdge`.

5. Procedural memory
   - Agent playbooks learned from supervised outcomes: "when Greenfield asks
     for urgent KS2 cover, ask for class context before broadcasting" or "do not
     infer a SEN requirement unless explicitly stated".
   - Should be versioned, reviewed, and never self-modify compliance gates.

6. CPD and skills memory
   - Worker goals, confidence gaps, completed training, expiring training,
     employer-required induction, sector-specific capability, and evidence that
     training improved outcomes.
   - Should live across Passport, Memory, and Matching.

## Ranked Recommendations

### Now: Phase 0-1 Practical Upgrades

1. Add a memory evaluation harness.

   Build fixture-based tests for memory extraction, retrieval, and influence.
   Use real-shaped examples:

   - Employer says a site prefers experienced KS2 cover.
   - Worker says they are confident with SEND but want shorter commutes.
   - A worker declines because the site is too far.
   - A briefing note should be used for the worker but not employer ranking.
   - A private worker note must not appear in employer-facing ranking.

   Metrics:

   - correct memory extracted
   - no memory extracted when event is not durable
   - correct use scopes assigned
   - sensitive/private memories review-gated
   - correct memory retrieved for intake/ranking/briefing/explanation
   - compliance never inferred from memory

2. Add explicit "memory impact" analytics.

   Current `memory.influence` audit rows are the right foundation. Add reporting
   that answers:

   - Did memory reduce clarification turns?
   - Did memory-ranked candidates accept at a higher rate?
   - Did workers with briefing memories get higher shift feedback?
   - Did site-specific memory improve repeat booking?
   - Which memory kinds are noisy or unused?

3. Tighten typed memory categories for high-impact operational use.

   Keep free-text `content`, but standardize `value` shapes for:

   - site instructions
   - worker availability preference
   - commute preference
   - pay expectation
   - role confidence
   - briefing note
   - preferred/blocked worker
   - CPD skill or training record

   This makes memory safer to evaluate and retrieve without turning everything
   into prompt text.

4. Add employer and worker "why this was used" surfaces.

   Employers should see memory influence in booking confirmations and shortlist
   explanations. Workers should see memory influence in offer explanations and
   briefings. The key product question is: "Why did V remember/use this?"

5. Start CPD memory now, even if CPD workflows come later.

   Add CPD as a planned memory/Passport concept now:

   - skill interest
   - skill confidence
   - completed CPD
   - required induction
   - expiring training
   - employer-requested training
   - training impact evidence

   This avoids a later migration where training data sits outside matching.

### Implemented Fit Graph v1 Groundwork

1. Episodic memory is explicit.

   `MemoryEpisode` now preserves:

   - event type
   - actor
   - source entity
   - timestamp
   - structured payload
   - linked memories and edges
   - review/dispute status
   - whether the episode is allowed for ranking, briefing, explanation, or only
     audit

   `AuditEvent` remains compliance/audit truth; `MemoryEpisode` is the learning
   projection.

2. Temporal edge fields are in place.

   `MemoryEdge` now represents:

   - evidence event ids
   - first seen / last seen
   - valid from / valid until
   - decay policy
   - superseded by
   - disputed or moderated state

   This matters because old staffing signals can become misleading.

3. CPD is a typed memory taxonomy.

   CPD should affect matching in three ways:

   - Eligibility-like requirements where training is mandatory, but only when
     backed by deterministic verification.
   - Fit signals where training improves confidence or suitability.
   - Worker growth recommendations where V proposes training that unlocks more
     or better shifts.

   CPD should never become a hidden exclusion system. If a worker is not shown a
   shift because a CPD signal affected ranking, that influence must be auditable
   and reviewable.

4. Consolidation is review-gated.

   `MemoryReviewSuggestion` proposes stale archive, duplicate merge,
   contradiction review, weak-edge supersession, repeated-pattern confirmation,
   and intake procedural playbooks. Operational memory only changes after admin
   apply/reject.

5. Procedural learning starts with intake playbooks.

   Viora can propose approved clarification guidance from repeated intake
   outcomes. These playbooks are `pattern` memories scoped to `intake_default`
   and `explanation`; they have no ranking or compliance impact.

6. Post-shift learning is review-gated.

   Worker and employer feedback creates `Feedback`, audit rows and
   `MemoryEpisode` evidence. Repeated non-contested feedback can propose briefing
   notes or fit-feedback memories. Briefing notes become active only after admin
   apply; fit feedback remains `pending_confirmation` because it can affect
   ranking later.

### Next: Fit Graph / Memory Intelligence

1. Extend post-shift learning into richer playbooks.

   Briefing and matching should learn from both sides:

   - Did a CPD recommendation later improve acceptance, performance, or pay?
   - Was a negative memory disputed?
   - Which briefing templates improve worker confidence?
   - Which reviewed feedback patterns deserve wider procedural playbooks?

2. Deepen retrieval quality controls.

   Viora now applies purpose-scoped confidence and temporal thresholds before
   memory reaches intake, ranking, briefing, or explanation contexts. Keep
   expanding this into ambiguity detection and graph/semantic retrieval once
   there is enough real data to measure precision.

3. Add memory A/B tests.

   Run controlled comparisons:

   - memory-assisted intake vs baseline intake
   - memory-assisted ranking vs reliability/commute-only ranking
   - basic briefing vs memory-rich briefing
   - CPD-aware recommendations vs no CPD recommendations

### Later: Best-In-Class Endstate

1. Build a temporal work graph.

   Move from simple weighted edges to a domain graph across:

   - worker
   - site
   - organisation
   - role
   - skill
   - CPD module
   - induction
   - shift
   - feedback
   - briefing
   - preference
   - dispute

   Retrieval should combine filters, full-text search, semantic search, and
   graph traversal.

2. Expand procedural learning under review.

   Let Viora learn playbook improvements from outcomes, but keep them out of the
   hot path until approved. Examples:

   - better clarification questions for certain schools
   - ranking adjustments for certain role/site patterns
   - briefing templates that improve worker confidence
   - CPD recommendations that improve acceptance or repeat booking

3. Add live memory connectors.

   Move from review-gated import/export foundations to consented integrations
   with provenance, deletion propagation, and operational-use review.

## CPD: Where It Fits

CPD is highly relevant. It should be treated as a worker growth and market
liquidity system, not just a training checklist.

The right model is three-layered:

1. Passport
   - verified CPD completions
   - certificates
   - expiry dates
   - mandatory training status
   - sector eligibility implications

2. Memory
   - worker goals
   - confidence gaps
   - preferred learning areas
   - employer/site induction history
   - post-training outcome signals
   - training recommendations V has already made

3. Matching
   - CPD as a positive fit signal
   - CPD as a briefing input
   - CPD as a way to unlock new role types or sites
   - CPD as a supply strategy for employers with recurring hard-to-fill needs

Employer benefits:

- better-prepared workers
- fewer repeated induction explanations
- stronger site-specific fit
- ability to grow local supply for recurring needs
- clearer evidence that Viora improves quality, not just speed

Worker benefits:

- more relevant offers
- clear route to better shifts and higher pay
- less anxiety before unfamiliar sites
- portable evidence of growth
- fairer explanations of why a shift is or is not a fit

CPD risk:

- If CPD becomes a hidden ranking penalty, it can harm workers and create
  unfair exclusion. Viora should present CPD primarily as an unlock and
  improvement path, with human-reviewable rules for any adverse effect.

## Metrics To Prove Memory Is Working

Marketplace metrics:

- median time to fill
- fill rate
- offer acceptance rate
- decline reason distribution
- repeat booking rate
- worker reactivation rate
- employer rebooking rate
- cancellation/replacement rate

Worker metrics:

- perceived preparedness
- briefing usefulness
- offer relevance
- CPD completion rate
- CPD-to-opportunity conversion
- pay progression after CPD
- private-memory corrections/deletions

Employer metrics:

- clarification turns per booking
- booking accuracy
- site instruction reuse
- preferred worker fill rate
- incident rate
- quality rating trend
- admin time saved

Memory quality metrics:

- extraction precision and recall
- retrieval hit rate
- stale memory rate
- contradicted memory count
- correction rate
- deletion rate
- influence-to-outcome correlation
- private memory leakage incidents, target zero
- compliance override incidents, target zero

## Product And Governance Risks

1. Stale memory
   - Mitigation: expiry, decay, review prompts, temporal edges.

2. Bias amplification
   - Mitigation: score audits, protected-characteristic proxy review, human
     review before adverse exclusion, worker contestability.

3. Privacy leakage
   - Mitigation: strict visibility, use scopes, source display, influence
     display, private-to-operational promotion flow.

4. Compliance leakage
   - Mitigation: keep deterministic compliance gates separate. Memory can
     explain and prioritize but cannot infer DBS, right-to-work, identity, QTS,
     safeguarding, references, SIA, or legal eligibility.

5. Over-personalisation
   - Mitigation: retrieval thresholds and explicit "ask instead of assume"
     behavior for high-impact fields.

6. Opaque matching
   - Mitigation: explain score components and memory influence at a human level.

## Recommended Roadmap

### Now

- Add memory extraction/retrieval/influence eval fixtures.
- Add memory impact analytics from `memory.influence` and offer/booking
  outcomes.
- Standardize typed `value` shapes for high-impact memory kinds.
- Add "why V used this memory" to employer and worker surfaces.
- Define CPD memory categories before implementing CPD workflows.

### Next

- Extend post-shift learning into CPD and ranking review.
- ✅ Add retrieval thresholds and weak-memory fallback behavior.
- Run memory impact experiments once real workflow volume is available.
- Harden consolidation review with history, filters, and scheduled generation.
- Extend reviewed procedural learning beyond intake after eval coverage is in
  place.

### Later

- Build the full temporal Fit Graph.
- Add live memory connectors with consent and deletion propagation.
- Add graph/semantic hybrid retrieval.
- Run memory A/B tests.

## Implementation Notes For Future Build Specs

- Do not replace the current memory stack. Extend it.
- Keep `MemoryEntry` as governed semantic memory.
- Keep `MemoryEdge` as the early fit graph, but add temporal/evidence structure
  before relying on it for stronger ranking behavior.
- Treat `AuditEvent` as compliance/audit truth, but create a learning-friendly
  episode projection if analytics and retrieval become awkward.
- Keep all LLM extraction behind `createLLMClient()`.
- Add tests before increasing memory weight in ranking.
- Keep worker private memory out of employer-facing ranking unless the worker
  explicitly promotes it.
- Keep CPD positive and unlock-oriented by default.
