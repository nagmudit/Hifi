---
status: current
last_verified: 2026-09-15
applies_to: [.]
---

# Commands

Verified column says how the claim was checked. "ran" means executed in this repository with the result shown.

| Task | Command | Verified |
|---|---|---|
| Install | `pnpm install` | ran |
| Local infra up | `pnpm dev:infra` | ran, Postgres and Redis both healthy |
| Local infra down | `pnpm dev:infra:down` | ran |
| Local infra reset, destroys data | `pnpm dev:infra:reset` | in package.json, not run |
| Migrate, development | `pnpm db:migrate` | ran, created 10 tables |
| Migrate, deploy | `pnpm --filter @hifi/db migrate:deploy` | in package.json, not run |
| Generate Prisma client | `pnpm db:generate` | ran as part of build |
| Prisma Studio | `pnpm db:studio` | in package.json, not run |
| Build everything | `pnpm build` | ran, all 12 projects |
| Test | `pnpm test` | ran, 29 pass in 2 files |
| Test, watch | `pnpm test:watch` | in package.json, not run |
| Typecheck | `pnpm typecheck` | ran, clean |
| Lint | `pnpm lint` | ran, **fails**: no package defines a lint script |
| Master keypair | `pnpm --filter @hifi/crypto keygen` | ran |
| Run the API | `pnpm dev:api` | built output ran on port 8099; the `tsx watch` form is unverified |
| Run the worker | `pnpm dev:worker` | built output ran and consumed a queued job; the `tsx watch` form is unverified |
| Run the bot | `pnpm dev:bot` | built output ran, exits 0 without a token |
| Run the dashboard | `pnpm dev:dashboard` | not run; `next build` succeeds |
| Clean | `pnpm clean` | not run, and uses `rm -rf`, which is unlikely to work in a Windows shell |

## Prerequisites

- Node 22. `engines` allows `>=22 <25`. The development machine runs 24.12.0, which is inside that range but not the pinned target in `.nvmrc`.
- pnpm 10. Pinned as `packageManager`.
- Docker Desktop **running**, not merely installed. `pnpm dev:infra` fails with a named-pipe connection error when the engine is stopped, which does not obviously read as "start Docker".
- `.env` copied from `.env.example`, with a master keypair pasted in.

## Ports

Deliberately unusual, because the common ones were already taken on the development machine.

| Service | Port |
|---|---|
| Postgres | 55432 |
| Redis | 56379 |
| API | 8099 |
| Dashboard | 3000 |

## Gotchas

- **A Postgres port collision looks like an authentication failure,** not a refused connection. If `prisma migrate` reports `P1000` with credentials you know are right, check whether something else owns the port first.
- **pnpm 10 blocks build scripts by default.** Prisma and esbuild need theirs. The allowlist is the `pnpm.onlyBuiltDependencies` field in the root `package.json`. A fresh clone that skips it will install without a Prisma engine.
- **BullMQ rejects a colon in a queue name.** The queue is `hifi-jobs`.
- **Redis must run with `noeviction`.** The compose file sets it. A queue whose keys can be evicted loses jobs silently.
- **The first build is slow** because Prisma generates its client as part of `@hifi/db`'s build step.

## Verifying a change end to end

```bash
pnpm dev:infra          # needs Docker running
pnpm db:migrate
pnpm build
pnpm test
pnpm dev:api            # then: curl http://localhost:8099/readyz
```

`/readyz` returns `{"ready":true,"checks":{"postgres":"ok","redis":"ok"}}` when both dependencies are up, and 503 otherwise.
