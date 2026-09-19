---
status: current
last_verified: 2026-09-15
applies_to: [.]
---

# Requirements

Distilled from the original product brief. Status is per requirement and verified against code on the date above. `proposed` means it does not exist yet.

## Legend

`done` - implemented and verified. `partial` - some of it exists. `proposed` - specified, not built.

## Core job loop

| ID | Requirement | Status | Where |
|---|---|---|---|
| R-01 | Bot acknowledges in a new Discord thread within about 3 seconds of a mention | proposed | M2 |
| R-02 | Attachments are downloaded to object storage inside the gateway handler, because Discord CDN links are signed and expire | proposed | M2 |
| R-03 | Channel-to-repo binding resolves which repository a task belongs to; unbound channels are ignored silently | proposed | M4 (schema done) |
| R-04 | Fresh working tree per job from a warm bare mirror; the mirror persists, the worktree never does | proposed | M2 |
| R-05 | Agent runs headlessly behind a swappable engine interface | partial | `packages/agent` interface only |
| R-06 | Tests covering the change are written, then the repository suite is run | proposed | M3 |
| R-07 | Never report success when tests are red; exactly one repair attempt | proposed | M3 |
| R-08 | Visual changes captured with before and after screenshots at desktop and mobile widths | proposed | M3 |
| R-09 | Branch pushed and pull request opened; never a push to a default or protected branch | proposed | M2 |
| R-10 | Preview URL read from the GitHub deployment webhook, never by polling Vercel | proposed | M3, see ADR-003 |
| R-11 | Final report edits the original status message into a rich embed with pull request, preview, tests, screenshots, model, tokens, cost, duration | proposed | M3 |
| R-12 | Hard wall-clock timeout per job, default 20 minutes, plus a max-turns cap | partial | constants defined, unenforced |
| R-13 | Cancellation by slash command and by reaction on the thread | proposed | M3 |
| R-14 | Jobs idempotent on retry: re-running a claimed job must not open a second pull request | partial | unique constraint on `Job.discordMessageId` |
| R-15 | A job that cannot proceed asks one specific question and parks without holding a concurrency slot | partial | `waiting_input` state exists, see ADR-004 |

## Onboarding

Five steps, each resumable and independently revocable. A tenant is unusable until steps 1 to 4 are done. All `proposed`, targeted at M4 and M5.

| ID | Requirement | Status |
|---|---|---|
| R-20 | Install the Discord bot from one shared Discord application, scoped to the customer guild | proposed |
| R-21 | Install the GitHub App from one shared app, with `state` carrying the tenant ID; sync the repository list on callback | proposed |
| R-22 | Attach one or more model providers, from any vendor. Validate before saving, then seal immediately. Detail in R-60 onward and `ADR-006` | proposed |
| R-23 | Bind Discord channels to repositories | proposed |
| R-24 | Optionally attach Vercel; the default path needs no Vercel credential at all | proposed |
| R-25 | Stripe Checkout subscription, metered job completions, quota enforcement with an upgrade link in Discord | proposed |

**R-20 scopes:** `bot` and `applications.commands`. **Permissions:** View Channels, Send Messages, Create Public Threads, Send Messages in Threads, Read Message History, Attach Files, Embed Links. A server admin can rename the bot per guild for branding. View Channels was missing from the original brief; without it the bot depends on the server's default role letting it see the channel.

**R-21 permissions:** Contents read/write, Pull requests read/write, Metadata read, Deployments read, Checks read. **Webhook events:** `installation`, `installation_repositories`, `deployment_status`, `pull_request`.

**R-22 constraint:** Claude Pro, Max, and Team subscription credentials cannot be used. Subscription OAuth tokens are rejected by the Anthropic API for third-party integrations. The onboarding UI must say so, and a key beginning `sk-ant-oat` must be refused with a clear message. Implemented in `rejectionReason`, `packages/crypto/src/redact.ts`, and covered by tests.

## Model routing

| ID | Requirement | Status |
|---|---|---|
| R-30 | Rules-based selection in v1; nothing learned | proposed |
| R-31 | Images force a vision-capable model for the pre-pass, read from the registry and never inferred from the model name | proposed |
| R-32 | Short mechanical prompts route to the cheap tier | proposed |
| R-33 | A retry after failure escalates one tier | proposed |
| R-34 | Images are converted to a textual spec in one pre-pass, then kept out of the agent turn loop | proposed |
| R-35 | Every job logs prompt, signals, model, tokens, cost, duration, test outcome, and later whether the pull request merged | partial | `Job` columns exist and are unwritten |

R-35 is the training label for a learned router later. The logging is built first, deliberately.

## Model providers

Added 2026-09-20. Direction and design accepted in `ADR-006`.

| ID | Requirement | Status |
|---|---|---|
| R-60 | No provider is privileged. Any vendor a customer brings is a supported configuration, not an exception | partial: code is provider-neutral in shape; nothing runs yet |
| R-61 | OpenAI supported first-class | proposed, M2 |
| R-62 | Anthropic and OpenRouter supported first-class | proposed, M3 |
| R-63 | Any OpenAI-compatible endpoint, configured as base URL plus key plus model ID | proposed, M5 |
| R-64 | Bedrock, Vertex, and Azure OpenAI, which need request signing or deployment URLs | proposed, after M6 |
| R-65 | A key is validated by listing the models it can reach, which spends no tokens | proposed, M2 |
| R-66 | A price is never invented. Unknown pricing is shown as unknown, and the spend cap falls back to a token ceiling | proposed, M3 |
| R-67 | A tenant may hold keys for several providers at once, and the router may choose between them | proposed, M3 |

Claude models are supported through an Anthropic Console key, or through OpenRouter, Bedrock, or Vertex. Claude subscription tokens remain refused; see the R-22 constraint above.

## Sign-in and connections

Added 2026-09-20. Accepted in `ADR-007`, which overrides the brief's choice of Discord as the dashboard identity provider. Statuses below are `proposed` in the implementation sense: decided, not yet built.

| ID | Requirement | Status |
|---|---|---|
| R-70 | The dashboard signs in with GitHub, through the same GitHub App that grants repository access | proposed, M4 |
| R-71 | A tenant is a workspace created at sign-up, not a Discord guild | proposed, M4 |
| R-72 | GitHub, Discord, Slack, email, and each model provider are separate connections, each independently revocable | proposed, M4 to M7 |
| R-73 | Repository access is a GitHub App installation with selected repositories, never an OAuth token with `repo` scope | proposed, M2 for development, M4 for customers |
| R-74 | Someone who only makes requests in a bound channel needs no HiFi account | proposed, M4 |

## Budgets

Added 2026-09-20 at the product owner's request. Accepted in `ADR-008`. The customer sets limits in HiFi so an agent using their key cannot keep consuming tokens.

| ID | Requirement | Status |
|---|---|---|
| R-80 | A per-job budget stops one runaway agent run mid-flight | proposed: token ceiling in M2, dollar budget in M3 |
| R-81 | Daily and monthly budgets per workspace, set by the customer | proposed, enforced M3, configurable in the dashboard M5 |
| R-82 | Optional per-user and per-channel budgets | proposed, M6 |
| R-83 | Any budget can be set in dollars or in tokens; unknown model prices fall back to tokens | proposed, M3 |
| R-84 | Budgets are enforced by the model proxy between model calls, not only checked at job start | proposed, M2 for the job ceiling |
| R-85 | Concurrent jobs share budget counters atomically, so they cannot jointly overshoot | proposed, M3 |
| R-86 | Each request's output is capped to what the remaining budget can pay for, bounding overshoot | proposed, M2 |
| R-87 | Notifications at 50% and 80% of a period budget; a clear stop message at 100% with a link to the budget settings | proposed, M3 for messages, M5 for the link |
| R-88 | A job stopped by a budget reports what it changed and spent, and never opens a pull request for a half-finished change | proposed, M2 |
| R-89 | The dashboard shows spend against every budget, current period and history | proposed, M5 |

## Conversation surfaces

Added 2026-09-16, after the original brief. Direction is decided; design is `proposed` in `ADR-005`. All of this is M7 except R-50, which belongs to M4.

| ID | Requirement | Status |
|---|---|---|
| R-50 | Tenant identity, user identity, bindings, and jobs are keyed by surface plus external ID rather than by Discord IDs | proposed, M4 |
| R-51 | A `Surface` adapter interface; the worker never imports a surface SDK | proposed, M4 |
| R-52 | One human with accounts on two surfaces is one `User` with one role | proposed, M4 |
| R-53 | Slack: request from a bound Slack channel produces the same job as Discord does | proposed, M7 |
| R-54 | Slack arrives as signed HTTP events at the API, with no gateway process | proposed, M7 |
| R-55 | Email: a request sent to a bound address produces a job, with one acknowledgement and one final report rather than an edited status message | proposed, M7 |
| R-56 | Email sender identity is verified before a job runs; an unverified or unlisted sender is refused | proposed, M7 |
| R-57 | One tenant may hold several surface accounts, and they share one worker machine and one quota | proposed, M4 |

The reporting format is per surface by design: Discord embeds, Slack Block Kit, and HTML email. Only the result type is shared.

## Non-negotiable constraints

These come from the brief marked as build failures if violated. Detail and current enforcement status in `docs/architecture/security-model.md`.

| ID | Constraint |
|---|---|
| R-40 | Tenant isolation is the machine boundary: one Fly Machine and one volume per tenant |
| R-41 | Credentials never exist as plaintext at rest; a log redactor is the last line of defence |
| R-42 | GitHub tokens are short-lived, minted per job, never personal access tokens |
| R-43 | Never push to a protected branch, enforced in code as well as by GitHub branch protection |
| R-44 | Repository contents, issue text, and screenshots are untrusted input, not instructions |
| R-45 | Worker egress is allowlisted to the model provider, GitHub, the package registry, and object storage |
| R-46 | Per-tenant monthly spend cap with a hard stop and a notification. Extended into customer-configurable budgets by R-80 onward |
| R-47 | Rate limits per user and per channel |

## Milestones

Ordered, and each one stops for confirmation before the next begins.

| Milestone | Scope | Status |
|---|---|---|
| M1 | Monorepo, schema, migrations, Fly config, local infra. Prove it boots. | done |
| M2 | Single tenant, hardcoded credentials. Mention to pull request, end to end. | active |
| M3 | Tests, screenshots, preview URL, rich embed, cancellation, timeouts, retries. | not started |
| M4 | Multi-tenancy, sealed credentials, per-tenant machines, install flows, bindings. | not started |
| M5 | Dashboard, onboarding wizard, Stripe subscription and metering. | not started |
| M6 | Egress allowlist, log redaction, spend caps, rate limits, telemetry, runbooks. | not started |
| M7 | Slack and email surfaces on top of the M4 abstraction. | not started |
