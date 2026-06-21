# Viora — Claude Code Quick Reference

Full guide: `DEVELOPMENT.md`. This file is the auto-loaded subset for Claude Code.

## Critical Rules

**Before any commit or push**, update the docs:
- `docs/TODO_PHASE0.md` — mark completed items ✅
- `docs/ROADMAP.md` — update if scope or approach changed
- `DEVELOPMENT.md` — update if setup, ports, or conventions changed

**Compliance is always deterministic** — use `isEligibleForEducationBooking()` in `packages/domain/src/education.ts`. Never ask an LLM to infer compliance eligibility.

**New LLM-backed agents** — model `claude-opus-4-8`, thinking `{ type: "adaptive" }`, SDK `@anthropic-ai/sdk`. Keep stubs in `stubs.ts` until wired end-to-end.

**Every agent action writes an `AuditEvent` row** — no silent side-effects.

**Phase 0 scope** lives in `packages/domain/src/phase0.ts`. Don't build outside it without flagging.

## Key Files

| File | Purpose |
|---|---|
| `apps/api/src/index.ts` | API server, agent wiring, Fastify decorator types |
| `apps/api/src/routes/intake.ts` | V intake route — parse → persist → confirm |
| `packages/agents/src/v-agent.ts` | Real V agent (Claude-backed) |
| `packages/agents/src/stubs.ts` | Stub agents for unimplemented features |
| `packages/domain/src/phase0.ts` | `PHASE_0_MUST_HAVE` — 17 MVP items |
| `packages/domain/src/education.ts` | Deterministic compliance gates |
| `packages/database/prisma/schema.prisma` | Full data model |
| `docs/TODO_PHASE0.md` | MVP engineering backlog (keep this current) |

## Ports

| Service | Port |
|---|---|
| API | 4000 |
| Employer web | 3100 |
| Admin console | 3101 |

## DB (local, no Docker)

`postgresql://viora:viora@localhost:5432/viora` — PostgreSQL 17 Windows service.
