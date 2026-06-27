# Viora Memory Deep Dive

Date: 2026-06-26

## Executive Summary

Viora already has a strong Phase 0 memory foundation: governed `MemoryEntry` and
`MemoryEdge` records, use scopes, visibility controls, review-gated imports,
audit events, memory influence tracking, and a hard compliance boundary. That is
better than a generic "vector store of memories" because it treats memory as an
operational system with ownership, provenance, edit/delete paths, and scoped use.

The main gap is not basic memory storage. The gap is turning memory into a
measured learning system for agentic staffing:

- Preserve richer event-level episodes before compressing them into durable
  memories.
- Add temporal reasoning so fit signals can decay, be superseded, or be
  explained at a point in time.
- Add memory evaluations so Viora can prove memory improves intake accuracy,
  fill speed, offer acceptance, briefing quality, and repeat bookings.
- Make CPD a first-class input to Passport, Memory, and Matching rather than a
  separate training feature bolted on later.
- Improve worker and employer memory controls so both sides understand when
  memory affected matching, briefings, and explanations.

The recommendation is to keep Phase 0 memory governed and lightweight, then build
Fit Graph v1 around evidence, temporal signals, CPD/skills, and measurable
marketplace outcomes in Phase 1. A large standalone graph rebuild should wait
until the product has enough high-quality booking, feedback, briefing, and CPD
data to justify it.

## Current Viora Baseline

Current implementation:

- API startup wires the memory agent alongside V, employer, worker, market,
  compliance, and ops agents in `apps/api/src/index.ts`.
- `MemoryEntry` stores durable organisation and worker memories with owner,
  subject, kind, content, value, source, visibility, status, use scopes,
  sensitivity, source label, connector provenance, expiry, deletion metadata,
  confidence, and confirmation fields.
- `MemoryEdge` stores weighted relationship signals between workers, sites,
  roles, bookings, shifts, and relationships.
- The memory agent writes inferred memories from intake and booking events,
  reinforces edges from offer/shift outcomes, retrieves purpose-scoped context,
  and writes `memory.influence` audit events.
- Intake retrieves organisation memory for `intake_default` use before asking V
  to parse or clarify.
- Ranking retrieves worker memory for `ranking_signal`; current scoring uses
  reliability, commute, memory, and a base score.
- Worker-facing fit explanations can include offer context memory.
- Memory CRUD, import, export, admin review, and sandbox tooling exist.
- Compliance remains deterministic through `isEligibleForEducationBooking()`.

Current strengths:

- Governance is unusually mature for an early product.
- Memory is purpose-bound rather than blindly injected everywhere.
- Worker private memory is separated from employer-facing ranking.
- Memory influence is auditable.
- Imported and inferred memories can be review-gated.
- The architecture already distinguishes entries from graph edges.

Current gaps:

- Event history exists across domain tables and audit rows, but there is no
  explicit episodic memory layer designed for replay, retrieval, and evaluation.
- `MemoryEdge` has `weight`, `confidence`, and `evidenceCount`, but no temporal
  lifecycle fields such as valid-from, valid-until, decay policy, superseded-by,
  or contradiction handling.
- Memory extraction is LLM-driven, but there is no memory quality eval suite.
- There is no memory retrieval eval suite, so Viora cannot yet measure whether
  the right memory is being retrieved for intake, ranking, briefings, or
  explanations.
- Memory impact on matching is not yet experimentally measured.
- CPD, skills, confidence, induction, and learning goals are not first-class
  memory or graph concepts yet.
- Procedural memory is not formalized. Agent improvements still live mainly in
  code/prompts, not in controlled, versioned playbooks derived from supervised
  outcomes.

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

### Next: Fit Graph v1

1. Make episodic memory explicit.

   Do not rely only on summaries. Store or derive an event layer that preserves:

   - event type
   - actor
   - source entity
   - timestamp
   - structured payload
   - linked memories and edges
   - review/dispute status
   - whether the episode is allowed for ranking, briefing, explanation, or only
     audit

   Existing `AuditEvent` is close, but it is primarily audit infrastructure. Fit
   Graph v1 needs an episode abstraction optimized for learning and retrieval.

2. Add temporal edge fields.

   Extend the edge model or add a related evidence table to represent:

   - evidence event ids
   - first seen / last seen
   - valid from / valid until
   - decay policy
   - superseded by
   - disputed or moderated state

   This matters because old staffing signals can become misleading.

3. Build CPD into matching.

   CPD should affect matching in three ways:

   - Eligibility-like requirements where training is mandatory, but only when
     backed by deterministic verification.
   - Fit signals where training improves confidence or suitability.
   - Worker growth recommendations where V proposes training that unlocks more
     or better shifts.

   CPD should never become a hidden exclusion system. If a worker is not shown a
   shift because a CPD signal affected ranking, that influence must be auditable
   and reviewable.

4. Add post-shift learning loops.

   Briefing and matching should learn from both sides:

   - Was the site description accurate?
   - Did the worker feel prepared?
   - Did the employer rebook the worker?
   - Did a CPD recommendation later improve acceptance, performance, or pay?
   - Was a negative memory disputed?

5. Add retrieval quality controls.

   Introduce rejection thresholds and fallback behavior. If memory retrieval is
   weak or ambiguous, V should not use it. The product should prefer "I need to
   ask" over silently relying on stale or low-confidence memory.

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

2. Add memory consolidation.

   Periodically convert raw episodes into governed memory:

   - repeated patterns become preferences or fit signals
   - outdated memories are archived or decayed
   - contradictions are surfaced for review
   - high-impact inferred memories require confirmation

3. Add procedural learning under review.

   Let Viora learn playbook improvements from outcomes, but keep them out of the
   hot path until approved. Examples:

   - better clarification questions for certain schools
   - ranking adjustments for certain role/site patterns
   - briefing templates that improve worker confidence
   - CPD recommendations that improve acceptance or repeat booking

4. Add memory A/B tests.

   Run controlled comparisons:

   - memory-assisted intake vs baseline intake
   - memory-assisted ranking vs reliability/commute-only ranking
   - basic briefing vs memory-rich briefing
   - CPD-aware recommendations vs no CPD recommendations

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

- Add explicit episodic memory or a learning-optimized event projection.
- Add temporal/evidence metadata to relationship signals.
- Make CPD part of Passport, Memory, and Matching.
- Add post-shift learning loops connected to briefings and ranking.
- Add retrieval thresholds and stale-memory safeguards.

### Later

- Build the full temporal Fit Graph.
- Add background memory consolidation.
- Add reviewed procedural learning.
- Run memory A/B tests.
- Explore graph/semantic hybrid retrieval once Viora has enough real booking and
  feedback volume.

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

