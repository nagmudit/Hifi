---
status: current
last_verified: 2026-09-15
---

# Backlog

Milestones after the active one. Each is gated: work stops for confirmation at the end of each milestone before the next begins.

## M3 - Job quality

Turns a working loop into a usable product.

- Test generation, then execution of the repository's own suite, with parsed pass/fail counts.
- Exactly one repair attempt on a red suite, then honest reporting either way.
- Playwright screenshots at desktop and mobile widths, before and after where feasible, with failure treated as non-fatal.
- Preview URL through the detached watcher on the GitHub deployment webhook.
- The full rich Discord embed: summary, file list with line counts, pull request, preview, tests, screenshots, model, tokens, cost, duration.
- Cancellation by slash command and by reaction.
- Wall-clock timeout enforcement and the watchdog that moves an expired job to `timed_out`.
- The rules-based model router and the `ModelEntry` registry seed.

## M4 - Multi-tenancy

- Tenant resolution from the surface account, replacing the hardcoded M2 configuration.
- **The surface abstraction, per `ADR-005`.** Tenant identity, user identity, bindings, and the four `discord*` job columns become surface plus external ID, and a `Surface` adapter interface goes in front of `discord.js`. Done here rather than at M7 because M4 rewrites these exact tables anyway, and because doing it afterwards means migrating live tenant data.
- Sealed credential storage and the unseal path in the worker.
- Per-tenant Fly Machines and volumes, created through the Machines API.
- Discord OAuth install flow and GitHub App install flow, both with `state` carrying the tenant.
- Channel-to-repo bindings and the quota, concurrency, and suspension checks in the bot.
- Webhook signature verification and delivery-ID deduplication.

## M5 - Dashboard and billing

- The five-step onboarding wizard, each step resumable and revocable.
- Model provider validation with a live call, including the `sk-ant-oat` rejection in the UI.
- Job timeline rendered from `JobEvent`, and usage views.
- Stripe subscription, metered job completions, quota enforcement with an upgrade link in Discord.

## M6 - Hardening

- Egress allowlist on the worker.
- Spend caps enforced by the model proxy.
- Rate limits per user and per channel.
- OpenTelemetry traces spanning mention to pull request.
- Runbooks for the three most likely on-call failures. Not before there is something to be on call for.

## M7 - Slack and email

Only possible if M4 delivered the surface abstraction. If it did not, this milestone starts by paying that debt under production data, which is the outcome `ADR-005` exists to avoid.

**Slack, first and easier.**

- Slack app, per-workspace installation, bot token sealed like any other credential.
- Events arrive as signed HTTP at `apps/api`. No gateway process, no sharding.
- Acknowledge within three seconds or Slack retries, so the handler enqueues and returns, and retries deduplicate through `WebhookEvent`.
- Block Kit renderer for the status message and the final report.

**Email, second and awkward.**

- Decide the ingestion path first. Hosted inbound address is strongly preferred over Gmail API scopes; see the open question in `ADR-005`.
- DKIM and SPF verification plus a per-binding sender allowlist, before any job runs. Control S-12.
- One acknowledgement and one final report. There is no message to edit in place, so the whole progressive-status pattern does not apply.
- HTML renderer for the report.

## Not scheduled

Ideas that are real but have no milestone.

- A learned model router, trained on the merge signal that `Job.prMergedAt` and `prClosedAt` collect from M2 onward.
- A second agent engine behind `AgentEngine`, which is the point of the interface.
- Cold-tenant reaping: destroy an idle tenant's machine and volume, rebuild on demand. See the consequences section of `ADR-001`.
- A short inline preview wait before detaching, if the two-edit Discord message proves annoying in practice.
