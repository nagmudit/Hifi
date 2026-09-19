---
status: active
created: 2026-09-15
last_updated: 2026-09-20
areas: [apps/bot, apps/worker, packages/agent, packages/github, packages/crypto]
---

# M2 - Single-tenant happy path, mention to pull request

## Objective

A Discord mention in one specific channel produces a real pull request on a real repository, and the bot replies in the thread with the link. One guild, one repository, credentials from environment variables, OpenAI as the model provider.

This is the milestone that proves the product idea. Nothing after it matters if this does not genuinely work end to end.

## Current behaviour

Verified on 2026-09-20.

- **The fixture exists.** `nagmudit/hifi-fixture`, private, at <https://github.com/nagmudit/hifi-fixture>. A small Next.js site called Acme Notes with a pricing page and a Vitest suite. Local clone at `C:\Mudit\Projects\hifi-fixture`. `npm test` passes 6 tests and `npm run build` succeeds.
- **The fixture's `main` is protected:** one approving review required, force pushes and deletions blocked, admins not enforced so the owner can still push.
- `apps/bot` connects to the Discord gateway and does nothing else. Without `DISCORD_BOT_TOKEN` it logs a warning and exits 0.
- `apps/worker` consumes from `hifi-jobs`, validates the payload with Zod, and throws `job pipeline not implemented (M2)`.
- `packages/agent` and `packages/github` are interfaces with no implementation.
- The job state machine and credential sealing are implemented and tested. Nothing calls them.
- The code is provider-neutral in shape. `provider` is a free string everywhere; the only Anthropic-specific code is the redactor list and the Claude subscription-token refusal, which stays.

## Desired behaviour

1. A mention in the configured channel creates a thread and a status message within about three seconds.
2. A `Job` row exists, keyed to the Discord message ID, and a queue entry follows it.
3. The worker claims the job, prepares a worktree from a bare mirror, and runs OpenCode headlessly against the prompt, with model traffic going through the loopback proxy.
4. A branch is pushed and a pull request opened, never against the default branch.
5. The status message is edited with the pull request link and a one-line summary.
6. Re-delivering the same Discord message does not produce a second pull request.

## Scope

**In:** the bot message handler for text prompts, the job pipeline through `reporting`, `OpenCodeEngine`, GitHub App auth, mirror and worktree management, branch safety, pull request creation, the loopback model proxy for the OpenAI protocol, and the integration test with a stubbed engine.

**Out:** image attachments and R2, now M3. Anthropic and OpenRouter, now M3. Test generation and execution, screenshots, preview URLs, the rich embed, cancellation, the dashboard, Stripe, sealed credential storage, per-tenant machines, and database channel bindings, all M3 and M4. Vercel deployment of the fixture, which matters only once previews exist in M3.

Single tenant means the `M2_*` variables in `.env.example` stand in for tenant, repository, and binding rows. The worker still writes real rows so the pipeline exercises the real schema.

## Approach

1. **Fixture repository.** Done.
2. **Everything that needs no credentials, while they are being gathered.** Branch safety with unit tests. Mirror, worktree, and branch plumbing tested against a local bare repository over a `file://` URL, which is a better test than a network remote anyway. The proxy tested against a fake upstream. The integration test skeleton with a stubbed engine.
3. **GitHub App against the real fixture** once the App exists: mint an installation token, clone, push a hand-written commit to a branch, open a pull request. No model involved.
4. **Model proxy for the OpenAI protocol,** so the key never reaches the agent environment even in development. `ADR-002`, `ADR-006`.
5. **`OpenCodeEngine` last,** behind the interface, pointed at the proxy.
6. **Bot handler,** then the full loop from a real Discord mention.

Step 2 onward touches several packages and the credential path, so per `CLAUDE.md` it starts in plan mode.

## Milestones

- [x] Fixture repository created and pushed
- [x] Fixture `main` protected
- [ ] Development credentials in `.env`, per `docs/runbooks/dev-credentials.md`
- [ ] Branch safety check, with unit tests for the refusal paths
- [ ] Mirror, worktree, branch plumbing, tested against a local bare repository
- [ ] GitHub App: installation token minting against the real fixture
- [ ] Push and pull request against the fixture, proven without an agent
- [ ] Redactor: a test for an OpenAI key, plus prefixes for the M3 providers
- [ ] Loopback model proxy for the OpenAI protocol, with usage parsing, streaming included
- [ ] Per-job token ceiling in the proxy from `M2_JOB_TOKEN_CEILING`, with output tokens clamped to the remaining budget. `ADR-008`
- [ ] `OpenCodeEngine`
- [ ] Bot message handler: thread, status message, enqueue
- [ ] Worker pipeline through `reporting`, writing `JobEvent` on every transition
- [ ] Integration test with a stubbed engine
- [ ] Job deadline and the watchdog that enforces it

## Test prompts for the fixture

Kept here rather than in the fixture, because anything in the fixture is read by the agent and would bias it.

| Prompt | Exercises |
|---|---|
| Fix the typo in the homepage headline | a one-word mechanical change; the headline says "Wellcome" on purpose |
| Add annual billing at ten times the monthly price, shown on the pricing page, with tests | a logic change touching `lib/pricing.ts` and its tests |
| Make the primary button indigo with rounded corners | a visual change, for screenshots in M3 |
| Make the pricing page better | deliberately vague; should trigger a clarifying question in M3 |

## Log

### 2026-09-15
- Did: built the repository context system, Tier 2. No pipeline work yet.
- Found: nothing in this plan is blocked by code. It is blocked on three external accounts.

### 2026-09-16
- Did: recorded the multi-surface direction as `ADR-005`. Still no pipeline work.
- Found: Discord coupling lives almost entirely in the schema, seven columns across four models.
- Decided: M2 stays Discord-only and hardcoded.

### 2026-09-20
- Did: created and pushed the fixture as a private repository on the user's personal account, and protected its `main`. Wrote `ADR-006` for any model provider and `ADR-007` for sign-in and connections. Wrote the development credentials runbook. Updated `.env.example`, and added the new variable names to the local `.env` without reading its values.
- Found: branch protection applied to a private repository on this personal account without error, so the two-layer branch rule can be tested for real.
- Found: the original brief's Discord permission list omits View Channels. Added to the invite URL and the requirements.
- Decided: OpenAI is the M2 provider, with a cheap model chosen from what the key can reach. Image attachments move to M3 so M2 needs no R2 credentials.
- Ran: fixture `npm test`, 6 pass. Fixture `npm run build`, succeeds. HiFi `pnpm test` unchanged at 29 pass.
- Blocked: on the user filling `.env`. Step 2 of the approach does not need it and can start now.
- Decided, later the same day: the user accepted `ADR-007`, and asked for customer-configurable budgets, recorded as `ADR-008`. Its per-job token ceiling joins M2 because the proxy counts tokens anyway, and it protects the development key from the first run.
- Did: filled `M2_REPO_FULL_NAME` and set `M2_JOB_TOKEN_CEILING` in the local `.env`, neither of which is secret. All other M2 credentials are still empty.

## Decisions

**Model key goes to a loopback proxy, not the agent environment** - `ADR-002`. The engine takes `access`, not `apiKey`.

**Budgets are enforced by the proxy, mid-run** - `ADR-008`. M2 implements only the per-job token ceiling, but counts atomically from the start so the workspace budgets in M3 extend it rather than replace it.

**Any model provider, through two wire protocols** - `ADR-006`. M2 builds only the OpenAI side of the proxy, but builds it as a pass-through so the Anthropic side in M3 is a second parser, not a redesign.

**A job ends when the pull request opens** - `ADR-003`. No preview handling in M2.

**Clarification parks the job and resumes by re-running** - `ADR-004`. `waiting_input` may stay unreachable in M2.

**The fixture is scaffolded, private, and on the user's personal account.** The accepted risk is that real repositories break on dependency installation in ways a fresh Next.js app never will. Point HiFi at a real repository once before calling M2 done.

**The development GitHub App lives on the personal account and is installed on the fixture only.** HiFi never uses the user's personal token, even in development. The `gh` CLI was used once, by the agent, to create the fixture; the product path is the App.

**A cheap model for development.** Accepted consequence: some failed edits will be model weakness rather than pipeline bugs. The stubbed-engine integration test separates the two.

## Open questions

1. **Credentials.** The user fills `.env` following `docs/runbooks/dev-credentials.md`: Discord bot, test server and channel IDs, the GitHub App and its installation ID, and an OpenAI key with a hard spend ceiling. Blocks approach step 3 onward.

`ADR-007` was accepted on 2026-09-20 and is no longer open.

## Remaining

The next agent's first action: enter plan mode and plan approach step 2, the credential-free work: branch safety, local git plumbing, the proxy against a fake upstream, and the integration test skeleton. Do not wait for credentials to start it.

When the user says `.env` is filled, verify every M2 variable is set and the `.pem` path exists, without printing any value, then list the models the OpenAI key can reach and pick a small one.

## Done when

- A mention in the configured Discord channel produces a pull request on the fixture, and the thread shows the link.
- The pull request contains a real change matching the request, not a placeholder.
- Re-running the same message produces no second pull request.
- A deliberate attempt to push to `main` is refused by HiFi's own check, before GitHub's protection is ever reached.
- A job given a tiny token ceiling is stopped by the proxy mid-run, reports what it spent, and opens no pull request.
- The integration test passes with a stubbed engine.
- A job that hangs is terminated by the watchdog rather than running forever.
- The same flow has been tried once against a real repository, and whatever broke is written down.
