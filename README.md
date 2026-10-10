# The Oracle

A 4-player online social-deduction card game with an AI game master.

## Quick start (local dev)

```bash
bun install                          # also downloads the Inngest Dev Server binary
cp apps/server/.env.example apps/server/.env   # set BETTER_AUTH_SECRET (openssl rand -hex 32)
cp apps/web/.env.example apps/web/.env
cp packages/db/.env.example packages/db/.env
bun run db:start                     # Postgres in Docker
bun run db:migrate                   # apply Drizzle migrations
bun run dev                          # web :3001 + API :3000
bun run dev:inngest                  # Inngest Dev Server :8288 (separate terminal)
```

Tests:

```bash
bun run test                         # engine rules + lobby integration tests (needs Postgres)
cd apps/e2e && bun run e2e           # browser test: 4 tabs fill a lobby, 1 human + 3 bots
cd apps/e2e && bun run e2e:game      # full game in 4 tabs (add --bots for 1 human + 3 bots)
cd apps/e2e && bun run e2e:admin     # admin dashboard + LLM profile (needs ADMIN_EMAILS and an Ollama)
```

Phase timers default to night 45s, day 3:30, action 90s, vote 60s, final 60s.
Override them with env vars for quick local games, e.g.:

```bash
PHASE_NIGHT_SECONDS=20 PHASE_DAY_SECONDS=25 PHASE_ACTION_SECONDS=20 \
PHASE_VOTE_SECONDS=15 PHASE_FINAL_SECONDS=15 bun run dev:server
```

## The Oracle's LLM

The Oracle's model is configured at runtime, not in env files:

1. Put your email in `ADMIN_EMAILS` (server env), then **sign up with that email
   right away**. Email sign-up is not verified, so whoever registers an
   ADMIN_EMAILS address first becomes admin.
2. Open **Admin** in the header → **New profile**. Providers: Ollama, any
   OpenAI-compatible server (LM Studio, vLLM, OpenRouter…), Anthropic, OpenAI,
   Google. "Find models" lists what the server offers; "Test" sends one request.
   API keys are stored AES-GCM encrypted (derived from `BETTER_AUTH_SECRET`)
   and never sent back to the browser.
3. **Make default**, or let each game's host pick a profile (or "Scripted") in
   the lobby. A game is pinned to its profile when it starts.

Ollama for development:

```bash
ollama pull llama3.2      # or qwen2.5:7b etc.; models with good JSON output work best
ollama serve              # profile: provider Ollama, base URL empty (= http://localhost:11434/v1)
```

Every Oracle line carries a machine-checkable claim. The engine computes the
real truth, rejects messages that break the rules (Static, wrong intended
truth, wrong names, text that doesn't state its claim), retries with feedback,
and falls back to the scripted Oracle per message, so a slow or broken model
never stalls a game. The admin page lists recent calls with latency and
fallbacks. Model calls run in their own memoized Inngest steps, outside DB
locks, and are never repeated after a restart.

How a game runs: `game/created` starts one durable `game-loop` run per game
(`apps/server/src/inngest/functions.ts`). Each phase opens in an idempotent
`step.run` (`packages/api/src/game/loop.ts`), then waits with
`step.waitForEvent` until the API reports everyone has acted
(`game/night.ended`, `game/day.ended`, `game/actions.done`, `game/votes.done`)
or the stored deadline passes. All state changes go through `mutateGame`
(row lock + engine + projections) and are pushed over Inngest Realtime:
`game:{id}` (public) and `game:{id}:p:{playerId}` (private, token only for
the seat owner).

Players can join as guests (name only). Sessions are bearer tokens kept per
browser tab, so four tabs of one browser can be four different players; use
"Play as a different guest in this tab" from the user menu to switch.

Smoke-test the Inngest wiring (event -> durable run -> Realtime message):

```bash
cd apps/server && bun run smoke:inngest
```

Inngest (TypeScript SDK v4) is served from `apps/server` at `/api/inngest`.
The client lives in `apps/server/src/inngest/`. v4 defaults to cloud mode, so
`INNGEST_DEV=true` is required locally; in production set `INNGEST_SIGNING_KEY`
and `INNGEST_EVENT_KEY` instead.

---

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines React, TanStack Router, Hono, ORPC, and more.

## Features

- **TypeScript** - For type safety and improved developer experience
- **TanStack Router** - File-based routing with full type safety
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **Shared UI package** - shadcn/ui primitives live in `packages/ui`
- **Hono** - Lightweight, performant server framework
- **oRPC** - End-to-end type-safe APIs with OpenAPI integration
- **Bun** - Runtime environment
- **Drizzle** - TypeScript-first ORM
- **PostgreSQL** - Database engine
- **Authentication** - Better-Auth
- **Turborepo** - Optimized monorepo build system
- **Biome** - Linting and formatting

## Getting Started

First, install the dependencies:

```bash
bun install
```

## Database Setup

This project uses PostgreSQL with Drizzle ORM.

1. Make sure you have a PostgreSQL database set up.
2. Update your `apps/server/.env` file with your PostgreSQL connection details.

3. Apply the schema to your database:

```bash
bun run db:push
```

Then, run the development server:

```bash
bun run dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser to see the web application.
The API is running at [http://localhost:3000](http://localhost:3000).

## UI Customization

React web apps in this stack share shadcn/ui primitives through `packages/ui`.

- Change design tokens and global styles in `packages/ui/src/styles/globals.css`
- Update shared primitives in `packages/ui/src/components/*`
- Adjust shadcn aliases or style config in `packages/ui/components.json` and `apps/web/components.json`

### Add more shared components

Run this from the project root to add more primitives to the shared UI package:

```bash
npx shadcn@latest add accordion dialog popover sheet table -c packages/ui
```

Import shared components like this:

```tsx
import { Button } from "@oracle/ui/components/button";
```

### Add app-specific blocks

If you want to add app-specific blocks instead of shared primitives, run the shadcn CLI from `apps/web`.

## Environment Configuration

Each app owns its environment schema in `.env.schema`. Varlock generates `src/env.ts` during installation; run `bun run env:generate` after changing a schema. Commit schemas, and keep secrets in ignored env files or your deployment platform.

Import the generated `ENV` accessor in application code. Shared database and auth packages receive configuration or initialized clients from the application. See [Varlock's monorepo guide](https://varlock.dev/guides/monorepos/).

Bun's automatic env loading is disabled in `bunfig.toml`; the framework integration or server bootstrap loads Varlock. Node deployments must include Varlock and its dependencies alongside the app schema.

Run standalone Node/Bun tools that use Varlock from the owning app directory so they load that app's schema and env files. `env:generate` only generates TypeScript files; it does not initialize environment values in a subsequent command.

## Git Hooks and Formatting

- Run checks: `bun run check`

## Project Structure

```
oracle/
├── apps/
│   ├── web/         # Frontend application (React + TanStack Router)
│   ├── server/      # Backend API (Hono, ORPC), Inngest client + functions
│   └── e2e/         # Playwright browser tests
├── packages/
│   ├── ui/          # Shared shadcn/ui components and styles
│   ├── api/         # API layer / business logic
│   ├── auth/        # Authentication configuration & logic
│   ├── db/          # Database schema & migrations
│   ├── engine/      # Pure game rules (no I/O), Vitest
│   ├── oracle/      # Oracle: prompts, Zod schemas, truth-checking, providers, scripted fallback
│   └── realtime/    # Inngest Realtime channel definitions (server + web)
```

## Available Scripts

- `bun run dev`: Start all applications in development mode
- `bun run build`: Build all applications
- `bun run dev:web`: Start only the web application
- `bun run dev:server`: Start only the server
- `bun run check-types`: Check TypeScript types across all apps
- `bun run db:push`: Push schema changes to database
- `bun run db:generate`: Generate database client/types
- `bun run db:migrate`: Run database migrations
- `bun run db:studio`: Open database studio UI
- `bun run check`: Run Biome formatting and linting

## Better Auth Schema Generation

After changing auth plugins or schema options, run `bun run auth:generate` from the project root. The script runs the Better Auth CLI through `varlock run` from the owning app directory, loading the auth instance from `src/services.ts`. Review the schema changes, then use your ORM's migration workflow to apply them.
