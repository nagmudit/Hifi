---
status: current
last_verified: 2026-09-15
applies_to: [packages/core, apps/worker, apps/bot]
---

# Job Lifecycle

The central mechanism of the product. The state machine itself is implemented and tested; almost everything that drives it is not.

## States

Defined in `packages/core/src/job-state.ts` as data, and mirrored by the `JobStatus` enum in the Prisma schema. `JOB_TRANSITIONS` is the whole machine; `assertTransition` is the only sanctioned way to change status.

```
queued -> claimed -> preparing -> planning -> editing -> testing
        -> capturing -> pushing -> reporting -> succeeded

any non-terminal state -> cancelled | failed | timed_out
planning, editing       -> waiting_input -> planning
testing                 -> editing            (one repair attempt only)
editing                 -> capturing, pushing (repos with no test setup)
editing                 -> reporting            (nothing to push: see below)
```

Terminal states are `succeeded`, `failed`, `cancelled`, `timed_out`, and they are absorbing.

**There is no `awaiting_preview`.** A job ends when the pull request is open. See `ADR-003`.

**A run that changes nothing still reports.** Asking a question, or finding the
change already made, goes `editing -> reporting -> succeeded` with no pull
request, carrying the agent's summary. It is a result, not a failure, and the
report distinguishes the two by whether a pull request exists. Git decides, not
the agent: a clean working tree is a no-change run however the agent describes
what it did.

## What happens in each state

Everything below is `proposed` unless marked otherwise.

| State | Work | Notes |
|---|---|---|
| `queued` | bot validates binding, quota, tenant status; creates the thread; posts the status message; saves attachments; enqueues | the handler must return fast |
| `claimed` | worker starts the tenant machine if stopped | machines auto-stop when idle |
| `preparing` | mint a GitHub installation token, fetch the mirror, add a worktree, create the branch, detect package manager and test command, install dependencies | token minted per job, never cached |
| `planning` | vision pre-pass if images are attached, then the agent plans | images become a textual spec and leave the loop |
| `editing` | the agent writes code | |
| `testing` | agent adds tests, then the repository suite runs | one repair attempt, then honest reporting |
| `capturing` | dev server on a random port, Playwright screenshots at two widths | failure here is non-fatal |
| `pushing` | assert the branch is safe, commit, push, open the pull request | refuses default and protected branches |
| `waiting_input` | job parked on a clarifying question, holding no concurrency slot | resuming re-runs from `planning`, see `ADR-004` |
| `reporting` | edit the status message into the final embed, mention the requester once | |

## Concurrency accounting

`ACTIVE_STATUSES` in `job-state.ts` defines which states consume one of the tenant's concurrency slots. `queued` and `waiting_input` deliberately do not. A parked job waiting on a human must not occupy a slot, which is precisely why resuming cannot keep a live agent session alive.

## Idempotency

Three separate mechanisms, because retries come from three directions.

| Risk | Guard | Status |
|---|---|---|
| Discord redelivers `messageCreate` after a gateway reconnect | unique constraint on `Job.discordMessageId` | done |
| BullMQ re-delivers a claimed job after a worker crash | re-check for an existing branch and open pull request for this job ID before doing any work | proposed |
| A webhook provider retries a delivery | `WebhookEvent` table, unique on source plus delivery ID | schema done, unused |

## Event log

Every accepted transition writes a `JobEvent` with a writer-assigned `seq`, so ordering never depends on timestamp resolution. The event log powers both the live Discord thread and the dashboard timeline, which means it is a product surface, not just a debug aid.

## Preview correlation

The deployment webhook arrives carrying a repository and a head SHA, and nothing else that we control. `Job` is indexed on `(repoId, headSha)` for exactly this lookup. Two consequences:

- The head SHA must be recorded before the push completes, or a fast webhook arrives before the job row can be found.
- One commit in a monorepo can produce several preview deployments. Resolution must handle more than one match rather than assuming exactly one.
