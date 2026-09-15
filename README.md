# HiFi

A Discord-native coding agent. Tag the bot in a bound channel with a plain-English task, and it opens a pull request with tests, screenshots, and a preview link.

**Status: M1, the skeleton.** The monorepo boots, the schema is migrated, and the queue is wired. No job pipeline yet; that is M2.

## Layout

```
apps/
  bot/         Discord gateway. Long-lived, thin.
  api/         Fastify control plane: webhooks, dashboard backend, Stripe, onboarding.
  worker/      Fly Machines. Consumes jobs, executes agent runs.
  dashboard/   Next.js on Vercel. Onboarding, usage, billing.
packages/
  db/          Prisma schema and client
  core/        Domain types, job state machine, queue schema, logging
  crypto/      Credential sealing and log redaction
  agent/       Agent engine interface, OpenCode implementation
  router/      Model selection and capability registry
  github/      GitHub App auth, mirrors, branches, pull requests
  vercel/      Preview deployment resolution
deploy/        Dockerfiles for the control plane and the worker image
```

Each package README says what it owns and, more usefully, what it must never do.

## Local development

Requires Node 22, pnpm 10, and Docker.

```bash
pnpm install
cp .env.example .env

# Postgres on 55432 and Redis on 56379, chosen so they do not collide with
# anything already installed locally.
pnpm dev:infra

# Generate a master keypair and paste the output into .env.
pnpm --filter @hifi/crypto keygen

pnpm db:migrate
pnpm build
pnpm test

pnpm dev:api       # http://localhost:8099/readyz
pnpm dev:worker
```

`pnpm dev:bot` exits immediately until a Discord token is configured, which is expected before M2.

## Documentation

[`AGENTS.md`](AGENTS.md) is the contract any coding agent reads first. [`docs/index.md`](docs/index.md) routes to everything else: architecture, decisions, verified commands, and the active plan. This README is the human quickstart; those are the working documents.

## Two things worth knowing before reading the code

**The job state machine is data, not control flow.** It lives in `packages/core/src/job-state.ts`. There is no `awaiting_preview` state: a job ends when the pull request is open, and a detached watcher edits the Discord message later if a preview deployment shows up. Waiting on someone else's build inside a job would hold a worker and a tenant concurrency slot for ten minutes.

**The customer model key never reaches the agent.** The worker runs a loopback proxy that holds the unsealed key and hands the agent a per-job token. The worker also runs the repo's install script, its tests, and its dev server, all of which are untrusted code, so a key in the environment would be readable by any postinstall hook in the dependency tree. The proxy also makes token accounting and the spend cap ours to enforce rather than the agent's to report.

## Milestones

| | | |
|---|---|---|
| M1 | Skeleton | done |
| M2 | Single-tenant happy path, mention to pull request | next |
| M3 | Tests, screenshots, previews, rich embed, cancellation |  |
| M4 | Multi-tenancy, sealed credentials, install flows |  |
| M5 | Dashboard and billing |  |
| M6 | Hardening: egress allowlist, spend caps, rate limits, telemetry |  |
