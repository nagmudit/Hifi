# ADR-006: Any model provider, through two wire protocols

**Status:** accepted - **Date:** 2026-09-20

## Context

The original brief named three ways to attach a model: an Anthropic Console key, an OpenRouter key, or Bedrock and Vertex credentials. The product direction is now wider. Customers should bring any provider they like, the way Cursor accepts an OpenAI, Anthropic, or Google key, or any endpoint that speaks the OpenAI API.

The code is already neutral about this. `ModelSelection.provider` and `ModelEntry.provider` are free strings, and `CredentialKind.model_provider` is generic. The only Anthropic-specific code is in `packages/crypto`: the redactor prefix list, and the refusal of Claude subscription tokens, which must stay. The lean towards Anthropic was in the documentation and the `.env.example` default, not the design.

What genuinely differs between providers is narrow: the wire protocol, the auth header, where usage appears in a response, the price, the key format, and how to validate a key.

## Decision

**Two wire protocols cover almost the whole market.** The Anthropic Messages API, and the OpenAI API shape. OpenAI itself speaks the second, and so do OpenRouter, Groq, Together, DeepSeek, Mistral, Fireworks, xAI, and Google's OpenAI-compatible endpoint. Supporting both protocols well is worth more than supporting twenty providers individually.

**The model proxy from ADR-002 is a transparent pass-through per protocol, not a translator.** The agent engine speaks each provider natively. It sends provider-native requests to the loopback proxy, which injects the real auth header, forwards to the real host with the path unchanged, and reads token usage from the response: the `usage` object in a JSON body, or the final event of a stream. No request is ever converted from one protocol to another.

**Providers arrive in three tiers.**

| Tier | Providers | Needs | When |
|---|---|---|---|
| First-class | OpenAI, then Anthropic and OpenRouter | known host, key format, validation, pricing | OpenAI in M2, the other two in M3 |
| Custom endpoint | any OpenAI-compatible host: base URL plus key plus model ID | SSRF guard, unknown pricing | M5, with the onboarding UI |
| Signed | AWS Bedrock, Google Vertex, Azure OpenAI | request signing or deployment URLs, not a header swap | after M6 |

**Validation costs nothing.** Both protocols expose a model listing endpoint, so a key is validated by listing models rather than by spending tokens. The listing also tells us which model IDs that key can actually reach.

**Pricing is never invented.** Known models carry prices in `ModelEntry`. OpenRouter reports cost per request. For a custom endpoint the price is unknown, so the job shows cost as unknown and the spend cap is enforced in tokens against a ceiling the tenant sets.

**Storage needs no schema change.** One `model_provider` credential per provider per tenant, `externalId` is the provider ID, and a custom base URL is non-secret metadata beside the sealed key.

**Claude subscriptions stay refused.** Supporting Claude means Claude models through an Anthropic Console key, or through OpenRouter, Bedrock, or Vertex. A Pro, Max, or Team subscription token is rejected by the Anthropic API for third-party integrations, and the `sk-ant-oat` refusal stays exactly as it is.

## Rationale

Pass-through keeps the proxy small and keeps provider features intact. Tool-calling formats, prompt caching, and reasoning parameters differ between protocols, and a translator either loses them or grows into a permanent project tracking every provider's API changes.

The tiers put effort where customers are. Most will arrive with an OpenAI, Anthropic, or OpenRouter key, and OpenRouter alone reaches most other models behind one key.

## Alternatives

**Translate everything to one protocol in the proxy.** One metering path, but translation is lossy and never finished.

**Adopt an existing gateway such as LiteLLM.** The same translation layer, maintained by someone else. Self-hosted inside the worker it is a plausible later swap for the proxy, and the interface should not rule that out. A hosted gateway is rejected outright, because it hands customer keys to a third party, which is the thing ADR-002 exists to prevent.

**Stay Anthropic-first as the brief implied.** Rejected by the product direction.

## Consequences

**Two usage parsers, streaming included,** each tested against recorded provider responses rather than live calls.

**Model quality varies enormously, and cheap models are weak at multi-step tool use.** A failed job may be the model rather than the pipeline. The router already carries `toolUseQuality` for this. Onboarding should warn when a tenant picks a model with no known tool-use rating, and the integration test with a stubbed engine is what separates pipeline bugs from model weakness.

**A custom base URL is a server-side request forgery vector.** A tenant who sets the base URL to an internal address makes our proxy fetch it from inside our infrastructure. Control S-13 covers the guard.

**The egress allowlist becomes per tenant.** It is the first-class provider hosts plus that tenant's validated custom host, rather than one static list.

**The redactor needs a prefix for each first-class provider as it lands,** taken from that provider's documentation. OpenAI and OpenRouter prefixes are already present.

**M2 targets OpenAI, not Anthropic,** because that is the development key available.

## Related

`ADR-002` for the proxy itself, `packages/agent/src/index.ts`, `packages/crypto/src/redact.ts`, the `ModelEntry` model, `docs/architecture/security-model.md` controls S-9 and S-13.
