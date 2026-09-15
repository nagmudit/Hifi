---
status: current
last_verified: 2026-09-15
applies_to: [apps, packages]
---

# Repository Map

## Shape

A pnpm workspace monorepo with four deployable units in `apps/` and seven libraries in `packages/`. The organising principle is the deployment boundary: each app is a separate process with its own lifecycle, and anything two apps both need becomes a package rather than an import across apps.

Dependencies point in one direction only, from apps to packages, and within packages from specific to general. No app imports another app.

## Package dependency order

```
crypto                 (leaf: depends on nothing internal)
  <- core              (+ db)
       <- agent, router, github, vercel
            <- api, bot, worker, dashboard
```

`packages/db` is also a leaf and does not import `core`. That is deliberate: `core` imports Prisma enums from `db`, so the reverse edge would be a cycle.

## Directories

### `apps/bot`
**Holds:** the Discord gateway process.
**Rule:** creates jobs, never advances one. No slow work in the message handler.
**Entry:** `apps/bot/src/index.ts`.
**Note:** cannot run more than one machine without Discord gateway sharding.

### `apps/api`
**Holds:** Fastify control plane. Health endpoints today; webhooks, onboarding callbacks, and the dashboard backend later.
**Rule:** never holds the master secret key, so it can seal credentials but not read them.
**Entry:** `apps/api/src/index.ts`, server in `server.ts`, env schema in `env.ts`.

### `apps/worker`
**Holds:** the job pipeline. The only writer of job status.
**Rule:** one machine and one volume per tenant, never shared.
**Entry:** `apps/worker/src/index.ts`.

### `apps/dashboard`
**Holds:** Next.js App Router. Two placeholder pages today.
**Rule:** never queries Postgres from the browser.

### `packages/db`
**Holds:** `schema.prisma`, migrations, and the shared client accessor.
**Rule:** source of truth for every enum. No business logic.
**Entry:** `packages/db/src/index.ts` exports `db()`, `pingDb()`, and re-exports all of `@prisma/client`.

### `packages/core`
**Holds:** the job state machine, error taxonomy, queue and signal schemas, logger, Redis helpers.
**Rule:** no I/O beyond Postgres and Redis handles. Never talks to Discord, GitHub, or a model provider.

### `packages/crypto`
**Holds:** sealing, unsealing, key rotation, log redaction, onboarding key validation.
**Rule:** depends on nothing else in the repository, so it can be audited alone.

### `packages/agent`, `packages/router`, `packages/github`, `packages/vercel`
**Hold:** interfaces only at M1. Implementations land in M2 and M3.
**Rule:** the worker codes against the interface, never a concrete engine class.

## Where things live

| Looking for | Go to |
|---|---|
| The job state machine | `packages/core/src/job-state.ts` |
| Database schema and enums | `packages/db/prisma/schema.prisma` |
| Migrations | `packages/db/prisma/migrations/` |
| Credential sealing | `packages/crypto/src/seal.ts` |
| Secret redaction and key validation | `packages/crypto/src/redact.ts` |
| Timeouts, limits, queue name, branch prefix | `packages/core/src/constants.ts` |
| Queue payload and test/diff/signal schemas | `packages/core/src/schemas.ts` |
| Failure codes and user-facing messages | `packages/core/src/errors.ts` |
| Agent system preamble | `packages/agent/src/index.ts` |
| HTTP health endpoints | `apps/api/src/server.ts` |
| Docker images | `deploy/Dockerfile`, `deploy/Dockerfile.worker` |
| Fly configuration | `apps/*/fly.toml` |
| Local infra | `docker-compose.yml` |

## Boundaries

| Rule | Enforced by |
|---|---|
| Apps never import other apps | convention only |
| `db` never imports `core` | convention only |
| `crypto` imports nothing internal | convention only |
| Worker uses `AgentEngine`, not a concrete engine | convention only |
| Only the worker writes job status | convention only |

None of these are enforced by a test or lint rule. That is a technical-debt entry, not a claim of safety. See `docs/plans/technical-debt.md`.

## Surprises

Things that would mislead a newcomer.

- **There is no `awaiting_preview` job status,** even though the original brief named one. Its absence is a decision, recorded in `ADR-003`. Do not add it back.
- **`AgentEngine` does not take an API key,** although the brief specified `apiKey: SealedRef`. It takes a loopback proxy URL and a per-job token instead. See `ADR-002`.
- **`packages/core/src/constants.ts` re-exports two constants from `@hifi/crypto`** rather than defining them. The redactor owns those lists and `crypto` is the leaf, so the re-export keeps one definition while letting callers import everything from `core`.
- **`apps/worker/fly.toml` is not deployed the usual way.** Worker machines are created per tenant through the Machines API. The file exists to build and push the image: `fly deploy --build-only --push --config apps/worker/fly.toml`.
- **`apps/dashboard/tsconfig.json` does not extend `tsconfig.base.json`.** Next needs `bundler` resolution and JSX settings that conflict with the NodeNext base used everywhere else.
- **Local ports are deliberately unusual:** Postgres on 55432, Redis on 56379, API on 8099. Common ports were already taken on the development machine, and a Postgres port collision surfaces as an authentication failure rather than a refused connection, which is easy to misdiagnose.
- **`apps/dashboard/next-env.d.ts` is generated and committed.** Next regenerates it; do not hand-edit.
- **`packages/crypto/src/seal.ts` loads libsodium through `createRequire`,** not a plain import. The published ESM entry of `libsodium-wrappers` imports a file the package does not ship. The workaround is commented in place.
