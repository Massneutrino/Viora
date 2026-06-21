# VIORA

**Product Requirements Document**

*Version 2.0  |  June 2026  |  Owner: Imran*

## CONFIDENTIAL — STRATEGIC DRAFT

## THE THESIS

The temp staffing industry is not waiting for a better form. It is waiting for the human dispatcher and the human recruiter to be replaced by something faster, always-on, and working for both sides at once. Viora is that replacement.

## 1. Executive Summary

Viora is the AI-native operating system for flexible and temporary work in regulated sectors. It starts in education — the UK's £1.3bn supply teacher market — and expands across security, care, hospitality, logistics, events, and every other sector where organisations still book temporary workers through phone calls, emails, and human agency dispatchers.

**The core disruption is simple and total:**

Employers stop filling in forms. They tell V — by app, WhatsApp, or phone — what they need, and it is handled.

Workers stop browsing job boards. Their personal agent, V, finds their next best shift and puts it in front of them as a single card to swipe right or left.

Agencies stop owning the coordination layer. Viora replaces it — with better matching, portable compliance, transparent economics, and zero human dispatcher overhead.

## NORTH STAR

Fill every eligible shift with the best available compliant worker at the right price, with no human coordination required.

Viora is not a staffing app with AI features bolted on. Every person who talks to Viora — employer or worker, on any channel — talks to one branded AI voice: V. Behind V is a two-sided agentic architecture: an employer-context agent continuously working each open shift, a worker-context agent continuously working each worker's opportunity pipeline, specialist sub-agents handling compliance, safety, pay, and operations, and a market agent clearing supply and demand in real time.

The result is a labour marketplace that gets smarter with every booking, every cancellation, every check-in, and every piece of feedback — building a data and trust flywheel that no traditional agency and no first-generation digital staffing app can replicate.

## 2. Why Viora, Why Now

### 2.1 The Market Has Not Changed — And That Is the Opportunity

UK schools spend an estimated £1.25–1.4bn per year on supply cover. The dominant workflow in 2026 is still a cover manager calling an agency before 7am, hoping someone is available, paying a markup of 20–40%, and having no visibility into who is coming or whether they are fully compliant. The same pattern plays out in manned security, social care, hospitality, and every other shift-based sector: human dispatchers, manual coordination, opaque pricing, and repeated compliance checks for the same workers.

This is not a market that has been hard to digitise. It is a market that has been digitised badly. The first wave of digital staffing platforms — Teacher Booker, SupplyBank, Indeed Flex, Job&Talent — all made the booking form easier to fill in. None of them replaced the coordination logic underneath.

Viora replaces the coordination logic.

### 2.2 Two Structural Shifts in 2026 Make This the Right Moment

First: foundation model capability has crossed the threshold for reliable real-time agentic workflows. Voice-to-structured-data, multi-turn negotiation with guardrails, always-on context agents, and real-time matching at scale are all now buildable without requiring a 200-person engineering team. The cost of running the coordination intelligence that agencies currently provide in human form has collapsed.

Second: UK regulation is pushing employers toward more structured, auditable flexible labour. The Employment Rights Act 2025, which received Royal Assent in December 2025 and is rolling out through 2026–2027, restricts how zero-hours arrangements can be used and introduces a duty to offer guaranteed hours to qualifying workers. Employers will need better visibility and audit trails around how they use flexible labour — not just a faster booking tool. Viora is built for this world from day one.

### 2.3 The Education Wedge

Education is the right first market for four compounding reasons:

Urgent, recurring demand. Schools need cover at short notice, every week of every term, for predictable role types. Demand is reliable and the problem is genuinely painful.

High compliance barrier creates a defensible moat. DBS checks, QTS/non-QTS eligibility, safeguarding training, right-to-work, and school-specific induction requirements are exactly the kind of structured compliance that Viora's Trust and Compliance Agent is built to manage — and that is genuinely hard for a non-specialist platform to enter credibly.

MAT and cluster network effects. Multi-Academy Trusts and local school clusters can create dense supply-demand networks from a single sales relationship. One MAT of 12 schools is 12 employer accounts and a shared worker pool with one procurement decision.

Founder-market fit. The Viora founding team has direct relationships and credibility in the education sector.

The security vertical follows education in Phase 1 because it shares the same core primitives — licensed workers, compliance-gated matching, site-specific inductions, lone-worker safety requirements — and proves the multi-vertical thesis with different sector characteristics and a different buyer profile.

## 3. Product Vision and Promise

### 3.1 Vision

> "Become the AI-native operating system that the entire flexible and temporary labour market runs on — displacing both legacy agencies and first-generation digital staffing apps — starting in education and security, and expanding into every sector where temp staffing still means a phone call to an agency."

### 3.2 Product Promise

**FOR EMPLOYERS**

Tell V what you need — by app, by WhatsApp, or by phone — and Viora finds, verifies, books, confirms, tracks, and replaces cover if anything changes. No forms. No agency calls. No chasing.

**FOR WORKERS**

Your personal agent V finds the best shifts for your skills, schedule, commute, and goals. One card. Swipe right to take it. Show up, get paid, build your reputation across every employer and sector you work in.

### 3.3 The V Brand

Every person who interacts with Viora — employer or worker, through the app, WhatsApp, or phone — talks to one consistent AI identity: V.

V is the product brand. Behind V, the architecture is sophisticated: an employer-context agent working each open shift, a worker-context agent working each worker's pipeline, a Market Agent clearing supply and demand, a Trust and Compliance Agent enforcing eligibility rules, and an Ops Agent supporting the internal team. Users never see or need to understand this architecture. They experience V — always-on, always working for them, always explainable.

This is a deliberate design decision. Internal architecture vocabulary stays internal. The user-facing product has one name, one voice, and one promise.

### 3.4 Product Principles

Intent over forms. Employers express an outcome in natural language. V structures the request.

Agents for both sides. Employer and worker each have an agent working in their interest within transparent, auditable rules.

Trust before speed. No match bypasses compliance, safeguarding, identity verification, or role eligibility. These gates are deterministic, not probabilistic.

Human control where stakes are high. V can recommend, negotiate, and automate — but sensitive decisions require approval, auditability, and an override path.

Real-time by default. V understands urgency, live availability, live travel time, acceptance probability, and fallback risk.

Portable worker reputation. Workers own a verified credential that compounds across employers, sectors, and time.

Multi-vertical architecture, vertical-specific trust. Education and security share platform primitives. Each has its own compliance rules and operating logic.

Transparent economics. Employers see worker pay, Viora fee, and total cost. Workers see every component of what they earn. Viora's margin is visible enough to build trust.

Scores inform, they do not gate. Worker reliability and reputation data improves matching. No worker is excluded from work based solely on an algorithmic score without a defined human review path.

## 4. Target Users

### 4.1 Employer Personas

#### Cover Manager / School Office

- Needs compliant cover fast, often by 7am.
- Wants minimal friction — telling V verbally is less work than logging into a portal.
- Cares deeply about safeguarding, school fit, reliability, and clear costs.
- Currently juggles phone calls to multiple agencies under morning pressure.

#### SLT / Headteacher / MAT Operations Leader

- Cares about cost control, quality benchmarking, safeguarding governance, and reducing agency dependency.
- Needs cross-school dashboards: spend, fill rate, worker quality, compliance status.
- Requires procurement-grade auditability and evidence of value versus agency baseline.

#### Security Operations Manager

- Needs SIA-licensed staff for specific sites and time windows.
- Cares about no-shows, site-specific risk, check-in proof, incident logs, and lone-worker safety.
- Often managing 24/7 shift patterns with last-minute gaps.

#### Multi-Site Operations Leader

- Needs standardised staffing workflows across multiple locations with central visibility and local autonomy.
- Wants automated escalation when fill probability drops below threshold.

### 4.2 Worker Personas

#### Supply Teacher / Cover Supervisor / TA / LSA

- Wants good pay, flexibility, meaningful work, and clear expectations before arrival.
- Wants control over commute distance, age range, subject, behaviour context, and school preferences.
- Values portable reputation — being known as reliable across multiple schools, not starting from zero each time.
- Frustrated by agency dependency, unexplained pay deductions, and 6am phone calls.

#### Security Officer

- Wants confirmed pay, clear site instructions, and licence-aware matching.
- Cares about lone-worker safety, night shift support, and reliable check-in.

#### Multi-Sector Flexible Worker

- Works across education support, events, hospitality, security, or care depending on availability.
- Wants one intelligent profile, one agent, one opportunity feed — regardless of sector.
- The Viora Passport makes cross-sector utilisation possible without repeated vetting.

## 5. Core Product Experience

### 5.1 Employer Experience: Tell V

An employer can initiate a cover request through any channel they already use:

Web or mobile app — structured or free-text

WhatsApp message or voice note

In-app voice conversation with V

Phone call to the Viora line

Phase 2: email forwarding, MIS integration, calendar trigger

Example: a cover manager sends a WhatsApp voice note at 7:04am:

```
"Need a KS2 supply for tomorrow — Year 5, Greenfield Primary, 8:15 to 3:30. Behaviour experience helpful. Nothing over 180 a day."
```

V processes the request, extracts the structured intent, asks only the questions that are genuinely missing, checks policy and compliance rules, confirms the booking structure, broadcasts to the ranked candidate list, confirms the fill, and sends assignment details to both school and worker. The cover manager receives a WhatsApp confirmation before 7:10am. She did not log in to anything.

**Once a booking is live, V monitors it continuously:**
- Pre-shift readiness check — worker confirmed, travel time safe, compliance valid
- Check-in detection — if no check-in within window, V escalates immediately
- Self-healing replacement — if a booking becomes at risk, V reopens the shift, prioritises backup candidates, and notifies the employer with a replacement ETA
- Post-shift feedback collection

### 5.2 Worker Experience: The Swipe Deck

Workers do not browse a job board. V surfaces the single best available opportunity as a card — role, location, pay, travel time, fit explanation, countdown to accept. The worker swipes right to take it or left to pass. One action, no forms.

The worker app combines the instinctive UX of Uber Driver with the intelligence of a personal career agent:

Ranked opportunity feed — the best shift for this worker, surfaced first

Swipe-to-accept with countdown — urgency is visible, decision is instant

Fit explanation — V tells the worker why this shift matches their profile

Earnings tracker — daily, weekly, monthly targets and progress

Preference and availability control — commute, roles, days, auto-accept rules

Compliance dashboard — document status, expiry alerts, what to upload next

V chat — ask anything about an assignment, a payment, a compliance requirement

**Workers can also configure auto-accept rules:**
- Auto-accept primary schools within 25 minutes paying at least £X
- Auto-accept repeat bookings at schools rated 4 stars or above
- Never offer night shifts until availability is explicitly enabled

### 5.3 The Marketplace: Agent-to-Agent Matching

Below the surface, every booking is a negotiation between two context agents — the employer-side instance of V and the worker-side instance of V — mediated by the Market Agent.

**Concretely:**

The employer agent holds the booking: budget ceiling, role requirements, preferred workers, risk tolerance, urgency level, and fill probability target.

The worker agent holds the worker: availability, commute constraints, pay floor, sector preferences, reliability history, and current pipeline.

The Market Agent clears the match: ranking candidates, predicting acceptance probability, determining whether a pay uplift improves expected fill speed, and sequencing offers.

Every negotiation outcome is stored as an auditable object. Both sides see the result and a plain-English explanation. No autonomous negotiation happens outside the guardrails each side has explicitly defined.

## 6. AI-Native Architecture

### 6.1 Agent Roles

| Agent | Role and Responsibilities |
| --- | --- |
| **V (user-facing)** | Single branded voice for all employer and worker interactions across all channels. Omnichannel intake, confirmation, status, and support. |
| **Employer Context Agent** | Holds and works each open booking: parses intent, checks policy and compliance, produces ranked shortlists, manages broadcast strategy, monitors live bookings, triggers replacement. |
| **Worker Context Agent** | Holds and works each worker's profile and pipeline: surfaces ranked opportunities, explains fit, learns preferences, manages compliance, supports auto-accept rules, tracks earnings and career progression. |
| **Market Agent** | Clears supply and demand: real-time matching and ranking, acceptance probability modelling, fill probability forecasting, dynamic incentive recommendation, backup candidate management, market liquidity analysis. |
| **Trust and Compliance Agent** | Enforces all eligibility rules: document verification, expiry tracking, right-to-work, DBS, QTS, SIA, safeguarding, sector-specific induction requirements. All compliance gates are deterministic — no match crosses an eligibility line on probabilistic inference. |
| **Ops Agent** | Supports the internal Viora team: monitors unfilled shifts, flags bottlenecks, triages employer and worker support issues, detects anomalous patterns, produces daily market health summaries. |

### 6.2 Autonomy Levels (L0–L4)

Viora does not require employers or workers to trust full automation at launch. The autonomy level is configurable and increases with track record.

| Level | Behaviour |
| --- | --- |
| **L0 — Suggest only** | V produces a ranked shortlist and explanation. The employer approves every booking manually. |
| **L1 — Auto-shortlist** | V shortlists and ranks automatically. Employer approves the top candidate. |
| **L2 — Auto-broadcast** | V broadcasts to the ranked list automatically. Employer sees confirmation when filled. Can override at any point. |
| **L3 — Auto-negotiate within guardrails** | V negotiates pay within defined employer ceiling and worker floor. Humans see the result and explanation. |
| **L4 — Fully autonomous, monitored** | V books, confirms, and manages the shift end-to-end within all defined policies. Full audit trail. Human override always available. |

Phase 0 pilot: most employers start at L1 or L2. L3 and L4 are available only after a defined track record of successful bookings. Workers choose their own auto-accept level independently.

### 6.3 GuardrailPolicy

Every autonomous action V takes is bounded by a GuardrailPolicy object — a structured set of constraints defined by the employer and/or worker that V cannot exceed without explicit human approval:

**Employer: budget ceiling, approved role types, worker whitelist/blocklist, maximum daily autonomy, approval thresholds, escalation contacts**

**Worker: pay floor, maximum commute, role exclusions, minimum notice period, auto-accept conditions, channel preferences**

**Platform: compliance gates (always deterministic), legal eligibility rules, sector-specific safeguarding requirements, AI fabrication prohibitions**

V cannot fabricate compliance status, legal eligibility, pay rates, or qualifications. All compliance decisions are based solely on verified data. Any uncertainty produces a human review flag, not a probabilistic pass.

## 7. Flagship Disruptive Features

### 7.1 Tell V — Zero-Form Omnichannel Intake

Employers create bookings by talking or messaging, not by filling in forms. V handles the parsing, structuring, clarification, and confirmation. The channel — app, WhatsApp, voice note, phone call — is irrelevant. The intent is captured correctly or V asks only the minimum questions to resolve ambiguity.

This is the first and most visible disruption. Cover managers who currently spend 15 minutes navigating a portal before 7:30am will send a WhatsApp message in under 30 seconds.

### 7.2 The Viora Swipe Deck

The worker's primary interface is a single ranked card: one shift, one decision, one swipe. The card shows pay, travel time, role, employer, fit reason, and a countdown. Accept or pass. No browsing, no applying, no waiting.

This UX is deliberately borrowed from consumer product psychology — the instinctive gesture-based decision that Tinder proved and Uber Driver refined. In a market where worker engagement is the hardest side to grow, removing friction from the accept decision compounds directly into fill rate.

### 7.3 Viora Passport — The Portable Trust Layer

The Viora Passport is Viora's primary competitive moat. It is a portable, verified, continuously monitored credential containing:

Identity verification (biometric liveness in Phase 1)

Right-to-work status

DBS certificate and update service monitoring

QTS or non-QTS status for education roles

SIA licence with expiry tracking for security roles

Safeguarding training completion

Verified work history and attendance reliability

Employer feedback (aggregated, bias-reviewed, disputable)

Cross-sector eligibility flags — a worker verified once can be matched into any sector their credentials qualify them for

The strategic importance of the Passport cannot be overstated. The primary reason traditional agencies persist is that they own the compliance and vetting function. When Viora owns a worker's verified credential — and that credential becomes more valuable the more employers and sectors it is accepted by — the cost of moving that worker off Viora becomes real for both sides. This is the network effect that compounds Viora's moat over time.

### 7.4 Self-Healing Shifts

Viora monitors every live booking continuously. When a booking becomes at risk — the worker cancels, is running late, fails to check in, or triggers an anomalous pattern — V acts immediately:

Detects the risk and escalates to the relevant autonomy level

Reopens the shift to backup candidates identified at booking time

Notifies the employer with a plain-English explanation and a replacement ETA

Records the event in the audit trail with full reasoning

Adjusts the worker's reliability profile appropriately

The employer never needs to scramble. The system already knows who the backup is.

### 7.5 Transparent Economics

**Every booking shows the full economic breakdown:**

Worker pay rate

Viora service fee

Total cost to employer

Estimated saving versus configured agency baseline

Spend trend by school, department, role type, and period

This is not just a trust feature. It is a sales tool. The moment a MAT leader can see that Viora cost them 22% less than their agency over a term, the conversation about switching becomes very short.

### 7.6 Guardrailed Autonomy — Agent-to-Agent Negotiation

When an employer has enabled L3 or above, V can negotiate pay within defined guardrails. The employer sets a budget ceiling. The worker has set a pay floor. V finds the optimal rate that maximises fill probability while respecting both. The negotiation record is auditable. Both parties see the result and the reasoning.

No competitor in the flexible staffing market does this. The closest analogue — Jack & Jill — operates only in white-collar permanent hiring and has no compliance, safety, or physical attendance layer. Viora's differentiation is applying two-sided agentic negotiation to regulated, in-person, shift-based work.

### 7.7 Viora Connect — The Agency Bridge

Viora Connect is an API layer that allows existing staffing agencies to plug their worker pools into Viora as a supply source. In the early market, this solves cold-start liquidity. Over time, it turns agencies from competitors into on-ramps — their workers get Viora Passports, their clients get Viora's experience layer, and Viora gradually becomes the infrastructure the whole market runs on.

Viora Connect is a Phase 2 feature. The Phase 0 and 1 pilots run on directly sourced and vetted worker pools. Agency integration is introduced once the core platform experience is proven and the Passport network has meaningful value.

### 7.8 Viora Pay — Earned Wage Access

Viora Pay gives workers access to a portion of confirmed earned wages before standard payroll cycle. In a market where worker liquidity is the hardest side to grow, faster pay access is a direct acquisition and retention lever. Workers who know they can access earnings within 24 hours of a completed shift are materially more likely to work through Viora than through a competitor offering standard monthly or bi-weekly payment.

Viora Pay is a Phase 1 feature, subject to specialist legal review before shipping. The UK FCA has published guidance noting that many Employer Salary Advance Schemes fall outside consumer credit regulation but can raise consumer-protection-style risks around repeated use and cost transparency. Viora Pay will be built with explicit cost transparency, usage-rate monitoring, and legal sign-off before any worker accesses it.

### 7.9 The Fit Graph — Employer and Site Intelligence

Over time, V builds a rich model of which workers fit which environments:

Subject specialism and key stage confidence

Behaviour management context (high, moderate, specialist)

SEND experience and specific training

School culture fit derived from post-shift feedback

Travel reliability by route, time, and weather pattern

Repeat booking rate and employer re-request signals

This intelligence compounds. A worker who has done 40 shifts across 12 schools in a MAT has a fit graph that makes them significantly easier to place — and their Passport more valuable — than a worker who just joined. The system rewards reliability, which improves supply-side quality for employers, which improves the product for everyone.

## 8. Functional Requirements

### 8.1 Employer Onboarding

- **FR-E-001:** Create organisation with name, sector, type, address, locations/sites, billing, contacts, timezone, approval policies, rate cards, and compliance policies.
- **FR-E-002:** Employer roles: Organisation Admin, Cover Manager / Ops Manager, Approver, Finance User, Read-only Auditor. Each role has distinct permission scope.
- **FR-E-003:** Employer preferences: preferred workers, blocked workers, auto-booking rules, maximum rates, approval thresholds, escalation contacts, default shift parameters, and site instructions.
- **FR-E-004:** Multi-site / MAT configuration: parent organisation with child sites, cross-site visibility controls, and consolidated reporting.
### 8.2 Worker Onboarding

- **FR-W-001:** Worker profile: name, contact, home location, work radius, role types, experience, availability, pay expectations, and right-to-work basis.
- **FR-W-002:** Compliance onboarding: guided document upload, V-assisted gap analysis, expiry tracking, and status dashboard.
- **FR-W-003:** Availability management: recurring schedule, specific unavailability, minimum notice, auto-accept rules, and channel preferences.
- **FR-W-004:** Worker Passport: portable verified credential tracking all compliance, work history, reliability data, and sector eligibility.
### 8.3 Intake and Request Creation

- **FR-I-001:** Structured web/mobile request — standard form fallback always available.
- **FR-I-002:** Natural language free-text intake — V parses and extracts structured intent.
- **FR-I-003:** Voice request — in-app voice, WhatsApp voice note, or Viora phone line. V transcribes, parses, and structures.
- **FR-I-004:** WhatsApp intake — text or voice note. V responds by WhatsApp with confirmation, clarification questions, or status.
- **FR-I-005:** Minimum clarification loop — V asks only for fields that are genuinely missing and not inferable from context or employer memory.
- **FR-I-006:** Request confirmation — before broadcast, V confirms structured intent unless employer has enabled auto-submit.
- **FR-I-007:** Live fill probability — before submission, employer sees estimated fill probability, pool depth, time-to-fill estimate, and suggestions to improve fill rate.
- **FR-I-008:** Employer memory — V retains organisation-level preferences and applies them automatically to all future requests.
### 8.4 Matching and Booking

- **FR-M-001:** Eligibility filtering — every candidate is filtered by role type, compliance status, availability, travel feasibility, legal work eligibility, and employer-specific restrictions before entering the ranking.
- **FR-M-002:** Candidate ranking — ranked by skills fit, sector experience, distance and travel time, reliability, acceptance probability, employer and worker preference signals, prior feedback, pay alignment, and shift urgency.
- **FR-M-003:** Explainable shortlist — employer sees a plain-English reason for each recommendation.
- **FR-M-004:** Worker offer card — role, location, time, pay, travel, employer context, fit explanation, and countdown to accept.
- **FR-M-005:** Broadcast strategies — simultaneous top-N, sequential, preferred-first, known-worker-only, auto-book, manual approval.
- **FR-M-006:** Booking confirmation — worker and employer both receive full assignment details; calendar entry created; backup plan stored.
- **FR-M-007:** Agent-to-agent negotiation — at L3+, V negotiates pay within defined guardrails. All negotiation events are logged.
### 8.5 Shift Lifecycle

- **FR-S-001:** Pre-shift readiness — V checks worker confirmation, travel risk, compliance validity, and site instructions 60–90 minutes before shift start.
- **FR-S-002:** Check-in and check-out — mobile app with GPS, timestamp, and optional photo. Phase 1: geofenced check-in.
- **FR-S-003:** Self-healing replacement — risk detection triggers automatic backup search, employer notification, and audit entry.
- **FR-S-004:** Post-shift feedback — employer and worker both receive a simple, fast feedback prompt. Results feed into the fit graph and Passport.
- **FR-S-005:** Timesheet generation — auto-generated from check-in/out and booking data. Employer approval workflow.
- **FR-S-006:** Dispute handling — workers and employers can flag timesheet or attendance discrepancies for human review.
### 8.6 Payments and Invoicing

- **FR-P-001:** Invoice generation — auto-generated from approved timesheets. Employer can download, export to finance system, or receive by email.
- **FR-P-002:** Payroll export — worker earnings exported in compatible format for payroll processing.
- **FR-P-003:** Transparent cost breakdown — worker pay, Viora fee, and total cost visible on every booking and invoice.
- **FR-P-004:** Spend reporting — by employer, site, role, worker, and period.
- **FR-P-005:** Viora Pay (Phase 1) — earned wage access for workers. Subject to legal review, cost transparency requirements, and usage monitoring.
### 8.7 Platform Administration

- **FR-A-001:** Admin console — Viora internal team can manage employers, workers, bookings, compliance flags, disputes, fraud alerts, and market health.
- **FR-A-002:** Ops Agent dashboard — unfilled shifts, fill probability alerts, worker supply gaps, anomalous patterns, and support queue.
- **FR-A-003:** Compliance management — document review, verification workflow, expiry alerts, and eligibility override with audit trail.
- **FR-A-004:** Audit logs — all system and agent actions logged with actor, timestamp, decision inputs, and outcome. Immutable.
- **FR-A-005:** Human override — any AI-generated recommendation or autonomous action can be reviewed and overridden by an authorised human. Override is logged.
## 9. Trust, Security, Safety, and Compliance

### 9.1 Data Security Baseline

Viora holds safeguarding-sensitive, identity-linked, compliance, attendance, and payment data. The security baseline is non-negotiable and non-deferred:

Tenant isolation — employer and worker data is strictly isolated at the data layer.

RBAC — role-based access control with least-privilege principle. Finance users cannot access compliance documents. Read-only auditors cannot modify data.

MFA — mandatory for all roles with access to compliance documents, personal data, or financial data.

Data minimisation — Viora holds only what is required for the matching, compliance, and payment functions.

Encryption at rest and in transit — all personal and compliance data encrypted.

Access logs — all access to sensitive data is logged and reviewable.

Secure document storage — compliance documents stored with access controls, not general file storage.

Fraud and abuse detection — duplicate account detection, anomalous pattern flagging, GPS spoofing detection in Phase 1.

### 9.2 AI Safety and Governance

Viora's AI governance baseline applies to every autonomous action V takes:

V cannot fabricate compliance status, legal eligibility, pay rates, qualifications, or safeguarding outcomes. All such decisions are based solely on verified data.

Every autonomous action is explainable — V can produce a plain-English reason for any recommendation or decision.

Human override is always available — no AI action is irreversible without a human approval step in the loop.

Audit trail — all AI reasoning inputs, outputs, and actions are logged immutably.

Escalation paths — defined for every autonomous action type. If V cannot resolve with confidence, it flags for human review.

No bias amplification — matching signals are reviewed for potential indirect discrimination. Pay rate, protected characteristics, and score components are audited.

### 9.3 Compliance Framework — Education

The following compliance requirements are enforced as hard gates before any worker can be matched to an education booking:

Enhanced DBS certificate — current, appropriate type, and on the Update Service or re-issued within 3 years.

Right to work in the UK — verified from primary documents.

Proof of identity — in-person verification or biometric liveness (Phase 1) for digital onboarding.

QTS or non-QTS status — matched to role requirements. Non-QTS workers not matched to QTS-required roles.

Safeguarding training — current certificate required. Expiry tracked and re-verification prompted.

References — minimum two professional references, verified.

Prohibition from teaching register — checked at onboarding and periodically.

Overseas check — for workers with recent overseas residence, appropriate international clearance.

### 9.4 Compliance Framework — Security

SIA licence — valid, appropriate grade for role. Licence number verified against SIA register.

Right to work — as above.

Site-specific induction — tracked per site. Workers not matched to sites they have not been inducted for unless a standard induction is recorded.

First aid certification — tracked for applicable roles.

BS7858 screening — for roles requiring it.

### 9.5 Physical Worker Safety

For lone-worker, night-shift, and security roles, Viora provides:

Geofenced check-in verification — GPS-based confirmation that the worker is at the assigned site.

Welfare check prompts — V sends periodic check-in messages during lone-worker shifts. No response triggers an escalation.

Lone-worker safety escalation — defined contacts and escalation path for welfare non-response.

Incident logging — workers can log concerns or incidents through V during a shift.

Voice anti-spoofing detection (Phase 1) — for voice channel intake, V monitors for anomalous patterns that may indicate account compromise or spoofing.

### 9.6 Worker Reputation and Scoring — Principles

Viora collects reliability, feedback, and attendance data to improve matching. The following principles govern how this data is used:

Transparency — workers can view all data held about them that feeds their reliability profile.

Contestability — workers can dispute any feedback record or attendance event through a defined review process.

Proportionality — a single negative event does not exclude a worker from matching. Patterns over time, with context, inform recommendations.

Protected grounds exclusion — no data point that is a proxy for a protected characteristic under the Equality Act 2010 may feed into matching scores.

Legitimate cancellation protection — cancellations due to illness, caring responsibilities, disability-related needs, or unsafe workplace conditions are flagged as protected and excluded from adverse scoring.

Human review before exclusion — no worker is excluded from matching with an employer based solely on an algorithmic score. A defined human review step is required for any adverse outcome.

### 9.7 Legal and Regulatory Considerations

The following legal areas require specialist review before launch or before specific features ship:

Employment status — Viora must determine before launch whether it is operating as an employment agency, an employment business, a software platform, or a managed marketplace in each vertical. This materially affects obligations under the Employment Agencies Act 1973, AWR, IR35, and the Employment Rights Act 2025.

Data protection — processing of biometric data, DBS data, and children's safeguarding data requires a lawful basis, appropriate DPIA, and sector-specific regulatory compliance.

Viora Pay — FCA review required before earned wage access ships. Must confirm whether the specific product structure triggers regulated activity, and if not, how to meet consumer-protection standards voluntarily.

Employment Rights Act 2025 — requirements around guaranteed hours for qualifying workers, predictable work obligations, and fair dismissal changes are in rollout. Viora's platform design should anticipate employer obligations rather than inadvertently helping clients evade them.

WhatsApp Business API — commercial use of WhatsApp for transactional messaging requires compliance with Meta's Business Messaging Policy, including user opt-in, message type restrictions, and template pre-approval for automated messages.

## 10. Core Domain Model

The following core entities are shared across all verticals. Vertical-specific extensions add sector-specific compliance fields and role types without changing the underlying model.

| Entity | Description |
| --- | --- |
| **Organisation** | An employer — a school, MAT, security firm, or multi-site operator. Has sites, users, compliance policies, rate cards, and booking history. |
| **Site** | A specific location within an organisation. Has its own compliance requirements, induction records, and site instructions. |
| **Worker** | A person offering flexible work. Has a profile, compliance status, availability, preferences, and a Viora Passport. |
| **Passport** | The worker's portable verified credential. Contains identity, compliance, work history, reliability data, and sector eligibility flags. |
| **Booking Request** | An employer's expressed staffing need — structured (from a form) or unstructured (from V intake). |
| **Match** | A candidate evaluation produced by the Market Agent for a specific booking request and worker. Contains scores, reasoning, and offer parameters. |
| **Offer** | A shift offer sent to a worker. Contains booking details, pay, fit explanation, countdown, and accept/decline status. |
| **Booking** | A confirmed placement — employer, worker, site, role, time, pay, compliance snapshot, and backup plan. |
| **Shift** | A live or completed instance of a booking. Tracks check-in, check-out, attendance status, and events. |
| **Timesheet** | Derived from shift data. Employer approves, triggers payment calculation. |
| **Invoice** | Generated from approved timesheets. Sent to employer for payment. |
| **Conversation** | A multi-turn interaction between V and an employer or worker. Stored with intent, extracted entities, and action outcomes. |
| **Agent Memory** | Persistent context for each employer and worker held by their context agent. Preferences, history, patterns, and learned rules. |
| **Audit Event** | An immutable record of every system action, AI decision, and human override. Actor, timestamp, inputs, outputs, and outcome. |
| **GuardrailPolicy** | The set of constraints defining what V can and cannot do autonomously for a specific employer or worker. |
| **Negotiation Record** | An auditable record of any agent-to-agent pay negotiation: inputs, constraints, outcome, and plain-English explanation. |
| **Feedback** | Post-shift feedback from employer or worker. Stored with shift, aggregated into Passport and fit graph, contestable. |

## 11. Product Surfaces

### 11.1 Employer Web App

Dashboard: fill rate, open requests, active bookings, spend summary, compliance alerts

Request creation: V chat interface, structured form fallback

Booking management: active, confirmed, completed, cancelled

Worker management: preferred workers, Passport view, feedback history

Compliance centre: document status by worker, expiry alerts, eligibility report

Finance: invoices, spend by site/role/period, agency comparison report

Organisation settings: users, roles, sites, rate cards, approval policies, GuardrailPolicy

Reports and audit: booking history, AI decision log, compliance audit trail

### 11.2 Employer Mobile App

Optimised for cover manager morning workflow: fast request creation, status tracking, confirmation receipt

V chat as primary interface — voice note or text

Push notifications: fill confirmations, self-healing alerts, check-in status

Simplified booking view and worker card

### 11.3 Worker Mobile App

Opportunity feed: ranked swipe deck, shift details, countdown

V chat: ask V anything about shifts, pay, compliance, or availability

Compliance dashboard: document status, expiry alerts, what to upload next

Earnings tracker: completed shifts, pending pay, earnings goals, Viora Pay access (Phase 1)

Passport view: all verified credentials, work history, feedback summary

Availability and preferences: schedule, auto-accept rules, role and travel preferences

Shift management: upcoming shifts, check-in, instructions, incident log

### 11.4 Platform Admin Console (Internal)

Ops Agent dashboard: unfilled shifts, fill probability alerts, supply gaps

Worker management: onboarding queue, compliance verification, Passport oversight

Employer management: account status, booking activity, support issues

Compliance review: document verification queue, manual override log

Fraud and safety: anomalous pattern flags, GPS events, account investigation tools

Market health: supply/demand by geography, role type, and time

Financial controls: invoice management, payment processing, Viora Pay monitoring

### 11.5 Conversational Channels

WhatsApp Business API: employer and worker intake, status updates, confirmations, and support

In-app chat: V interface embedded in employer and worker apps

Voice call (Phase 1): Viora phone line, V handles intake, status, and confirmation by voice

In-app voice note: workers and employers can send voice notes directly to V within the app

## 12. MVP Scope — Phase 0 Pilot

### 12.1 Pilot Parameters

The Phase 0 pilot proves three things: employers will talk to V instead of filling in a form; the swipe deck outconverts a list view; and two-sided agentic matching reduces time-to-fill versus rules-based shortlisting. Nothing else needs to be proven in Phase 0.

| Parameter | Target |
| --- | --- |
| **Geography** | One dense local cluster — city or borough |
| **Employers** | 3–10 schools, or one MAT / local cluster |
| **Workers** | 50–200 directly sourced and vetted workers |
| **Roles** | Supply teacher, cover supervisor, TA/LSA, invigilator |
| **Duration** | One full term minimum (10–12 weeks) |
| **Compliance** | Manual verification by Viora ops team — no automated API integrations in Phase 0 |
| **Intake** | Natural language text (app and WhatsApp); voice note optional |
| **Worker UX** | Opportunity feed with accept/decline; swipe deck as prototype or pilot A/B test |
| **Autonomy level** | L1–L2 for most employers; no L3+ without explicit track record |
| **Payroll** | Export to manual payroll; no direct Viora payment processing in Phase 0 |

### 12.2 Must-Have for Phase 0

V-powered natural language intake (text and WhatsApp)

Structured booking creation and confirmation

Compliance eligibility gates — deterministic, based on manually verified data

Candidate ranking and explainable shortlist

Worker opportunity feed with accept/decline

Booking confirmation to both sides

Check-in and check-out (mobile app, GPS timestamp)

Self-healing replacement flow (basic — backup candidate identified at booking time, manual rebroadcast)

Employer preferences and basic GuardrailPolicy

Timesheet generation from check-in/out data

Timesheet approval workflow

Invoice and payroll export

Employer web dashboard and worker mobile app

Admin console with ops oversight

Audit logs for all bookings and AI actions

Human override on all AI recommendations

### 12.3 Should-Have for Phase 0

Swipe deck UX (A/B tested against standard accept/decline list)

Live fill probability before request submission

WhatsApp voice note intake

Worker auto-accept rules

Employer memory and preference learning

Post-shift feedback collection

Basic earnings tracker in worker app

### 12.4 Not Phase 0 — Staged Into Later Phases

Phone line voice agent (Phase 1)

Viora Passport — full portable credential (Phase 1)

Geofenced check-in and biometric liveness (Phase 1)

L3+ agent-to-agent pay negotiation (Phase 1, after track record)

Viora Pay — earned wage access (Phase 1, legal review first)

Security vertical (Phase 1)

Viora Connect — agency supply API (Phase 2)

Full automated compliance verification APIs (Phase 1–2)

Multi-vertical cross-sector worker utilisation (Phase 2)

L4 full autonomy (Phase 3)

## 13. Roadmap

| Phase | Focus | Headline Outcome | Key Features |
| --- | --- | --- | --- |
| **Phase 0** (0–6 months) | Conversational MVP, education pilot | Prove employers talk to V instead of filling in a form; prove swipe deck outconverts list view; prove agentic matching reduces time-to-fill | V text/WhatsApp intake, booking engine, candidate ranking, worker feed, check-in/out, timesheets, invoices, admin console |
| **Phase 1** (6–18 months) | Education at scale + Security vertical launch | Viora Passport live and reused across employers and verticals; Viora Pay live; security revenue generating; voice line launched | Passport v1, Viora Pay, phone voice agent, geofenced check-in, biometric liveness, SIA compliance bundle, L3 autonomy, self-healing v2 |
| **Phase 2** (18–30 months) | Viora Connect + Sector expansion | Agency supply integrated as on-ramp; true-cost-of-cover reporting as market standard; third vertical live | Viora Connect API, cross-sector utilisation engine, agency dashboard, true-cost benchmarking, additional vertical (care, hospitality, or events) |
| **Phase 3** (30+ months) | Full autonomy + Platform dominance | V trusted for L4 autonomous coordination; Viora positioned as the default infrastructure flexible work runs on | L4 autonomy, full marketplace liquidity, enterprise MAT and multi-site contracts, regulatory relationships, international expansion assessment |

## 14. Success Metrics

### 14.1 Phase 0 Proof Metrics

| Metric | Target | Why It Matters |
| --- | --- | --- |
| Conversational intake rate | ≥ 70% of requests created via V (WhatsApp, voice note, or in-app chat) | Proves employers will not use the form when V is available |
| Intent capture accuracy | ≥ 95% of conversational requests parsed correctly without human correction | Validates the NLP/LLM intake layer |
| Median time-to-fill (same day) | ≤ 12 minutes | Direct comparison to agency baseline (~45–90 minutes) |
| Fill rate (≤12 hours notice) | ≥ 90% | Baseline marketplace health |
| Swipe deck conversion vs. list view | ≥ 2× accept rate | Validates the worker UX thesis |
| Employer satisfaction | ≥ 8/10 (post-pilot survey) | Proves readiness to expand and refer |
| Worker NPS | ≥ 40 | Proves supply-side willingness to stay and grow |
| Compliance gate accuracy | 0 ineligible worker matches | Non-negotiable safety requirement |

### 14.2 Marketplace Metrics

Gross booking value (GBV) — total value of all confirmed bookings

Fill rate by role type, geography, and urgency level

Time-to-fill distribution — P50, P90

Unfilled shift rate — and reason breakdown

Worker acceptance rate by shift type

Repeat booking rate — workers rebooked by the same employer

No-show rate — and self-healing success rate

### 14.3 Employer Metrics

Active employers and monthly active employers

Bookings per employer per month

Cost per booking versus agency baseline

Conversational intake adoption rate

Employer churn rate

MAT and multi-site account penetration

### 14.4 Worker Metrics

Active workers and weekly active workers

Shifts completed per active worker per month

Earnings per active worker

Worker retention at 3 and 6 months

Compliance completion rate and time to first shift

Passport completion and reuse rate (Phase 1+)

Worker satisfaction and NPS

### 14.5 AI and Trust Metrics

AI decision audit completeness — all agent actions logged

Human override rate — decreasing over time signals growing trust

Compliance-blocked match attempts — should be low if worker pool is well-maintained

Fraud flags reviewed and resolved

V explanation usefulness rating (from employer and worker feedback)

Acceptance probability calibration — predicted vs. actual acceptance rate

## 15. Business Model

### 15.1 Recommended Initial Model: Full-Stack Managed Marketplace

Viora starts as a full-stack staffing operator — directly sourcing, vetting, and placing workers for employers. This is the right model for the pilot because:

It gives Viora complete control over service quality and the data flywheel.

It is the clearest agency replacement story for employers.

It generates direct revenue from the first booking without requiring a platform licence sale.

It lets Viora test and prove the matching, compliance, and experience layer before opening it to third parties.

### 15.2 Revenue Streams

| Stream | Model |
| --- | --- |
| **Booking margin** | Viora charges employers a per-booking rate that includes worker pay plus a transparent service fee (lower than agency margin). Primary Phase 0–1 revenue. |
| **Platform subscription** (Phase 1+) | MATs and larger employers pay a monthly subscription for premium features: advanced analytics, custom GuardrailPolicies, compliance reporting, API access. |
| **Viora Pay fee** (Phase 1+) | Small fee per earned wage access transaction. Worker-side revenue. Must be structured to comply with FCA guidance on cost transparency. |
| **Viora Connect API** (Phase 2) | Revenue share or API access fee for agencies plugging worker pools into the Viora marketplace. |
| **SaaS / white-label** (Phase 3) | Platform licence for large organisations or multi-employer groups managing their own directly sourced worker pools on the Viora infrastructure. |

### 15.3 Why Not SaaS First

A SaaS model requires Viora to sell a software licence before proving the product works at scale. It also means Viora has no control over supply quality in early pilots. The managed marketplace model lets Viora control both sides of the experience, prove outcomes, and build the data flywheel before opening the infrastructure to third parties. SaaS and agency transformation are the right models for Phase 2–3, not Phase 0.

## 16. Competitive Positioning

### 16.1 Competitive Landscape

| Competitor | Model | What They Get Right | Where Viora Wins |
| --- | --- | --- | --- |
| Traditional agencies (Timeplan, Capita, etc.) | Service-led, minimal tech, human dispatch | Deep employer relationships, large pools, compliance knowledge | Viora eliminates the human dispatch layer and its cost, makes compliance portable, and gives both sides an agent |
| Indeed Flex | Flexible-work app, 'Lexi' support chatbot, Instant Pay | Proven instant-booking UX, fast pay, large worker base, UK presence | Lexi is support chat, not a negotiating agent. Worker UX is list/browse, not proactive swipe deck. No compliance layer for regulated work |
| Job&Talent | Global workforce marketplace, AI agent 'Clara' | Strong AI positioning, scale, dedicated AI recruiter agent | Clara is single-sided (recruiter-facing), not agent-to-agent. Not education- or security-specialised. No compliance moat |
| Jack & Jill (AI hiring) | Dual-agent AI hiring: candidate agent + recruiter agent | Genuinely two-sided agent concept, well-funded | White-collar permanent hiring only. No shift-based workflow, no compliance layer, no physical attendance verification |
| Teacher Booker / SupplyBank | Education-specific direct booking platforms | Direct bookings, MAT pools, MIS integration, cost transparency | Education-only, not AI-native, no agent-to-agent layer, no cross-sector worker utilisation, no Passport |
| Cover tools (Satchel, EdCover) | Internal cover management / timetabling | Good for internal staff allocation | Don't source external supply at all. Still hand off to agencies or platforms for external workers |

### 16.2 Positioning Thesis

> "Job&Talent gave the recruiter an AI agent. Indeed Flex gave the worker instant booking and instant pay. Viora gives both sides a real agent that works for them continuously, lets the employer say what they need instead of filling in a form, and replaces the thing agencies still do better than every digital platform — vetting once, reusably — with a portable Passport. We start in education and security because compliance complexity is highest there, and we expand the same agentic core into every other sector once it is proven."

### 16.3 Defensibility Over Time

**Viora's moat compounds from three sources:**

The Passport network effect. The more employers and verticals accept a worker's Passport, the more painful it becomes for either side to leave Viora. A worker with a 3-year verified compliance record and a Passport accepted by 40 schools does not want to start from scratch on a competitor platform.

The fit graph flywheel. Every booking, cancellation, check-in, and feedback event makes Viora's matching more accurate. This advantage is impossible to copy without the data.

Founder-market fit in compliance-heavy sectors. The hardest barrier to entry in education and security is not the tech — it is the credibility and relationships required to get schools and security firms to trust a new platform with safeguarding-sensitive and safety-critical worker data. Viora's founding team has this. Generalist platforms do not.

## 17. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Marketplace cold start — not enough workers or employers in one geography | Start with one dense cluster. Target one MAT for employer density. Recruit specific high-demand roles. Use manual ops to guarantee service quality. Focus on repeatable patterns before expanding. |
| Compliance failure — ineligible worker matched to a role | Compliance gates are deterministic, not probabilistic. Manual verification for Phase 0. No AI inference on eligibility. Conservative pilot with direct oversight. |
| AI over-automation — V makes a booking or sends a message that creates legal, safeguarding, or trust issues | Human approval for high-risk actions. Strict communication templates. L1–L2 autonomy ceiling for Phase 0. Reviewable decision logs. No V action that cannot be reversed. |
| Worker trust — workers see Viora as another extractive gig platform | Transparent pay. Full preference control. Fair and protected cancellation policy. Portable, worker-owned reputation. Clear communication. Viora Pay as demonstration of genuine alignment with worker interests. |
| Employer trust — schools do not trust AI-led staffing with safeguarding obligations | Position V as operational support, not a compliance shortcut. Human support team during all pilots. Show audit trails and compliance evidence proactively. Build and publish references from early schools. |
| Legal complexity — employment status, payroll, tax, safeguarding, and sector regulations | Specialist legal review before launch. Start with a narrow, clearly-defined operating model. Avoid ambiguous worker classification. Payroll export before direct payment processing in Phase 0. |
| Competitive response — Indeed Flex or Job&Talent deepens AI layer | Viora's moat is the Passport, the fit graph, and the compliance layer — not the AI surface alone. A generalist platform cannot copy Viora's compliance credibility in education and security without rebuilding from scratch. |
| Viora Pay regulatory risk — FCA classifies the product as regulated credit | FCA specialist review before shipping. Build with cost transparency and usage monitoring from the start. Scope feature conservatively until regulatory position is confirmed. |
| Worker reputation scoring — indirect discrimination or unfair adverse outcomes | Defined scoring inputs and exclusions. Protected cancellation policy. Worker visibility and contestability of all data. Human review required before any adverse outcome. Regular bias audit. |

## 18. Open Questions

Which geography for the first pilot? What is the density of target schools and what is the addressable worker pool within a 45-minute commute radius?

What is the minimum compliance bar that a real MAT pilot requires before Viora can begin placing workers? Is manual document verification sufficient, or is a more formal compliance infrastructure required from day one?

What is the right autonomy level for the pilot employers? Should all Phase 0 employers start at L1, or should some trusted early adopters be offered L2 from the start?

Does Viora operate as an employment agency or employment business in Phase 0, and what does this mean for worker contracts, payroll obligations, and HMRC reporting?

Should WhatsApp voice note intake be Phase 0 or Phase 1? The accuracy requirement is high and the failure mode (misunderstood request) is visible to the employer.

What is the worker acquisition strategy for Phase 0? Direct outreach, social, referral from existing agency networks, or a combination?

How is the employer-side pricing structured to be transparently cheaper than agencies while building a viable margin? What is the target take rate?

Which external compliance verification APIs (DBS Update Service, SIA register, QTS register) are available and what is the integration timeline for Phase 1?

What should the worker trust score explicitly include and exclude? What is the worker's right to explanation and appeal?

Should the Phase 0 worker app be native iOS/Android, or React Native / web-first to accelerate build time?

At what point does Viora begin actively converting Viora Connect agency workers into direct Passport holders? What is the incentive structure for the worker?

Is there a path to regulatory pre-approval or formal safeguarding endorsement from a relevant body (e.g., a local authority, a DfE-recognised scheme) that would materially accelerate employer trust?

## 19. Next Product Artefacts

Employer journey map — urgent school cover from 6:50am WhatsApp message to confirmed booking. Every V interaction, decision point, and fallback path made explicit.

Worker journey map — first contact to first completed shift. Onboarding, compliance, first offer, swipe, check-in, payment, and feedback.

AI agent architecture — tools, memory structures, permissions model, GuardrailPolicy schema, and human approval trigger points for each agent.

Data model — entity definitions, relationships, access controls, and tenant isolation design.

Matching algorithm spec — ranking signals, weights, acceptance probability model, and broadcast strategy logic.

Compliance workflow spec — education first: every document type, verification step, expiry rule, and eligibility gate.

MVP clickable prototype — employer WhatsApp → V intake → shortlist → worker swipe deck → booking confirmation.

Pilot sales deck — for MAT or school cluster. Positions Viora against agency baseline, makes the compliance story central, and includes a clear pilot offer.

Worker acquisition plan — channels, messaging, onboarding conversion target, and compliance completion rate assumptions.

Security threat model — covering data, identity, compliance integrity, and physical worker safety.

Legal review brief — employment status, Viora Pay, WhatsApp API, worker scoring, and ERA 2025 obligations.

## 20. External Positioning Statement

## VIORA — ONE LINE

Viora is the AI-native operating system for flexible work: tell V what you need, and it fills it.

## VIORA — FULL POSITIONING

Viora is the AI-native operating system for flexible work. Employers tell V what they need — by app, by WhatsApp, or by phone — and Viora finds, verifies, books, confirms, tracks, and replaces cover if anything changes. Every worker has their own side of V, finding them their next best-paid, best-fit shift automatically and building a portable Passport of verified credentials they own and carry across every employer and sector they work in. We start in schools and security because that is where compliance and trust matter most — and we are architected to replace every agency and every first-generation booking app in every sector where temp staffing still means a phone call.

—

VIORA  |  v2.0  |  June 2026  |  CONFIDENTIAL
