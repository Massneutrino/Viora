# Viora

**AI-native operating system for flexible and temporary work.**

Employers tell V what they need — by app, WhatsApp, or phone — and Viora finds, verifies, books, confirms, tracks, and replaces cover if anything changes. Workers get a personal agent that surfaces their next best shift as a single card to swipe right or left.

> North star: fill every eligible shift with the best available compliant worker at the right price, with no human coordination required.

## Phase 0 Pilot (current)

Education sector wedge — supply teachers, cover supervisors, TA/LSA, invigilators in one dense local cluster.

| Surface | Package | Port |
|---------|---------|------|
| Employer web app | `@viora/web` | 3000 |
| Admin console | `@viora/admin` | 3001 |
| Worker mobile app | `@viora/mobile` | Expo |
| API | `@viora/api` | 4000 |

## Monorepo structure

```
apps/
  api/       Fastify REST API + agent orchestration
  web/       Employer dashboard (Tell V intake)
  admin/     Internal ops console
  mobile/    Worker swipe deck (Expo)
packages/
  domain/    Shared types, Phase 0 scope, education compliance gates
  database/  Prisma schema + PostgreSQL client
  agents/    Agent interfaces + stubs (V, Market, Compliance, Ops)
  tsconfig/  Shared TypeScript configs
```

## Prerequisites

- Node.js 20+
- Docker (for PostgreSQL)
- npm 10+

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Start PostgreSQL
docker compose up -d

# 3. Configure environment
cp .env.example .env

# 4. Generate Prisma client and run migrations
npm run db:generate
npm run db:migrate

# 5. Start all apps in dev mode
npm run dev
```

Open:
- Employer app: http://localhost:3000
- Admin console: http://localhost:3001
- API: http://localhost:4000

For mobile: `npm run dev --workspace @viora/mobile` (requires Expo Go or simulator).

## Agent architecture

| Agent | Role |
|-------|------|
| **V** | User-facing voice across all channels |
| **Employer Context** | Works each open booking |
| **Worker Context** | Surfaces ranked opportunities |
| **Market** | Clears supply and demand |
| **Trust & Compliance** | Deterministic eligibility gates |
| **Ops** | Internal team support |

Phase 0 runs at autonomy levels L1–L2. All agent actions are auditable; human override is always available.

## Key principles

- **Intent over forms** — natural language intake first
- **Trust before speed** — compliance gates are deterministic, never probabilistic
- **Transparent economics** — worker pay, Viora fee, and total cost visible on every booking

## Documentation

- [Product Requirements Document (PRD v2)](./docs/Viora_PRD_v2.md) — full product spec (CONFIDENTIAL)
- [Architecture](./docs/ARCHITECTURE.md) — system design aligned with PRD v2

## License

Proprietary — CONFIDENTIAL
