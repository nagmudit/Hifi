---
status: completed
created: 2026-09-13
last_updated: 2026-09-13
areas: [.]
---

# M1 - Skeleton

## Objective

The monorepo boots, the schema is migrated, and the queue is wired end to end, with no business logic. Achieved.

## What was built

pnpm workspace with four apps and seven packages. Prisma schema covering tenants, users, memberships, credentials, repos, channel bindings, jobs, job events, the model registry, and webhook deduplication. Local Postgres and Redis through Docker Compose. Fly configuration for the API, the bot, and the worker image, plus two Dockerfiles. A README per package stating what it owns and what it must never do.

Two pieces went beyond scaffolding because they are load-bearing and testable in isolation: the job state machine in `packages/core`, and credential sealing plus log redaction in `packages/crypto`.

## Validation

All of the following were run, not assumed.

| Check | Result |
|---|---|
| `pnpm build` | all 12 projects, including `next build` |
| `pnpm test` | 29 tests, 2 files, pass |
| `pnpm db:migrate` | 10 tables created |
| `/readyz` | `{"ready":true,"checks":{"postgres":"ok","redis":"ok"}}` |
| Queue round trip | job enqueued, claimed by the worker, parsed by Zod, rejected with the expected M2 placeholder |

## Decisions

Four, all recorded as ADRs: tenant isolation as the machine boundary, the model proxy in place of a key in the environment, no `awaiting_preview` state, and clarification by re-run.

## Found along the way

- A local Postgres already owned port 5433, which surfaced as an authentication failure rather than a refused connection. Local ports moved to 55432, 56379, and 8099.
- pnpm 10 blocks dependency build scripts by default, which silently leaves Prisma without an engine until `onlyBuiltDependencies` is set.
- BullMQ rejects a colon in a queue name, so the queue is `hifi-jobs`.
- `libsodium-wrappers` 0.7.16 ships a broken ESM entry. Worked around with `createRequire`, logged as D-04.
- Passing a concrete pino logger to Fastify narrows its instance type, so the server type has to name the logger generic.

## Limitations carried forward

`pnpm lint` fails, there is no CI, module boundaries are unenforced, and several job invariants are documented but unimplemented. All tracked in `docs/plans/technical-debt.md`.
