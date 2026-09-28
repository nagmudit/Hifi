---
status: active
created: 2026-09-28
last_updated: 2026-09-28
areas: [packages/core, packages/agent, packages/github, apps/worker, apps/bot, apps/api, packages/router]
---

# M3 - Job quality

## Objective

A change arriving from Discord is tested, shown, linked, and stoppable. The report says honestly what happened, including when the tests are red.

## Current behaviour

Verified on 2026-09-28, at the close of M2.

- A mention runs `OpenCodeEngine` through the model proxy and opens a pull request. No dependencies are installed and no tests are run.
- The final report shows the pull request, changed files, tokens, and duration. Cost is always "unknown".
- A job cannot be cancelled. Only the wall clock stops it.
- **Security defect:** the agent is spawned with the worker's entire environment. See chunk 0.

## Chunks

Each ends somewhere checkable, with a stop for review after it.

| Chunk | Delivers | Needs from the user |
|---|---|---|
| 0 | subprocess environments built from an allowlist | nothing |
| A | detection, cached install, test generation, test run, one repair, draft PR when red | nothing |
| B | richer report, `/hifi cancel`, cancel by reaction | nothing |
| C | before and after screenshots with Playwright | nothing |
| D | preview links from the deployment webhook | Vercel, GitHub App changes, a smee.io channel |
| E | router, registry prices, dollar and workspace budgets, Anthropic and OpenRouter | optional keys for live checks |
| F | image attachments and the vision pre-pass | nothing |

## Decisions

**Red tests after the repair attempt produce a draft pull request** - chosen by the user on 2026-09-28. Reported as "Tests failing", never "Done". The job ends `failed` with `tests_failed` but keeps the pull request, because the work is often nearly right and a draft cannot be merged by accident. If the plan does not allow drafts on a private repository, fall back to a normal pull request titled `[tests failing]`.

**The suite is re-run against the base commit before any repair.** If it was already red, the repair is skipped and the report says the failures predate the change. A repair against unrelated failures spends the customer's money for nothing.

**Object storage is local disk behind an interface in M3.** R2 plugs in behind the same interface later. Nothing in M3 needs a Cloudflare account.

**Webhooks reach the local API through a smee.io channel.** A stable URL to set once in the GitHub App, and GitHub's documented route for local webhook development.

## Found while planning

- The agent spawn in `packages/agent/src/opencode.ts` passes `{ ...process.env }`, and the worker starts with the whole `.env` loaded. The agent and every command it runs could read the OpenAI key, the master secret key, and the bot token. This undoes ADR-002. Fixed first, in chunk 0.
- Two design problems for M4, recorded in `docs/plans/technical-debt.md` as D-09 and D-10: the GitHub App private key and the master secret key both sit on the worker, and on a per-tenant machine either one would reach every tenant.

## Log

### 2026-09-28
- Did: planned M3, approved by the user.

### 2026-09-28, chunk 0
- Did: `childEnv` in `packages/core` builds every subprocess environment from an allowlist. Applied to the agent spawn and to git, the only two production spawn sites.
- Did: a guard test fails the build if any product source spreads `process.env`. Proven to fire by planting a leak in a throwaway file, then removing it.
- Found: this machine's system git config uses the Git Credential Manager. Had the App token ever been refused, git could have fallen back to the owner's own GitHub login and pushed as them. Git now ignores host user and system config entirely.
- Verified against the real binary: OpenCode runs on the scrubbed environment, and honours `XDG_CONFIG_HOME`, so a job never picks up a developer's personal OpenCode config.
- Verified live: a job asked the agent to list the environment variables it could see. Names only came back, and none held a key, token, secret, or database URL.
- Ran: `pnpm test:env`, 109 pass, up from 101.

## Remaining

Chunk A: detection, cached install, test generation, test run, one repair, draft pull request when red.

## Done when

- A change request produces code and tests, and the tests run in the worktree.
- A change that breaks the suite produces a draft pull request reported as failing.
- `/hifi cancel` and a ❌ reaction each stop a running job.
- A visual change arrives with before and after screenshots.
- A preview link appears in the thread once Vercel has built it.
- A job reports a dollar cost, and a workspace over budget is refused.
- A screenshot attached to a request shapes the change.
- No secret is readable by any subprocess, proven by a test.
