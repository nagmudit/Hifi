---
status: current
last_verified: 2026-09-15
applies_to: [packages/core, packages/crypto]
---

# Testing

## Current state

29 tests in 2 files, all passing. Vitest, run from the repository root.

| Area | File | Tests |
|---|---|---|
| Job state machine | `packages/core/src/job-state.test.ts` | 9 |
| Sealing, redaction, key validation | `packages/crypto/src/seal.test.ts` | 20 |

Everything else in the repository is untested, which is accurate rather than acceptable: at M1 most of it is interface definitions with no behaviour to test.

## How it is wired

- One Vitest config at the root. Test files are discovered as `{apps,packages}/*/src/**/*.test.ts`.
- Test files are excluded from every package `tsconfig.json`, so `tsc` builds do not emit them.
- No setup file, no test database, no mocking framework. Nothing currently under test needs any of them.

## Rules

- **Never call a real model API from a test.** Not with a key from `.env`, not "just once to check". The agent engine is an interface precisely so it can be stubbed.
- **Test the decision, not the plumbing.** The state machine tests assert which transitions are legal, including the ones that must be refused. That is the part that will be wrong at 3am, not whether Prisma can insert a row.
- **A security control gets a test that proves the failure path.** The sealing tests cover tamper detection, the wrong key, a missing key version, and a bad header, because "it round-trips" proves almost nothing on its own.
- Deterministic only. No wall-clock sleeps, no network, no ordering dependence between files.

## What the brief requires, and where it stands

| Requirement | Status |
|---|---|
| Unit tests for the router | not started; the router is an interface |
| Unit tests for credential sealing | done, 20 tests |
| Unit tests for branch-safety checks | not started; `packages/github` is an interface |
| Integration test for the full job state machine, fixture repo plus stubbed agent | not started; the target for M2 |
| No tests that call real model APIs | held |

## The M2 integration test

The most valuable test this repository does not yet have. It should drive a job from `queued` to `succeeded` against a fixture repository with a stubbed `AgentEngine`, asserting the transition sequence, that a worktree is destroyed, and that a re-delivered job does not open a second pull request.

Write it alongside the pipeline, not after. A pipeline built without it will be retrofitted badly.
