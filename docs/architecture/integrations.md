---
status: current
last_verified: 2026-09-15
applies_to: [packages/github, packages/vercel, apps/api]
---

# External Integrations

Six external services. **None are implemented at M1.** This file records what each one is for, what it needs, and which milestone builds it, so the shape does not have to be re-derived from the brief.

| Service | Purpose | Credential | Milestone |
|---|---|---|---|
| Discord | the product surface | one shared application, bot token | M2 |
| GitHub | repository access, pull requests, deployment events | one shared App, per-installation tokens | M2 |
| Model provider | the coding agent itself | customer's own key, sealed | M2 |
| Cloudflare R2 | attachments, screenshots, logs | account key | M2 |
| Vercel | preview URLs | none by default | M3 |
| Stripe | subscription and metered usage | account key | M5 |

## Discord

One application serves every tenant; customers install it into their guild. Scopes `bot` and `applications.commands`. Permissions: Send Messages, Create Public Threads, Send Messages in Threads, Read Message History, Attach Files, Embed Links. Server admins can rename the bot per guild for branding.

`MessageContent` is a privileged intent and must be enabled in the developer portal. It requires verification once the bot is in more than 100 servers, which is a launch blocker worth scheduling early.

Attachment URLs are signed and expire. Download inside the handler, never persist the CDN link.

## GitHub

One App, installed per customer organisation. Permissions: Contents read/write, Pull requests read/write, Metadata read, Deployments read, Checks read. Subscribed events: `installation`, `installation_repositories`, `deployment_status`, `pull_request`.

Installation tokens expire after an hour and are minted per job, never cached across jobs. Personal access tokens are never created or accepted anywhere in the product.

`pull_request` matters beyond the job itself: whether a pull request is later merged or closed is the training label for a learned router, which is why `Job.prMergedAt` and `prClosedAt` exist from the start.

## Model providers

Three supported paths: an Anthropic Console API key, an OpenRouter key, or AWS Bedrock and Google Vertex credentials. Keys are validated with a cheap live call before saving and sealed immediately.

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
