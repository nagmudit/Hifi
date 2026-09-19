# ADR-002: The model key goes to a proxy, not to the agent

**Status:** accepted - **Date:** 2026-09-13

## Context

The original brief specified that the agent engine receive the customer API key and pass it to the agent subprocess through the environment. The same worker also runs the repository's install command, its test suite, and its development server.

Package installation executes arbitrary postinstall scripts from the customer's entire dependency tree. Those scripts inherit the environment. The model provider is necessarily on the egress allowlist. Any compromised transitive dependency could therefore read the key and send it somewhere allowed.

A second problem compounds it. If the agent talks to the provider directly, our token counts and cost figures are whatever the agent reports, which makes both the per-tenant spend cap and usage-based billing unenforceable.

## Decision

The worker runs a loopback proxy that holds the unsealed key. The agent receives a base URL and a short-lived per-job bearer token instead. Every model request passes through the proxy.

`AgentEngine.run` therefore takes `access: { baseUrl, token }` rather than `apiKey: SealedRef`, a deliberate deviation from the brief.

## Rationale

One component solves four problems: the key never enters an environment repo-owned processes can read, token accounting becomes an observation rather than a report, the spend cap gains an enforcement point that can kill a run mid-turn, and provider egress narrows to a single process.

## Alternatives

**Key in the environment, as specified.** Simpler and faster to build, but leaves the exposure above and makes the spend cap advisory.

**Separate the agent process from repo-owned processes by user or container.** Addresses the disclosure risk but not the metering or spend-cap problem, and adds sandboxing complexity inside an already isolated machine.

## Consequences

An extra moving part in the worker, and one more thing that can fail between the agent and the provider. Streaming responses must pass through unbuffered or the agent's behaviour changes.

In exchange, `Job.tokensIn`, `tokensOut`, and `costMicroUsd` become trustworthy enough to bill on, and control S-9 becomes real rather than aspirational.

## Related

`packages/agent/src/index.ts`, `packages/agent/README.md`, `docs/architecture/security-model.md` controls S-2 and S-9.

`ADR-006`, added later, extends this proxy to every provider. It stays a pass-through: one per wire protocol, never translating between them.
