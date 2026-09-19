---
status: current
last_verified: 2026-09-15
applies_to: [packages/github, packages/vercel, apps/api]
---

# External Integrations

Eight external services. **None are implemented at M1.** This file records what each one is for, what it needs, and which milestone builds it, so the shape does not have to be re-derived from the brief.

| Service | Purpose | Credential | Milestone |
|---|---|---|---|
| Discord | the product surface | one shared application, bot token | M2 |
| GitHub | repository access, pull requests, deployment events | one shared App, per-installation tokens | M2 |
| Model providers | the coding agent itself, from any vendor | customer's own key, sealed | OpenAI M2, more from M3 |
| Cloudflare R2 | attachments, screenshots, logs | account key | M2 |
| Vercel | preview URLs | none by default | M3 |
| Stripe | subscription and metered usage | account key | M5 |
| Slack | second conversation surface | one shared app, per-workspace bot token | M7 |
| Email | third conversation surface | none, on the hosted-inbox path | M7 |

## Discord

One application serves every tenant; customers install it into their guild. Scopes `bot` and `applications.commands`. Permissions: View Channels, Send Messages, Create Public Threads, Send Messages in Threads, Read Message History, Attach Files, Embed Links, which is the integer `309237763072` in an invite URL. Server admins can rename the bot per guild for branding.

`MessageContent` is a privileged intent and must be enabled in the developer portal. It requires verification once the bot is in more than 100 servers, which is a launch blocker worth scheduling early.

Attachment URLs are signed and expire. Download inside the handler, never persist the CDN link.

## GitHub

One App, installed per customer account or organisation. To the customer this is "connect your GitHub": a GitHub consent screen where they choose which repositories HiFi may touch. It is deliberately not an OAuth app with `repo` scope, which would reach every repository the person can see and live until revoked. `ADR-007` has the comparison, and proposes the same App for dashboard sign-in. Permissions: Contents read/write, Pull requests read/write, Metadata read, Deployments read, Checks read. Subscribed events: `installation`, `installation_repositories`, `deployment_status`, `pull_request`.

Installation tokens expire after an hour and are minted per job, never cached across jobs. Personal access tokens are never created or accepted anywhere in the product.

`pull_request` matters beyond the job itself: whether a pull request is later merged or closed is the training label for a learned router, which is why `Job.prMergedAt` and `prClosedAt` exist from the start.

## Model providers

Any vendor, by design. `ADR-006` has the reasoning; the short version is that two wire protocols cover almost the whole market, the Anthropic Messages API and the OpenAI API shape, and the proxy passes each through untranslated.

| Tier | Providers | When |
|---|---|---|
| First-class | OpenAI | M2 |
| First-class | Anthropic, OpenRouter | M3 |
| Custom endpoint | anything OpenAI-compatible: Groq, Together, DeepSeek, Mistral, Fireworks, xAI, Google, and self-hosted servers reachable over the public internet | M5 |
| Signed | AWS Bedrock, Google Vertex, Azure OpenAI | after M6 |

A key is validated by listing the models it can reach, which costs no tokens and also tells us which model IDs are usable. Keys are sealed immediately after validation.

A custom endpoint must be reachable from our workers over the public internet. A server on the customer's laptop or private network is not, and the base URL is checked against private address ranges before it is ever called. See control S-13.

Claude Pro, Max, and Team subscription credentials do not work here. Subscription OAuth tokens are rejected by the Anthropic API for third-party integrations, so a key beginning `sk-ant-oat` is refused at onboarding with an explicit message. Implemented in `rejectionReason` and covered by tests.

The key is never handed to the agent process. See `ADR-002`.

## Vercel

The default path uses no Vercel credential. If the customer already has Vercel's GitHub integration, preview URLs arrive on the GitHub `deployment_status` webhook and are read from `environment_url` on success.

A Vercel token is optional and buys only two things: build logs when a deploy fails, and the ability to trigger deploys ourselves.

Known rough edges, all of which the implementation must handle rather than assume away: deployments that never produce a GitHub Deployment, several preview URLs for one commit in a monorepo, and pull requests from forks.

## Cloudflare R2

Attachments, screenshots, and full command output. Object keys are stored on the job row; blobs never go in Postgres.

## Stripe

Subscription plus metered usage. Plans differ by monthly job quota and maximum concurrent jobs. Job completions are metered; quota exhaustion blocks new jobs with a Discord message pointing at the upgrade link.

Webhook signature verification is mandatory, and delivery IDs are deduplicated through the `WebhookEvent` table because Stripe retries.

## Slack

Planned for M7, on top of the surface abstraction in `ADR-005`. One shared Slack app, installed per customer workspace, with a bot token stored the same way every other credential is.

Architecturally it is easier than Discord, not harder. Slack delivers events as signed HTTP requests, so they arrive at `apps/api` and need no long-lived gateway process. That means no equivalent of `apps/bot` and no sharding problem.

Two differences that matter. Slack expects an acknowledgement within three seconds or it retries the delivery, so the handler must enqueue and return, and the retry must be deduplicated through `WebhookEvent`. And Slack threads are keyed on the parent message timestamp rather than a thread object, so the status reference is a different shape from Discord's.

Formatting is Block Kit rather than embeds. That is a separate renderer, deliberately.

## Email

Planned for M7 and the least settled of the three. `ADR-005` carries the open design question; the summary is that there are two paths and only one of them is cheap.

**Hosted inbound address, preferred.** Customers send or forward to an address we own. No Google OAuth, no Gmail API, no app verification, and it works for every mail provider rather than Gmail alone.

**Gmail API watch on the customer mailbox.** Needs Gmail restricted scopes, which as of the last review require Google app verification plus an annual third-party security assessment. Confirm the current rules before committing to this: it is a schedule risk measured in months.

Whichever path, email breaks three assumptions the Discord design leans on. There is no channel, so a binding points at an address. There is no editable message, so progress cannot be shown in place and the job reports once at the end. And the sender is a claim rather than a fact, which is why sender verification is a hard requirement rather than a nicety. See control S-12.
