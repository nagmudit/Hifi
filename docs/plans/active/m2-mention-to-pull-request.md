---
status: active
created: 2026-09-15
last_updated: 2026-09-15
areas: [apps/bot, apps/worker, packages/agent, packages/github]
---

# M2 - Single-tenant happy path, mention to pull request

## Objective

A Discord mention in one specific channel produces a real pull request on a real repository, and the bot replies in the thread with the link. One guild, one repository, credentials from environment variables.

This is the milestone that proves the product idea. Nothing after it matters if this does not genuinely work end to end.

## Current behaviour

Verified on 2026-09-15.

- `apps/bot` connects to the Discord gateway and does nothing else. Without `DISCORD_BOT_TOKEN` it logs a warning and exits 0.
- `apps/worker` connects to Postgres and Redis, consumes from the `hifi-jobs` queue, validates the payload with Zod, and throws `job pipeline not implemented (M2)`.
- `packages/agent`, `packages/github` are interfaces with no implementation.
- The job state machine and credential sealing are implemented and tested. Nothing calls them.
- No `Tenant`, `Repo`, or `ChannelBinding` row has ever been written.

## Desired behaviour

1. A mention in the configured channel creates a thread and a status message within about three seconds.
2. A `Job` row exists, keyed to the Discord message ID, and a queue entry follows it.
3. The worker claims the job, prepares a worktree from a bare mirror, and runs OpenCode headlessly against the prompt.
4. A branch is pushed and a pull request opened, never against the default branch.
5. The status message is edited with the pull request link and a one-line summary.
6. Re-delivering the same Discord message does not produce a second pull request.

## Scope

**In:** the bot message handler, the job pipeline through `reporting`, `OpenCodeEngine`, GitHub App auth and mirror or worktree management, branch safety, pull request creation, the loopback model proxy, and the integration test with a stubbed engine.

**Out:** test generation and execution, screenshots, preview URLs, the rich embed, cancellation, the dashboard, Stripe, sealed credentials, per-tenant machines, and channel bindings from the database. All of those are M3 and M4.

Single tenant means the `M2_*` environment variables in `.env.example` stand in for the `Tenant`, `Repo`, and `ChannelBinding` rows. The worker still writes real rows so the pipeline exercises the real schema.

## Approach

Build the pipeline against the state machine that already exists, adding the enforcement it is missing.

1. **Fixture repository first.** A small Next.js app with a working test suite, in a GitHub account to be named, deployed to Vercel. Everything else is tested against it.
2. **GitHub before the agent.** Mirror, worktree, branch, push, and pull request are the parts most likely to be fiddly on Windows and on Fly. Prove them with a hand-written commit before any model is involved.
3. **Model proxy before `OpenCodeEngine`,** so the key is never in the agent's environment even during development. See `ADR-002`.
4. **`OpenCodeEngine` last,** behind the interface, with the system preamble from `packages/agent`.
5. **The integration test alongside, not after.** Stubbed engine, fixture repository, asserting the transition sequence, worktree teardown, and idempotency on re-delivery.

## Milestones

- [ ] Fixture repository created and deployed
- [ ] GitHub App registered, installation token minting works
- [ ] Mirror, worktree, branch, push, pull request, proven without an agent
- [ ] Branch safety check, with unit tests for the refusal paths
- [ ] Bot message handler: thread, status message, attachment download, enqueue
- [ ] Worker pipeline through `reporting`, writing `JobEvent` on every transition
- [ ] Loopback model proxy with token accounting
- [ ] `OpenCodeEngine`
- [ ] Integration test with a stubbed engine
- [ ] Job deadline and the watchdog that enforces it

## Log

### 2026-09-15
- Did: built the repository context system, Tier 2. No pipeline work yet.
- Found: nothing in this plan is blocked by code. It is blocked on three external accounts.

## Decisions

Carried in from the M1 design discussion, each with an ADR.

**Model key goes to a loopback proxy, not the agent environment** - `ADR-002`. Affects the shape of `AgentEngine`, which takes `access`, not `apiKey`.

**A job ends when the pull request opens** - `ADR-003`. There is no preview handling in M2 at all, and none is needed.

**Clarification parks the job and resumes by re-running** - `ADR-004`. `waiting_input` exists in the machine; M2 may leave it unreachable rather than implement the question path early.

**Fixture repository is scaffolded rather than one of the user's real repositories.** Chosen for a clean first loop. The risk it accepts is that real repositories break on dependency installation in ways a fresh Next.js app never will, which is the single most likely production failure. Point it at a real repository before calling M2 done.

## Open questions

All three block the first milestone, and only the user can answer them.

1. **Which GitHub account or organisation** should hold the fixture repository, and should the GitHub App be registered under the same one?
2. **Which Discord server** can host the development bot? A private test server is fine and preferable.
3. **Where should the Anthropic Console API key live** for development? It goes in `.env` as `M2_MODEL_API_KEY`, which is gitignored, but the key itself has to come from somewhere.

## Remaining

The next agent's first action: ask the three open questions above, then create the fixture repository. Do not start on the pipeline before the fixture exists, because everything else is tested against it.

## Done when

- A mention in the configured Discord channel produces a pull request on the fixture repository, and the thread shows the link.
- The pull request contains a real change matching the request, not a placeholder.
- Re-running the same message produces no second pull request.
- The integration test passes with a stubbed engine.
- A job that hangs is terminated by the watchdog rather than running forever.
- The same flow has been tried once against a real repository, and whatever broke is written down.
