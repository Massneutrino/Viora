# Viora Development Guide

AI-native staffing OS for regulated sectors. Phase 0 wedge: UK education (supply teachers, TAs, cover supervisors).

---

## Monorepo Layout

```
apps/
  api/        Fastify REST API — port 6200
  web/        Employer dashboard (Next.js) — port 6100
  admin/      Ops console (Next.js) — port 6101
  worker-web/ Worker swipe deck preview (Next.js) — port 6102
  mobile/     Worker swipe deck (Expo/React Native)
packages/
  domain/     Shared TypeScript types, Phase 0 scope constants, education compliance gates
  database/   Prisma schema + PostgreSQL client singleton
  agents/     Agent interfaces, stubs, and LLM-backed implementations
  ui/         Shared React UI — V pixel-sphere identity + responsive AppShell (web + worker-web)
  tsconfig/   Shared TypeScript configurations
```

---

## Dev Setup

```bash
npm install
npm run dev          # starts api, web, admin via Turbo
```

**Database**: PostgreSQL running locally (no Docker required for local dev). The `docker-compose.yml` is available if you prefer containers.

- Host: `localhost:5432`, DB: `viora`, user: `viora`, password: `viora`
- Schema managed via Prisma: `npm run db:migrate`
- Seed demo data: `npm run db:seed`
- All Prisma scripts require `--env-file ../../.env` (already scripted in `packages/database/package.json`)

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
