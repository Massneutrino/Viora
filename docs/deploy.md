# Deploying Viora (preview / pilot)

Production preview uses **two hosts**:

| Piece | App | Host | Purpose |
|-------|-----|------|---------|
| Marketing site | `apps/site` | **Vercel** | Public landing, Speak with V |
| API + database | `apps/api` + Postgres | **Railway** | LLM, voice, pilot leads, data |

Each other frontend (`apps/web`, `apps/admin`, `apps/worker-web`) gets its own Vercel project later with the same `NEXT_PUBLIC_API_URL`.

---

## Quick reference — where env vars live

| Variable | Railway (API) | Vercel (site) |
|----------|---------------|---------------|
| `DATABASE_URL` | Postgres reference | — |
| `GOOGLE_API_KEY`, `ELEVENLABS_API_KEY`, all `AI_*` / `VOICE_*` | server secrets | never |
| `JWT_SECRET`, `NODE_ENV`, `API_PORT` | yes | — |
| `TRUST_PROXY` | `1` (required behind Railway proxy for per-IP rate limits) | — |
| `RATE_LIMIT_*` | optional overrides (defaults in `.env.example`) | — |
| `NEXT_PUBLIC_API_URL` | — | Railway API URL |
| `NEXT_PUBLIC_SITE_URL` | — | Vercel site URL |

**Env template:** [`.env.railway.example`](../.env.railway.example) — copy, fill secrets, import in Railway Variables.

**Build commands:** [`railway.toml`](../railway.toml) (API) and [`apps/site/vercel.json`](../apps/site/vercel.json) (site). Commit and push so GitHub-connected deploys pick them up.

---

## 1. Railway — PostgreSQL

1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub** → Viora repo.
2. **+ New** → **Database** → **PostgreSQL**.
3. Wait until **Active**.

---

## 2. Railway — API service

1. **+ New** → **GitHub Repo** → same Viora repo (second service in the project).
2. **Settings** → leave **Root Directory** empty (repo root).
3. Build/start commands come from [`railway.toml`](../railway.toml) after commit + push. Manual fallback:

   **Build:**
   ```bash
   npm install && cd packages/database && npx prisma generate && cd ../.. && npx turbo run build --filter=@viora/api
   ```

   **Start:**
   ```bash
   cd packages/database && npx prisma migrate deploy && cd ../.. && node apps/api/dist/index.js
   ```

   Migrations run at **start**, not build — Railway's build container cannot reach `postgres.railway.internal` (P1001).

4. **Variables** — use [`.env.railway.example`](../.env.railway.example). Minimum for full V voice (Google brain + Gemini STT + ElevenLabs TTS):

   | Key | Value |
   |-----|--------|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (variable reference) |
   | `API_PORT` | `${{PORT}}` |
   | `JWT_SECRET` | New long random string (not the local dev placeholder) |
   | `NODE_ENV` | `production` |
   | `TRUST_PROXY` | `1` |
   | `AI_PROVIDER` | `google` |
   | `GOOGLE_API_KEY` | Your Google / Gemini API key |
   | `AI_MODEL_FAST` | `gemini-2.5-flash` |
   | `AI_MODEL_INTENT` | `gemini-2.5-pro` |
   | `VOICE_STT_PROVIDER` | `gemini` |
   | `VOICE_STT_MODEL` | `gemini-2.5-flash` |
   | `VOICE_TTS_PROVIDER` | `elevenlabs` |
   | `ELEVENLABS_API_KEY` | Your ElevenLabs key |
   | `ELEVENLABS_VOICE_ID` | `8bNue5gVKTykcmaQaZfT` |
   | + tuning vars | See `.env.railway.example` |

   **Import shortcut:** Railway → Variables → **Raw Editor** → paste filled copy of `.env.railway.example`, then add `DATABASE_URL` and `API_PORT` via service references.

5. **Settings → Networking → Generate Domain** → note URL, e.g. `https://viora-api-production.up.railway.app`.

### Verify API

| URL | Expected |
|-----|----------|
| `/health` | `{ "status": "ok" }` |
| `/health/ready` | `{ "database": "connected" }` |
| `/v1/voice/status` | `ttsProvider: "elevenlabs"`, `sttProvider: "gemini"` |

Deploy logs should show `[Viora API] LLM: google / gemini-...`.

---

## 3. Vercel — marketing site

1. Import repo → **one project** for the public site.
2. **Settings → General → Root Directory:** `apps/site`
3. Enable **Include source files outside of the Root Directory** (required for `@viora/ui`).
4. **Environment variables:**

   | Key | Value |
   |-----|--------|
   | `NEXT_PUBLIC_SITE_URL` | `https://your-site.vercel.app` |
   | `NEXT_PUBLIC_API_URL` | `https://your-api.up.railway.app` (no trailing slash) |

5. Deploy. [`apps/site/vercel.json`](../apps/site/vercel.json) sets monorepo install/build.

> **Localhost trap:** If `NEXT_PUBLIC_API_URL` is unset at build time, the site falls back to `http://localhost:6200`. That can work on your dev machine (calling your local API) but fails for everyone else. Always set it on Vercel and redeploy.

### Verify site + voice

1. Open marketing URL — hero loads.
2. **Speak with V** → DevTools → Network:
   - `POST /v1/voice/transcribe` → 200 (Gemini STT)
   - `POST /v1/pilot/chat` → 200 (Google LLM)
   - `POST /v1/voice/speech` → 200 + audio (ElevenLabs)
3. Request host must be your **Railway** URL, not `localhost:6200`.
4. Hear ElevenLabs V (not generic browser voice). Browser fallback only runs when server TTS fails.

---

## Provider split (current stack)

| Role | Provider | Env |
|------|----------|-----|
| V text / chat | Google Gemini | `AI_PROVIDER=google`, `GOOGLE_API_KEY` |
| Speech-to-text | Google Gemini | `VOICE_STT_PROVIDER=gemini` (same key) |
| Text-to-speech | ElevenLabs | `VOICE_TTS_PROVIDER=elevenlabs`, `ELEVENLABS_*` |

`AI_PROVIDER` / `AI_MODEL*` control text only. Voice is separate (`VOICE_STT_PROVIDER`, `VOICE_TTS_PROVIDER`).

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Vercel shows admin/employer app | Root Directory must be `apps/site` |
| Build can't find `@viora/ui` | Enable include-outside-root on Vercel |
| API won't start | Missing `GOOGLE_API_KEY` when `AI_PROVIDER=google` |
| `/health/ready` DB disconnected | Check `DATABASE_URL` reference; check deploy logs for migrate errors at start |
| Build fails P1001 `postgres.railway.internal` | `prisma migrate deploy` must be in **start**, not build — see `railway.toml` |
| Generic browser voice | Check `/v1/voice/status`; fix ElevenLabs vars |
| Site can't reach API | `NEXT_PUBLIC_API_URL` on Vercel + redeploy |
| Voice works for you only on Vercel | Site still pointing at `localhost:6200` — set `NEXT_PUBLIC_API_URL` |
| `railway.toml` ignored | Commit + push; check dashboard isn't overriding build/start |

---

## Later: more apps

| App | Vercel Root Directory |
|-----|----------------------|
| Employer | `apps/web` |
| Admin / ops | `apps/admin` |
| Worker preview | `apps/worker-web` |

All share the same Railway API via `NEXT_PUBLIC_API_URL`. Set `WEB_URL` / `WORKER_WEB_URL` on Railway when pilot lead approval links should point at deployed employer/worker apps.
