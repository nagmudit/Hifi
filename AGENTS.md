# HiFi - Agent Instructions

HiFi is a multi-tenant SaaS product. A customer installs a Discord bot, connects a GitHub organisation, and attaches their own model-provider API key. Anyone in a bound Discord channel can then tag the bot with a plain-English coding task and get back a pull request with tests, screenshots, and a preview link.

**Status: M1 of 6 complete.** The skeleton boots and the schema is migrated. There is no job pipeline yet. Most of this repository is interface and intent, so check the status marker on a document before assuming the thing it describes runs.

## Source of truth

This repository is authoritative. Conversation history is not. If you learned something in chat that is not written here, it does not survive this session. Write it down or lose it.

When sources disagree, trust in this order:

1. Code, tests, schema, config - what actually runs
2. Accepted ADRs in `docs/architecture/decisions/`
3. Product requirements in `docs/product/requirements.md`
4. Active plans in `docs/plans/active/`
5. Engineering and operational docs
6. Everything else, including this file

Record conflicts, never silently resolve them in favour of whichever is easier.

## Before you start

1. Read `docs/index.md` and follow it to what your task touches, not everything.
2. Read `docs/plans/active/` for work already underway in that area.
3. Read the `README.md` of every package you will touch. Each one states what that package owns and what it must never do, and the "must never" half is load-bearing.
4. Read the implementation and its tests.
5. Run `git status`.
6. For anything beyond a small fix, write or update a plan in `docs/plans/active/` first.

## Stack

TypeScript on Node 22, ESM throughout, pnpm workspace monorepo. PostgreSQL through Prisma, BullMQ on Redis, Fastify, discord.js, Next.js App Router. Control plane on Fly.io, dashboard on Vercel, workers on Fly Machines with per-tenant volumes. Local Postgres and Redis come from `docker-compose.yml`.

## Layout

| Path | Holds |
|---|---|
| `apps/bot` | Discord gateway. Creates jobs, never advances one. |
| `apps/api` | Fastify control plane: webhooks, dashboard backend, onboarding. |
| `apps/worker` | Job pipeline. The only process that changes job status. |
| `apps/dashboard` | Next.js onboarding, usage, billing. Built in M5. |
| `packages/db` | Prisma schema, migrations, client. Source of truth for every enum. |
| `packages/core` | Job state machine, error taxonomy, queue schema, logging, Redis. |
| `packages/crypto` | Credential sealing and log redaction. Leaf package, no internal deps. |
| `packages/agent` | Agent engine interface. OpenCode implementation lands in M2. |
| `packages/router` | Model selection. Interface only until M3. |
| `packages/github` | App auth, mirrors, branches, pull requests. Interface only until M2. |
| `packages/vercel` | Preview deployment resolution. Interface only until M3. |

Full reasoning in `docs/architecture/repository-map.md`, including the surprises section.

## Commands

| Task | Command |
|---|---|
| Install | `pnpm install` |
| Local infra up | `pnpm dev:infra` (needs Docker Desktop running) |
| Migrate | `pnpm db:migrate` |
| Build everything | `pnpm build` |
| Test | `pnpm test` |
| Typecheck | `pnpm typecheck` |
| Run the API | `pnpm dev:api` |
| Run the worker | `pnpm dev:worker` |

`pnpm lint` currently fails: no package defines a lint script. See `docs/plans/technical-debt.md`. Full verified list with gotchas in `docs/engineering/commands.md`.

## Conventions

- Imports between workspace packages use the package name and `.js` extensions on relative paths. NodeNext resolution means `./foo.js` in source refers to `./foo.ts`.
- Never redeclare a Prisma enum. Import `JobStatus`, `FailureCode` and the rest from `@hifi/db`.
- Every job status change goes through `assertTransition` in `packages/core/src/job-state.ts`. The state machine is data, not scattered `if` statements.
- Money is integer micro-USD. Per-job costs are `Int`, tenant period totals are `BigInt`. Never floats.
- Zod parses everything crossing a trust boundary: queue payloads, webhooks, Discord input, agent output.
- Every external call gets a timeout and a bounded retry with jitter.
- Failures raise `HifiError` with a `FailureCode`, so Discord, the dashboard, and metrics describe them identically.

## Before you finish

- Tests and typecheck actually run, not assumed.
- The active plan updated with what happened, what was decided, what is left.
- Docs updated for anything that changed schema, config, commands, or dependencies.
- Say plainly which validation you did not run and why.

## Never

- Commit secrets, `.env` values, or customer data. `.env` is gitignored; keep it that way.
- Put a customer credential anywhere repo-owned code can read it. See `docs/architecture/decisions/ADR-002-model-proxy.md`.
- Push to a default or protected branch, or open a pull request against a repo other than the bound one.
- Report success when tests are red.
- Claim a command passed without running it.
- Add a `awaiting_preview` job status. Its absence is deliberate: `ADR-003`.
