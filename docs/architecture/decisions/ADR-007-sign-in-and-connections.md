# ADR-007: Sign in with GitHub; everything else is a connection

**Status:** accepted - **Date:** 2026-09-20 - accepted by the product owner the same day

This overrides two fixed choices in the original brief: Discord OAuth as the dashboard identity provider, and one tenant per Discord guild. The override is deliberate and approved. Nothing here is implemented yet; it lands in M4.

## Context

The brief made Discord the identity provider for the dashboard and made each Discord guild a tenant. Both made sense when Discord was the only surface.

With Slack and email planned in `ADR-005`, a customer may never use Discord at all. A Slack-only team would have to create a Discord account just to log in to a product it reaches through Slack.

Every customer does have one account in common. HiFi opens pull requests on GitHub, so a customer without GitHub cannot use the product at all.

## Decision

**The dashboard signs in with GitHub.** This uses the user-authorisation flow of the same GitHub App that grants repository access, so there is one GitHub integration, not two.

**A tenant is a HiFi workspace created at sign-up,** not a Discord guild. Surfaces attach to it as `SurfaceAccount` records, per `ADR-005`, so one workspace can hold a Discord guild and a Slack workspace at once.

**Everything else is a connection.** Each one is a separate consent screen, stored separately, and revocable without touching the others.

| Connection | How the customer grants it | What we store |
|---|---|---|
| GitHub repositories | install the GitHub App, choosing which repositories | installation ID; tokens are minted per job |
| Discord | add the bot to a server | guild ID; one shared bot token serves every tenant |
| Slack | install the Slack app to a workspace | sealed per-workspace bot token |
| Email | a hosted address, or Gmail OAuth; see `ADR-005` | depends on the path chosen |
| Model provider | paste a key, validated before saving | sealed key, plus base URL for a custom endpoint |

**People who only make requests need no HiFi account.** A member of a bound Discord channel can request a job without ever signing in. They appear as an unlinked surface identity, and link to a HiFi user only if they sign in later. Membership and roles matter for the dashboard, not for asking the bot for a change.

## Why a GitHub App, not an OAuth app

"Connect your GitHub" looks the same to the customer either way, a GitHub consent screen. What sits behind it is very different.

| | OAuth app with `repo` scope | GitHub App |
|---|---|---|
| Repository access | every repository the user can see, public and private | only the repositories the customer selects |
| Token lifetime | until someone revokes it | one hour, minted fresh per job |
| Owned by | the person who clicked | the account or organisation |
| When that person leaves the company | access breaks or silently lingers | unaffected |
| Permission granularity | coarse scopes | per permission, read or write |

The GitHub App column is also what controls R-42 and S-4 already require. A GitHub App installs on a personal account as readily as on an organisation, which is how the development fixture works.

## Alternatives

**Keep Discord OAuth as the identity provider.** Breaks for every Slack-only or email-only customer.

**Email and password, or a hosted identity product.** Adds a credential store or a vendor, and still ends with the customer connecting GitHub immediately afterwards. It saves nothing.

**Sign in with whichever surface the customer arrived from.** Produces one person with several unlinked accounts, which is the problem `SurfaceIdentity` in `ADR-005` exists to solve.

## Consequences

**The brief's fixed decision on dashboard auth changes.** This ADR records the override, and it was accepted explicitly rather than inferred. Where the original brief and this ADR disagree about sign-in or tenancy, this ADR wins.

**Tenant creation moves** from the Discord install callback to sign-up. Installing the bot becomes a step inside an existing workspace rather than the event that creates one.

**Model providers are not OAuth connections.** Providers issue API keys, not delegated access, so onboarding pastes a key. OpenRouter is the likely exception, since it offers an OAuth flow that returns a key; that would be a convenience, not a new trust model.

**Gmail is where "connect" is expensive.** The stated preference is that customers connect their Gmail. That is the Gmail API path in `ADR-005`, which needs restricted scopes, Google app verification, and, as of the last review, an annual third-party security assessment. The hosted-address path gives an email surface without any of that. The choice is deferred to M7 but should be made before anything is promised to customers.

## Related

`ADR-005` for surfaces and identity linking, `docs/architecture/integrations.md`, requirements R-20 to R-25 and R-70 onward.
