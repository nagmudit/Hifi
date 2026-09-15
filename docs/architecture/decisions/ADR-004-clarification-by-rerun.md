# ADR-004: A parked job resumes by re-running, not by resuming a session

**Status:** accepted - **Date:** 2026-09-13

## Context

When the agent decides a task is underspecified, the chosen behaviour is to ask one specific question in the Discord thread and wait for an answer, rather than guessing or failing.

A job waiting on a human can wait for an hour. Holding a concurrency slot and a live agent session for that long would let one ambiguous request block a tenant's entire plan allowance.

## Decision

`waiting_input` is a non-terminal state that holds no concurrency slot. It is excluded from `ACTIVE_STATUSES`. When an answer arrives, the job re-runs from `planning` with the original prompt, our question, and the user's answer concatenated.

## Rationale

Releasing the worker means dropping the agent session, so there is no session to resume. Re-running from planning is honest about that, and the concatenated prompt carries the full context that the dropped session held.

## Alternatives

**Hold the session open.** Preserves the agent's working state but pins a worker and a slot for up to an hour.

**Serialise and restore the agent session.** Would allow both, but depends on session-resume support in the engine, which is not guaranteed across engines and would leak into the `AgentEngine` interface.

**Fail with the question as the message.** Simplest of all, and it consumes no quota on a wasted run, but it makes the user restart the request by hand.

## Consequences

One wasted planning pass per clarification, paid for with the customer's own key. Acceptable against an hour of held capacity.

The clarification timeout is a real deadline that must be enforced, or parked jobs accumulate forever. `CLARIFICATION_TIMEOUT_MS` is one hour, and `FailureCode.clarification_timeout` exists for the expiry path.

## Related

`packages/core/src/job-state.ts`, `Job.clarifyingQuestion` and `Job.waitingSince`, `docs/architecture/data-flow.md`.
