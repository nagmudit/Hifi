# Documentation Index

The repository is the source of truth. Start here and read only what your task touches.

**Project status: M1 of 6 complete.** The skeleton boots; the job pipeline does not exist yet. A document marked `proposed` describes something that has not been built.

## Start

| Doc | Read it when | Status |
|---|---|---|
| [`../AGENTS.md`](../AGENTS.md) | Always, first | current |
| [architecture/repository-map.md](architecture/repository-map.md) | Finding where code lives | current |
| [engineering/commands.md](engineering/commands.md) | Running, testing, migrating | current |
| [plans/active/](plans/active/) | Before touching an area with an open plan | current |

## Working on...

| Area | Read |
|---|---|
| Understanding the system at all | [architecture/overview.md](architecture/overview.md) |
| The job pipeline | [architecture/data-flow.md](architecture/data-flow.md), then `packages/core/src/job-state.ts` |
| Anything touching credentials | [architecture/security-model.md](architecture/security-model.md), [decisions/ADR-002-model-proxy.md](architecture/decisions/ADR-002-model-proxy.md) |
| Discord, GitHub, Stripe, Vercel, R2 | [architecture/integrations.md](architecture/integrations.md) |
| Database changes | `packages/db/prisma/schema.prisma`, [architecture/data-flow.md](architecture/data-flow.md) |
| Worker infrastructure | [decisions/ADR-001-tenant-isolation.md](architecture/decisions/ADR-001-tenant-isolation.md) |
| What the product is meant to do | [product/vision.md](product/vision.md), [product/requirements.md](product/requirements.md) |
| Writing tests | [engineering/testing.md](engineering/testing.md) |
| Code style questions | [engineering/conventions.md](engineering/conventions.md) |

## Decisions

Seven accepted, one proposed. Read ADR-002, ADR-003, ADR-006, and ADR-008 before building the worker, and ADR-005 and ADR-007 before starting M4.

| ADR | Decides | Read it when |
|---|---|---|
| [ADR-001](architecture/decisions/ADR-001-tenant-isolation.md) | one machine and one volume per tenant | touching worker infrastructure or cost |
| [ADR-002](architecture/decisions/ADR-002-model-proxy.md) | the model key goes to a proxy, not the agent | touching credentials, billing, or the agent interface |
| [ADR-003](architecture/decisions/ADR-003-no-awaiting-preview-state.md) | a job ends when the pull request opens | touching the state machine or preview URLs |
| [ADR-004](architecture/decisions/ADR-004-clarification-by-rerun.md) | a parked job resumes by re-running | touching clarification or concurrency accounting |
| [ADR-005](architecture/decisions/ADR-005-multi-surface.md) | **proposed** - Slack and email alongside Discord, abstracted during M4 | touching tenant identity, users, or bindings |
| [ADR-006](architecture/decisions/ADR-006-any-model-provider.md) | any model provider, through two wire protocols | touching the proxy, the router, keys, or pricing |
| [ADR-007](architecture/decisions/ADR-007-sign-in-and-connections.md) | sign in with GitHub; every integration is a separate connection | touching sign-up, tenants, or onboarding |
| [ADR-008](architecture/decisions/ADR-008-budgets.md) | customer-configurable budgets per job, day, and month, enforced by the proxy | touching the proxy, spend, or anything that calls a model |

## Runbooks

| Doc | Read it when |
|---|---|
| [runbooks/dev-credentials.md](runbooks/dev-credentials.md) | setting up Discord, the GitHub App, and a model key for local development |

## In flight

| Doc | Holds |
|---|---|
| [plans/active/m2-mention-to-pull-request.md](plans/active/m2-mention-to-pull-request.md) | the current milestone, with three open questions that block it |
| [plans/backlog.md](plans/backlog.md) | milestones M3 to M6, not started |
| [plans/technical-debt.md](plans/technical-debt.md) | known compromises, each with a trigger for paying it off |
| [plans/completed/m1-skeleton.md](plans/completed/m1-skeleton.md) | what M1 built and what was actually verified |

## Per-package rules

Each package has a `README.md` with an "Owns" and a "Must never" section. They are short, specific, and closer to the code than anything in `docs/`. Read the one for the package you are editing.
