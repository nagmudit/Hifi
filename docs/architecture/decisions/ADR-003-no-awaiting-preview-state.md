# ADR-003: No `awaiting_preview` state; a detached watcher instead

**Status:** accepted - **Date:** 2026-09-13

## Context

The brief specified an `awaiting_preview` state in which the job waits up to ten minutes for a Vercel preview deployment before reporting.

Three problems. The wait is on someone else's build, so it holds a worker and one of the tenant's concurrency slots for up to ten minutes of paid idle time. Vercel's integration does not always produce a GitHub Deployment, and a monorepo produces several preview URLs for one commit, so the state can be entered and never satisfied for reasons that are not failures. And the brief already required that a late webhook still update the Discord message, which means the detached update path has to exist regardless.

## Decision

The job reaches `reporting` and terminates as soon as the pull request is open. Preview arrival is handled by a separate watcher keyed on repository and head SHA, which edits the Discord message later if a deployment shows up and quietly gives up after the window.

`JobStatus` has no `awaiting_preview` value.

## Rationale

Removing the state removes a way to hold resources on an event we do not control, and it deletes a code path rather than adding one, because the late-webhook handler was already required.

## Alternatives

**Block as specified.** Produces one coherent final message, at the cost of a held worker and a held concurrency slot.

**Short inline wait, then detach.** Covers most small previews within about ninety seconds and still frees the worker. Rejected for v1 as a hybrid that needs both code paths anyway.

## Consequences

The Discord message is edited twice in the common case: once when the pull request opens, once when the preview arrives. The reporting code must therefore be re-entrant and safe to run against an already-final message.

The head SHA must be persisted before the push completes, or a fast webhook arrives with nothing to correlate against.

## Related

`packages/core/src/job-state.ts`, the `(repoId, headSha)` index on `Job`, `packages/vercel/README.md`.
