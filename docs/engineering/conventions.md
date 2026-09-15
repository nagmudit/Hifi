---
status: current
last_verified: 2026-09-15
applies_to: [apps, packages]
---

# Conventions

Only the rules a competent engineer would otherwise get wrong in this repository. Observed from the code, not imported from a style guide.

## Modules

- ESM everywhere. Every `package.json` sets `"type": "module"`.
- TypeScript uses `NodeNext` resolution with `verbatimModuleSyntax`. Relative imports in source carry a `.js` extension even though the file on disk is `.ts`: `import { seal } from "./seal.js"`.
- Cross-package imports use the package name, never a relative path into another package's `src`.
- Workspace packages build to `dist/` with `tsc` and are consumed through their `exports` map. Build order is topological through `pnpm -r`.

## Types

- `strict` plus `noUncheckedIndexedAccess`. Indexing an array gives `T | undefined`, so a loop over `path[i]` needs a cast or a guard. This is why some test code reads slightly awkwardly.
- No `any` that survives review.
- Zod at every trust boundary: queue payloads, webhooks, Discord input, agent output. Types are inferred from the schema with `z.infer`, never declared twice.

## Domain rules

- **Never redeclare a Prisma enum.** `JobStatus`, `FailureCode`, `CredentialKind` and the rest are imported from `@hifi/db`. A second copy will drift.
- **Every job status change goes through `assertTransition`.** The state machine lives in `packages/core/src/job-state.ts` as a frozen table. Adding an `if` that sets a status directly defeats the only place the rules are written down.
- **Money is integer micro-USD.** 1,000,000 micro-USD is one dollar. Per-job values are `Int`; tenant period aggregates are `BigInt` because they exceed the `Int` range. Never a float, never a bare "cents" number.
- **Discord snowflakes are strings.** They do not fit in a JavaScript number. The `snowflake` schema in `packages/core/src/schemas.ts` enforces the shape.
- **Failures are `HifiError` with a `FailureCode`.** The code maps to a user-facing message in one table, so Discord, the dashboard, and metrics cannot describe the same failure differently.

## Logging

- `createLogger` from `@hifi/core`, never `console`.
- Child loggers carry the job ID so every line inside a job is attributable.
- Every log line passes through the secret redactor. That is a backstop, not a licence to log credentials.

## External calls

Every call to something outside the process gets a timeout and a bounded retry with jitter. No unbounded retries anywhere.

## Comments

Comments explain why, not what. The codebase uses them for decisions that would otherwise look arbitrary: why the queue name has no colon, why libsodium is loaded through `createRequire`, why a parked job releases its slot. Preserve that style; a comment restating the next line is noise.

## Commits

Conventional commits, small and reviewable.
