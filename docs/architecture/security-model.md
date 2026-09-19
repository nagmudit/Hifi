---
status: current
last_verified: 2026-09-15
applies_to: [packages/crypto, apps/worker, packages/github]
---

# Security Model

The brief marks these as build failures if violated. This file records each one, how it is meant to be enforced, and what is actually enforced today. **Most are not enforced yet.** Treat the status column as the honest answer.

## The threat that shapes the design

A job runs the customer's own repository code: install scripts, the test suite, and a development server. All of that is arbitrary code executing inside our worker, with a customer credential somewhere in the process. Every control below is downstream of that fact.

Separately, the agent reads repository files, issue text, and screenshots, any of which can contain text written to manipulate it.

## Controls

| # | Control | Enforcement | Status |
|---|---|---|---|
| S-1 | One Fly Machine and one volume per tenant. Mirrors, caches, credentials, and worktrees never shared across tenants. Within a tenant, jobs may share, which is accepted because it is all one customer's own code. | infrastructure | proposed, M4. See `ADR-001` |
| S-2 | Credentials never at rest as plaintext. Unsealed into worker memory at job start only. | `packages/crypto` | sealing done and tested; nothing stores a credential yet |
| S-3 | Log redactor scrubs known key prefixes as a last line of defence. Gains a prefix for each first-class provider as it lands. | `redactSecrets`, wired into `createLogger` | done. Prefixes cover OpenAI, OpenRouter, Anthropic, and GitHub; tests exercise all but OpenAI |
| S-4 | GitHub tokens minted per job from the App installation, never cached, never a personal access token. | `packages/github` | proposed, M2 |
| S-5 | Never push to a default or protected branch. | hard check in the worker, plus customer-side branch protection | proposed, M2 |
| S-6 | Repository contents, issue text, and images are data, never instructions. | `AGENT_SYSTEM_PREAMBLE` plus hard checks | preamble written; checks proposed |
| S-7 | The agent cannot change branch protection, alter its own permissions, modify CI workflow files, or open a pull request against a repo other than the bound one. | hard checks in the worker, **not** prompt instructions | proposed, M2 |
| S-8 | Worker egress allowlisted to the model provider, GitHub, the package registry, and object storage. Per tenant, because a tenant with a custom endpoint adds exactly one host. | network policy | proposed, M6 |
| S-9 | Customer-configurable budgets per job, per day, and per month, with a hard stop mid-run. Where a model's price is unknown, the budget is a token ceiling rather than a guessed dollar figure. | the model proxy, atomic counters in Redis | proposed: job ceiling M2, workspace budgets M3. See `ADR-008` |
| S-10 | Rate limits per user and per channel. | bot | proposed, M6 |
| S-11 | Webhook signatures verified for GitHub, Stripe, and Discord. Unsigned rejected. | `apps/api` | proposed, M4 |
| S-12 | An inbound email request runs only from a verified, allowlisted sender. | email surface adapter | proposed, M7. See `ADR-005` |
| S-13 | A custom model endpoint is HTTPS only, resolves to a public address, and is pinned to that address for the request. | model proxy and onboarding validation | proposed, M5. See `ADR-006` |

## Credential handling

Sealing uses libsodium sealed boxes. A sealed box is hybrid encryption with a per-message ephemeral keypair, and the property that matters here is asymmetry: sealing needs only the public key.

That splits the keys by role.

| Key | Who holds it | Can |
|---|---|---|
| `HIFI_MASTER_PUBLIC_KEY` | API, dashboard, workers | seal a new credential |
| `HIFI_MASTER_SECRET_KEY` | workers only | unseal |

An attacker who reaches the control plane or the database still cannot read a customer credential. Blobs carry a key version in their header so a keyring can hold several master keys at once and rotation does not require re-sealing everything at once.

`Credential.ciphertext` is the only column in the schema permitted to hold key material.

## Why a custom endpoint needs its own control

Letting a customer supply a base URL means our proxy makes an HTTP request to an address the customer chose, from inside our infrastructure. Point it at a cloud metadata address, a loopback port, or a private-network hostname, and the customer is using HiFi to reach things only HiFi can reach. That is server-side request forgery.

The guard has three parts, and all three are needed. HTTPS only. The hostname is resolved and every resulting address checked against private, loopback, and link-local ranges. And the connection is made to the address that was checked, not re-resolved, because otherwise a hostname can answer the check with a public address and the real request with a private one.

A consequence customers will notice: a model server on a laptop or a private network cannot be used. That is correct, not a limitation to engineer around.

## Why email needs its own control

Discord and Slack both tell us who wrote a message, and the binding is to a channel inside a workspace the customer controls. Authorisation is therefore a property of the surface, and we inherit it.

Email inherits nothing. A sender address is a claim in a header, forgeable unless DKIM and SPF alignment are checked. An address is also guessable, and anyone who learns it is talking directly to a coding agent with write access to a private repository.

So the email surface needs authorisation of its own: DKIM and SPF alignment verified on arrival, and an explicit per-binding sender allowlist rather than "anyone who can reach this address". An unverified or unlisted sender is dropped, and dropped quietly, because a bounce tells an attacker which addresses are real.

This is the main reason email is scheduled last rather than alongside Slack.

## Two layers, never one

Where a control protects something irreversible, the design deliberately doubles up rather than trusting a single mechanism:

- Branch safety is checked in our code **and** customers are told to enable branch protection with required reviews.
- Prompt injection is addressed by the system preamble **and** by hard checks in the worker. The preamble alone is not a security control; a prompt cannot be relied on to constrain a model.
- Spend is capped by the proxy **and** bounded by the job wall clock and max-turns cap.

## Known gaps at M1

- No egress restriction of any kind.
- No rate limiting.
- No spend enforcement.
- The `.env` file on a development machine holds a master secret key in plaintext. Acceptable for local work; production keys must be Fly secrets and must never be the same keys.
