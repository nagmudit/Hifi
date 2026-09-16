# ADR-005: One job core, several conversation surfaces

**Status:** proposed - **Date:** 2026-09-16

The product direction is decided: HiFi will accept work from Slack and from email as well as Discord. The design below is not. Nothing in this ADR is implemented.

## Context

Today every surface concept in the schema is Discord-shaped. Seven columns across four models:

| Model | Column | Generalises to |
|---|---|---|
| `Tenant` | `discordGuildId` unique | the workspace or account on some surface |
| `User` | `discordUserId` unique | one human, who may exist on several surfaces |
| `ChannelBinding` | `discordChannelId` unique | a channel, a Slack channel, or an inbox address |
| `Job` | `discordChannelId` | where the request arrived |
| `Job` | `discordMessageId` unique | the request, and the idempotency key |
| `Job` | `discordThreadId` | the conversation the reply belongs to |
| `Job` | `discordStatusMessageId` | the message being edited in place |

The code is barely coupled at all. A search across `packages/` finds Discord in comments, in one `snowflake` Zod schema, and in one sentence of the agent preamble. `discord.js` appears in exactly one app. The job pipeline, the state machine, the sealing, and the router know nothing about Discord.

So the coupling is almost entirely in the data model, and the data model currently has zero production rows.

M4 rewrites tenant resolution, user records, and channel bindings anyway, because that is what multi-tenancy is.

## Decision

Introduce the surface abstraction **during M4**, not after, and build the Slack and email adapters later as their own milestone.

Three shapes change.

**Identity.** `Tenant.discordGuildId` becomes a `SurfaceAccount` record: a surface enum, an external ID, and a tenant. One tenant may own a Discord guild and a Slack workspace at once. `User.discordUserId` becomes `SurfaceIdentity` rows pointing at one `User`, so the same person in Slack and Discord is one person with one role.

**Binding.** `ChannelBinding.discordChannelId` becomes a surface plus an external channel ID, with the unique constraint on the pair.

**Job.** The four `discord*` columns become `surface`, `conversationId`, `requestId` (unique, still the idempotency key), `threadId`, and `statusRef`.

**Adapter.** A `Surface` interface in a new package, with roughly: acknowledge a request, update a status in place, post the final report, fetch an attachment. The worker calls the interface and never imports `discord.js`.

## Rationale

The change costs seven columns and one onboarding flow today. After M4 ships to real tenants it costs the same seven columns plus a live data migration, a second onboarding flow written against the old shape, and every query that assumed a guild ID.

The abstraction is also cheap to get right because there is a real second surface to check it against. Designing `Surface` with only Discord in view would produce an interface shaped exactly like Discord, which is the usual way this fails.

## Alternatives

**Generalise at M7, when Slack is actually built.** Cheapest now and most expensive later. It also guarantees two onboarding flows and two tenant-resolution paths that have to be merged under production data.

**Build all three surfaces at once.** Delays everything that makes money, and email is not chat-shaped, so it would hold up the two surfaces that are.

**A separate product per surface.** Duplicates the job pipeline, the billing, and the credential handling. Rejected without much thought.

## Consequences

**M4 gets bigger.** That is the cost, and it is real. The mitigation is that M4 is already rewriting these exact tables.

**Email is not a chat surface, and the abstraction must not pretend otherwise.** There is no channel, no guaranteed thread, no presence, and no reaction to cancel a job with. A binding is an address rather than a channel, the status message cannot be edited in place, and the whole "one status message that changes" pattern does not survive. Email likely gets one acknowledgement and one final report, which the interface has to allow.

**Email identity is weak in a way Discord identity is not.** Discord tells us who wrote a message. An inbound email claims a sender, and the claim is forgeable without verified DKIM and SPF alignment. A surface that lets anyone who can guess an address run a coding agent against a private repository is a new attack path, not a new feature. Tracked as S-12 in the security model.

**The deployment shape differs per surface.** Discord needs a long-lived gateway process, which is why `apps/bot` exists and cannot scale horizontally. Slack is HTTP: events arrive at `apps/api` as signed webhooks, so a Slack adapter needs no gateway process at all. Email is neither, and depends on the ingestion choice below.

**Formatting is per surface and not worth abstracting away.** Discord embeds, Slack Block Kit, and an HTML email are different enough that a lowest common denominator would be worse than three renderers over one shared result type.

## Open design question: how email arrives

Two paths, and the choice has an outsized effect on cost.

**A HiFi-hosted inbound address.** Customers send or forward to something like `<tenant>@in.hifi.example`. No Google OAuth, no Gmail API, no Google app verification. Works for any mail provider, not just Gmail. Weakest identity story, so it needs a sender allowlist per binding.

**Gmail API watch on the customer's mailbox.** Reads their real inbox. It needs Gmail restricted scopes, which as of the last review require Google app verification plus an annual third-party security assessment. Verify current requirements before committing, because that is a schedule risk measured in months, not days.

The first path is strongly preferred for a first version. The second buys very little that forwarding does not, at a cost that could dominate the milestone.

## Related

`packages/db/prisma/schema.prisma`, `docs/architecture/integrations.md`, `docs/architecture/security-model.md` control S-12, `docs/plans/backlog.md` M7, and `ADR-001`, since a Slack workspace and a Discord guild belonging to one tenant must map to one machine, not two.
