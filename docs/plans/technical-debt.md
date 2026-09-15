---
status: current
last_verified: 2026-09-15
---

# Technical Debt

Known compromises. Each has a trigger: the condition that makes paying it off urgent rather than optional.

## D-01 - `pnpm lint` fails

No package defines a `lint` script, so the root script exits 1 with `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`. There is no linter and no formatter in the repository at all.

**Trigger:** before a second contributor, or before CI exists, whichever comes first. A broken command in `package.json` teaches everyone to distrust the scripts.

## D-02 - No CI

No workflows anywhere. Every check in `docs/engineering/commands.md` is a thing a human remembers to run.

**Trigger:** M2, as soon as there is a pipeline whose regressions are not obvious by eye.

## D-03 - Module boundaries are convention only

Nothing enforces that apps do not import each other, that `db` does not import `core`, or that the worker uses `AgentEngine` rather than a concrete engine. `docs/architecture/repository-map.md` lists five such rules and none are checked.

**Trigger:** when the first one is violated, or at Tier 3 when a dependency-rule test becomes worthwhile.

## D-04 - libsodium loaded through `createRequire`

`libsodium-wrappers` 0.7.16 publishes an ESM entry importing a file it does not ship, so `packages/crypto/src/seal.ts` loads the CommonJS build explicitly. The workaround is commented in place.

**Trigger:** when upstream fixes the packaging. Harmless until then; it only looks wrong.

## D-05 - Prisma 6 while 8 exists

Pinned at 6.19.3. Version 8 was available at install time and was not taken, deliberately, to avoid a migration during M1.

**Trigger:** before the schema grows much further. Upgrading across a large migration history is worse than upgrading now.

## D-06 - Job design commitments with no enforcement

Several invariants are documented and unimplemented: job deadlines are never written, the heartbeat columns are unused, the wall-clock watchdog does not exist, and `MAX_TEST_REPAIR_ATTEMPTS` is a constant nothing reads.

**Trigger:** M2 for deadlines and the watchdog. A job that can hang forever is not shippable.

## D-07 - A master secret key sits in a local `.env`

Acceptable for development. Production keys must be Fly secrets, must differ from any development key, and the secret key must never reach the control plane.

**Trigger:** first deployment.

## D-08 - `pnpm clean` uses `rm -rf`

Unlikely to work in a Windows shell, and the primary development machine is Windows.

**Trigger:** the first time someone needs it. Low cost to fix with `rimraf` or a Node script.
