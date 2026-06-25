# Viora Development Guide

AI-native staffing OS for regulated sectors. Phase 0 wedge: UK education (supply teachers, TAs, cover supervisors).

---

## Monorepo Layout

```
apps/
  api/        Fastify REST API — port 6200
  site/       Public website (Next.js) — port 6103
  web/        Employer dashboard (Next.js) — port 6100
  admin/      Ops console (Next.js) — port 6101
  worker-web/ Worker swipe deck preview (Next.js) — port 6102
  mobile/     Worker swipe deck (Expo/React Native) — Metro port 8100
packages/
  domain/     Shared TypeScript types, Phase 0 scope constants, education compliance gates
  database/   Prisma schema + PostgreSQL client singleton
  agents/     Agent interfaces, stubs, and LLM-backed implementations
  ui/         Shared React UI — V pixel-sphere identity, responsive AppShell, settings primitives (SectionCard/EditableField/etc.) (web + worker-web)
  tsconfig/   Shared TypeScript configurations
```

---

## Dev Setup

```bash
npm install
npm run dev          # starts dev workspaces via Turbo on pinned ports
```

Local ports are pinned in workspace scripts:
- API: 6200
- Public site: 6103
- Employer web: 6100
- Admin console: 6101
- Worker web preview: 6102
- Worker mobile Expo/Metro: 8100 (`npm run dev:mobile`)
- Secondary Expo/Metro slot: 8101 (`npm run dev:mobile:secondary`)

**Database**: PostgreSQL running locally (no Docker required for local dev). The `docker-compose.yml` is available if you prefer containers.

- Host: `localhost:5432`, DB: `viora`, user: `viora`, password: `viora`
- Schema managed via Prisma: `npm run db:migrate`
- Seed demo data: `npm run db:seed`
- All Prisma scripts require `--env-file ../../.env` (already scripted in `packages/database/package.json`)

**Demo sandbox**: open the admin console at http://localhost:6101 and use **Dev tools -> Demo sandbox** for deterministic end-to-end runs. The API lives under `/v1/admin/sandbox/*`; reset clears only sandbox-tagged data (`[sandbox:<runId>]`) and keeps seeded avatars available.

**Memory stack**: structured memories live in `MemoryEntry` / `MemoryEdge`. CRUD is under `/v1/{organisations|workers}/:id/memory`; admin pending review is `GET /v1/admin/memory/pending`. In the admin console use **Dev tools -> Memory lab** to seed/edit demo memories and **Memory review** to confirm inferred entries. Smoke test: `npm run test:memory`.

**Public site (`apps/site`, http://localhost:6103)**: voice-first hero — heading + animated typewriter subheading, V as the centerpiece, a **Speak with V** CTA that opens an inline voice conversation (speech-to-text + `speechSynthesis`, with typed fallback). It calls `POST /v1/pilot/chat` (consent-gated, audited lead capture; shares `createPilotLead` with `POST /v1/pilot/leads`). Readiness/intent are decided server-side, not by the LLM; the chat turn may include a `remembered` note (Viora Memory). A quick-form modal and `/register` (Sign-in target) also create pilot leads. Requires the API on :6200. Env: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL` (OG metadata).

**Waitlist → access**: pilot leads (from chat, the quick-form modal, or `/register`) land in the admin **Pilot leads** tab (http://localhost:6101). **Approve & mint** calls `POST /v1/admin/pilot/leads/:id/approve`, which upserts the real `Organisation`/`Worker` (deterministic ids, idempotent) and returns a `?orgId=`/`?workerId=` access link into the employer (:6100) / worker (:6102) app. The API builds those links from `WEB_URL` / `WORKER_WEB_URL` (default localhost 6100/6102). Interim demo access until real auth replaces it.

**Environment**: copy `.env.example` → `.env` and fill in:
- `DATABASE_URL` — already set for local dev (postgresql://viora:viora@localhost:5432/viora)
- `JWT_SECRET` — any string for local dev
- `AI_PROVIDER` — `anthropic` (default) or `google`
- `ANTHROPIC_API_KEY` — required when `AI_PROVIDER=anthropic`
- `GOOGLE_API_KEY` — required when `AI_PROVIDER=google`
- `AI_MODEL` — optional; overrides the default model for the selected provider

> **Always run `npm run dev` from the repo root.** Running `tsx watch src/index.ts` from inside `apps/api` skips the dotenv wrapper and leaves `DATABASE_URL` and the AI key unset. The API will exit immediately with a clear error if any required var is missing.

---

## Coding Conventions

- **TypeScript strict mode** everywhere; no `any` without a comment explaining why
- **ESM modules** — always use `.js` extension in import paths (e.g. `import … from "./types.js"`)
- **Zod** for all API boundary validation in `apps/api/src/routes/`
- **Prisma** for all DB access — no raw SQL
- **No `console.log`** in production paths; use structured logging or omit
- All new packages use `"type": "module"` in `package.json`
- Line endings are normalized by `.gitattributes`: LF for repo text files, CRLF for Windows `.bat`/`.cmd` scripts
- Local agent/editor state is ignored in `.gitignore`; keep shared instructions trackable (`AGENTS.md`, `CLAUDE.md`, `.cursor/rules/`)

---

## Agent Rules

The agent layer lives in `packages/agents/`. Key rules:

**Compliance is always deterministic.**
Use `isEligibleForEducationBooking()` from `packages/domain/src/education.ts`. Never ask an LLM to infer or estimate compliance eligibility — the gates are binary and legally required.

**New LLM-backed agents:**
- Import `createLLMClient` from `packages/agents/src/llm.ts`
- Use `.complete({ system, prompt })` for text generation
- Use `.structured<T>({ system, prompt, toolName, toolDescription, schema })` for forced structured output
- Provider (`AI_PROVIDER`) and model (`AI_MODEL`) come from env — never hardcode a model name or import a provider SDK in agent files
- Keep the stub in `stubs.ts` until the real agent is wired end-to-end and manually tested

**Every agent action must be auditable.**
Write an `AuditEvent` row for every agent decision: `actorType`, `actorId`, `action`, `entityType`, `entityId`, `inputs`, `outputs`, `outcome`. No silent side-effects.

**Guardrail policies are not optional.**
Before any agent takes an autonomous action, fetch the `GuardrailPolicy` for the organisation (or worker) and enforce `autonomyLevel`, `budgetCeiling`, `payFloor`, and `approvedRoleTypes`. If the action exceeds the policy, set `requiresHumanApproval: true` and queue it — never proceed silently.

**Phase 0 scope is the source of truth.**
`packages/domain/src/phase0.ts` defines `PHASE_0_MUST_HAVE` (17 items) and `PHASE_0_SUCCESS_METRICS`. Don't build beyond Phase 0 scope without flagging it.

---

## Key Constants

| Constant | Value | Location |
|---|---|---|
| `PHASE_0.defaultAutonomyLevel` | `"l2"` | `packages/domain/src/phase0.ts` |
| `PHASE_0.clusterSize` | 3–10 employers, 50–200 workers | same |
| Intent accuracy target | 95% | `PHASE_0_SUCCESS_METRICS.intentAccuracy` |
| Time-to-fill target | ≤ 12 min | `PHASE_0_SUCCESS_METRICS.medianTimeToFillMinutes` |
| Fill rate target | 90% | `PHASE_0_SUCCESS_METRICS.fillRate` |

---

## Build & Type-Check

```bash
npm run build        # build all packages and apps
npm run typecheck    # type-check everything via Turbo
npm run lint         # lint all workspaces
```

Build order is dependency-aware via Turbo: `domain` → `database` → `agents` → apps.

---

## Document Maintenance

**Update project docs when making a commit or push — not after every edit.**

Before committing or pushing, check and update:
- `docs/TODO_PHASE0.md` — mark completed items ✅; add any new sub-tasks discovered
- `docs/ROADMAP.md` — update if scope, timeline, or approach changed
- `DEVELOPMENT.md` — update if setup steps, ports, conventions, or env vars changed

This applies to all contributors — human or AI. Tying updates to commits keeps the docs accurate without interrupting flow mid-task.
