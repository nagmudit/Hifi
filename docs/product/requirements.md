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
| R-22 | Attach a model provider: Anthropic Console key, OpenRouter, or Bedrock/Vertex. Validate with a cheap live call, then seal immediately | proposed |
| R-23 | Bind Discord channels to repositories | proposed |
| R-24 | Optionally attach Vercel; the default path needs no Vercel credential at all | proposed |
| R-25 | Stripe Checkout subscription, metered job completions, quota enforcement with an upgrade link in Discord | proposed |

**R-20 scopes:** `bot` and `applications.commands`. **Permissions:** Send Messages, Create Public Threads, Send Messages in Threads, Read Message History, Attach Files, Embed Links. A server admin can rename the bot per guild for branding.

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
| R-46 | Per-tenant monthly spend cap with a hard stop and a Discord notification |
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
