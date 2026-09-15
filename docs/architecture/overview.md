---
status: current
last_verified: 2026-09-15
applies_to: [apps, deploy]
---

# Architecture Overview

## Processes

Four long-lived processes, deployed independently.

| Process | Host | Scaling | State today |
|---|---|---|---|
| Bot | Fly, one machine | single instance until gateway sharding | connects and idles |
| API | Fly, two machines minimum | horizontal | health endpoints only |
| Worker | Fly Machines, one per tenant | one machine per tenant, auto-stop when idle | consumes the queue, rejects every job |
| Dashboard | Vercel | serverless | two placeholder pages |

Postgres and Redis are shared infrastructure. Locally they come from `docker-compose.yml`; in production they are managed Fly apps.

## How a request travels

```
Discord mention
   -> bot: validate binding, quota, create thread, save attachments, enqueue
   -> Redis (BullMQ queue "hifi-jobs")
   -> worker: claim, prepare workspace, run agent, test, capture, push, report
   -> GitHub: branch + pull request
   -> Discord: the original status message, edited into the final report

separately, later:
GitHub deployment_status webhook -> API -> edit the Discord message with the preview URL
```

The bot writes the job row and the queue entry. The worker owns every state change after that. The API owns inbound webhooks. Nothing else writes job status.

## Why the split

**The bot is thin because Discord is unforgiving.** A gateway handler that blocks loses events. Everything slow happens in the worker, and the only work the handler does beyond validation is downloading attachments, which cannot be deferred because Discord CDN links expire.

**The worker is per-tenant because isolation is the machine boundary.** See `ADR-001`. This is the most expensive decision in the architecture and the one most likely to be revisited under load.

**The API is separate from the bot** because webhooks need horizontal scale and HTTP health checks, while the gateway needs exactly one instance. Combining them would force the worse constraint on both.

## Storage

| Store | Holds | Notes |
|---|---|---|
| Postgres | tenants, users, credentials, repos, bindings, jobs, events, model registry, webhook dedupe | 10 tables, one migration |
| Redis | the BullMQ job queue | `noeviction` policy; a queue whose keys can be evicted loses jobs silently |
| Tenant volume | bare git mirrors, package store, job worktrees | disposable cache; losing it costs one slow job, never data |
| Object storage (R2) | attachments, screenshots, logs | proposed, M2 onward |

## Runtime invariants

These hold across the whole system and are worth checking any change against.

1. A Discord message produces at most one job. Enforced by a unique constraint on `Job.discordMessageId`.
2. A job in a non-terminal state has a deadline, so a dead worker cannot pin a job open forever. Proposed; the column exists and nothing writes it yet.
3. A worktree is created and destroyed within one job. The mirror outlives it.
4. A terminal job is never re-opened. Terminal states are absorbing in the transition table and this is covered by a test.
5. Only a terminal job meters usage to Stripe. Proposed, M5.

## Status

Invariants 1 and 4 are enforced today. The rest are design commitments with no code behind them yet. Read `docs/plans/active/` before assuming otherwise.
