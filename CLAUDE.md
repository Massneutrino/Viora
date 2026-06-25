# Viora — Claude Code Quick Reference

Full guide: `DEVELOPMENT.md`. This file is the auto-loaded subset for Claude Code.

## Critical Rules

**Before any commit or push**, update the docs:
- `docs/TODO_PHASE0.md` — mark completed items ✅
- `docs/ROADMAP.md` — update if scope or approach changed
- `DEVELOPMENT.md` — update if setup, ports, or conventions changed

**Compliance is always deterministic** — use `isEligibleForEducationBooking()` in `packages/domain/src/education.ts`. Never ask an LLM to infer compliance eligibility.

**New LLM-backed agents** — use `createLLMClient()` from `packages/agents/src/llm.ts`. Call `.complete()` for text generation or `.structured<T>()` for forced structured output. Provider and model are set via `AI_PROVIDER` / `AI_MODEL` env vars — never hardcode a model name or import a provider SDK directly in agent files. Keep stubs in `stubs.ts` until wired end-to-end.

**Every agent action writes an `AuditEvent` row** — no silent side-effects.

**Phase 0 scope** lives in `packages/domain/src/phase0.ts`. Don't build outside it without flagging.

**Shared UI** — the V identity (pixel-sphere) and the responsive `AppShell` live in `packages/ui` (`@viora/ui`), consumed by both web apps via `transpilePackages`. Put cross-app components there, not duplicated per app. The brand accent is the single `ACCENT` token in `PixelSphere.tsx`.

## Key Files

| File | Purpose |
|---|---|
| `apps/api/src/index.ts` | API server, agent wiring, Fastify decorator types |
| `apps/api/src/routes/intake.ts` | V intake route — parse → persist → confirm |
| `packages/agents/src/llm.ts` | Provider-agnostic LLM client (`createLLMClient`) |
| `packages/agents/src/v-agent.ts` | Real V agent (provider-agnostic via `createLLMClient`) |
| `packages/agents/src/stubs.ts` | Stub agents for unimplemented features |
| `packages/domain/src/phase0.ts` | `PHASE_0_MUST_HAVE` — 17 MVP items |
| `packages/domain/src/education.ts` | Deterministic compliance gates |
| `packages/database/prisma/schema.prisma` | Full data model |
| `packages/ui/src/components/PixelSphere.tsx` | V identity — 3D pixel-sphere (canvas), `ACCENT` brand token |
| `packages/ui/src/components/AppShell.tsx` | Responsive shell — desktop side-rail / mobile bottom-nav + sphere hero |
| `docs/TODO_PHASE0.md` | MVP engineering backlog (keep this current) |

## Ports

| Service | Port |
|---|---|
| API | 6200 |
| Public site | 6103 |
| Employer web | 6100 |
| Admin console | 6101 |
| Worker web preview | 6102 |
| Worker mobile Expo/Metro | 8100 |

## DB (local, no Docker)

`postgresql://viora:viora@localhost:5432/viora` — PostgreSQL 17 Windows service.
