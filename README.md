# Viora

**AI-native operating system for flexible and temporary work.**

Employers tell V what they need — by app, WhatsApp, or phone — and Viora finds, verifies, books, confirms, tracks, and replaces cover if anything changes. Workers get a personal agent that surfaces their next best shift as a single card to swipe right or left.

> North star: fill every eligible shift with the best available compliant worker at the right price, with no human coordination required.

## Phase 0 Pilot (current)

Education sector wedge — supply teachers, cover supervisors, TA/LSA, invigilators in one dense local cluster.

| Surface | Package | Port |
|---------|---------|------|
| Employer web app | `@viora/web` | 6100 |
| Admin console | `@viora/admin` | 6101 |
| Worker web preview | `@viora/worker-web` | 6102 |
| Worker mobile app | `@viora/mobile` | Expo / Metro 8100 |
| API | `@viora/api` | 6200 |

## Monorepo structure

```
apps/
  api/       Fastify REST API + agent orchestration
  web/       Employer dashboard (Tell V intake)
  admin/     Internal ops console
  worker-web/ Worker swipe deck (browser preview)
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
- Employer app: http://localhost:6100
- Admin console: http://localhost:6101
- Worker preview: http://localhost:6102
- API: http://localhost:6200

For mobile: `npm run dev:mobile` starts Expo/Metro on port 8100. Use `npm run dev:mobile:secondary` for a second Expo/Metro process on port 8101.

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

## Voice provider

V's reasoning, hearing and spoken voice are separate layers. Agent text generation uses
`createLLMClient()` (`AI_PROVIDER` / `AI_MODEL*`); speech-to-text and text-to-speech use the
backend voice provider layer so browser code never calls ElevenLabs, OpenAI or Azure directly.

| Capability | Route | Default |
|------------|-------|---------|
| Voice status | `GET /v1/voice/status` | Non-secret provider/model summary for browser fallback decisions |
| V speech output | `POST /v1/voice/speech` | Browser fallback when `VOICE_TTS_PROVIDER=disabled` |
| Audio transcription | `POST /v1/voice/transcribe` | Browser fallback when `VOICE_STT_PROVIDER=disabled`; OpenAI/Azure/Gemini when enabled |

Production TTS is configured with env vars such as `VOICE_TTS_PROVIDER=elevenlabs`,
`ELEVENLABS_API_KEY`, and `ELEVENLABS_VOICE_ID`. Repeated TTS output is cached by provider,
model, voice, ElevenLabs voice settings, style version, format, and text so common V lines play
back consistently. Production STT is selected with `VOICE_STT_PROVIDER=openai` plus
`OPENAI_TRANSCRIBE_MODEL=whisper-1`, `VOICE_STT_PROVIDER=azure` plus Azure Speech env vars, or
`VOICE_STT_PROVIDER=gemini` plus `GOOGLE_API_KEY` and optional `VOICE_STT_MODEL`. `AI_PROVIDER` /
`AI_MODEL*` still only control V's text reasoning; listening is controlled by `VOICE_STT_PROVIDER`.
See [DEVELOPMENT.md](./DEVELOPMENT.md) for setup and [DEMO_DATA.md](./docs/DEMO_DATA.md) for
copy/paste API examples.

## Key principles

- **Intent over forms** — natural language intake first
- **Trust before speed** — compliance gates are deterministic, never probabilistic
- **Transparent economics** — worker pay, Viora fee, and total cost visible on every booking

## Documentation

- [Product Requirements Document (PRD v2)](./docs/Viora_PRD_v2.md) — full product spec (CONFIDENTIAL)
- [Architecture](./docs/ARCHITECTURE.md) — system design aligned with PRD v2

## License

Proprietary — CONFIDENTIAL
