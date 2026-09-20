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
- **The pipeline works end to end without Discord.** `pnpm --filter @hifi/worker enqueue "<request>"` puts a real job on the queue; the worker takes it from `claimed` to `succeeded` and opens a pull request. Proven twice against the fixture, pull requests #2 and #3.
- `packages/github` is implemented: App authentication, mirrors, worktrees, branch safety, push, pull requests.
- `packages/agent` ships `OpenCodeEngine`, driving the CLI headlessly through the loopback proxy.
- `apps/worker` runs the state machine, the model proxy, and the per-job token ceiling.
- `apps/bot` still only connects to the Discord gateway. Without `DISCORD_BOT_TOKEN` it logs a warning and exits 0. **This is the remaining gap: chunk C.**
- Nothing writes to Discord yet, and no job deadline is enforced.
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
- [x] Development credentials in `.env`, per `docs/runbooks/dev-credentials.md`
- [x] Branch safety check, with unit tests for the refusal paths
- [x] Mirror, worktree, branch plumbing, tested against a local bare repository
- [x] GitHub App: installation token minting against the real fixture
- [x] Push and pull request against the fixture, proven without an agent
- [ ] Redactor: a test for an OpenAI key, plus prefixes for the M3 providers
- [x] Loopback model proxy for the OpenAI protocol, with usage parsing, streaming included
- [x] Per-job token ceiling in the proxy from `M2_JOB_TOKEN_CEILING`, with output tokens clamped to the remaining budget. `ADR-008`
- [x] `OpenCodeEngine`
- [ ] Bot message handler: thread, status message, enqueue
- [x] Worker pipeline through `reporting`, writing `JobEvent` on every transition
- [x] Integration test with a stubbed engine
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

### 2026-09-20, later: chunk A

- Did: implemented `packages/github`. App authentication, an HTTP wrapper giving every GitHub call a timeout and a jittered retry, the branch-safety check, git mirror and worktree plumbing, and pull request operations.
- Decided: the installation token is injected into git through `GIT_CONFIG_COUNT` environment variables rather than the remote URL or `-c`. A token in the URL is written into the mirror config and leaks into error output; a token in `-c` is visible in the process list. Neither is acceptable on a machine that also runs the customer's install scripts.
- Found: `git clone --mirror` sets `remote.origin.mirror`, which a worktree inherits, and git then refuses **any** push carrying a refspec. Caught by the local-bare-repo test, and it would have failed identically in production. Fixed by overriding the setting per push rather than mutating the mirror.
- Found: error messages said `git -c failed` whenever a command used `-c`, which also affected commits. Messages now report the real subcommand.
- Ran: `pnpm test`, 51 pass, up from 29. `pnpm typecheck` clean.
- Ran: the chunk A proof against the real fixture. Minted a token, mirrored, branched, committed a hand-written fix for the seeded typo, pushed, opened pull request #1, confirmed the idempotency lookup finds it, then closed the pull request and deleted the branch. Branch safety refused `main` and `feature/whatever`; the cross-repository guard refused a pull request against another repository.
- Found: the App can read the fixture's protected branch list, which returns `main`. The second opinion is available, not just the prefix rule.

### 2026-09-20, later still: chunk B

- Did: built the model proxy, the OpenCode engine, and the worker pipeline. A job now runs from a queue entry to a pull request with no Discord involved.
- Ran: `pnpm test:env`, 74 pass, up from 51. Two real jobs against the fixture, producing pull requests #2 and #3, both left open for review.
- Found, by running the CLI rather than trusting the docs, four things that each blocked the run completely:
  - **stdin must be closed.** With an open pipe OpenCode hangs forever after init, with no output and no error. This cost the most time to find.
  - **`--dir` must be passed explicitly.** Without it the session resolves against the wrong project and reports the configured model as not found, even though `opencode models` lists it.
  - **the binary is a native executable**, so it is spawned directly. Windows refuses to spawn the `.CMD` shim without a shell.
  - **the config file is written into the working tree**, so the engine deletes it afterwards or it lands in the customer's commit.
- Found: gpt-5 models reject `max_tokens` and require `max_completion_tokens`, while most OpenAI-compatible servers accept only the older spelling. The proxy renames it as a per-provider quirk rather than a blanket rewrite, which would break the compatible ones.
- Found: the proxy's upstream base already ends in `/v1`, so the engine's base URL must be the proxy root. Getting this wrong produced a 404 from the provider rather than anything informative.
- Found: `prisma generate` fails with `EPERM` on Windows while the worker is running, because it holds the query engine open. Added to the commands gotchas.
- Fixed after reading the first pull request: the title truncated mid-word, and the agent's summary offered to commit and open a pull request that HiFi had already opened. The preamble now tells the agent that pushing is handled for it.
- Decided: status travels worker to bot over Redis pub/sub rather than the worker calling Discord. The worker runs the customer's install scripts, so a bot token in that process would be readable by any postinstall hook, which is ADR-002's argument applied to a second credential.
- Note: cost is reported as unknown rather than guessed, because no price is recorded for `gpt-5-mini`. That is ADR-006 working as intended, and M3's registry fills it in.

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
