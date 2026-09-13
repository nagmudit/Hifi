# @hifi/db

Owns the Prisma schema, the migrations, and the shared `PrismaClient`.

## Owns
- The single source of truth for every persisted type and enum, including `JobStatus`, which the rest of the monorepo imports rather than redeclaring.
- Migrations. Every schema change ships as a migration; nothing uses `db push` outside a scratch database.
- Money as integer micro-USD. Per-job costs are `Int`, tenant period totals are `BigInt`.

## Must never
- Store plaintext secrets. `Credential.ciphertext` is the only column that holds customer key material, and it is sealed by `@hifi/crypto` before it arrives.
- Contain business logic. No query helpers that decide policy; those live in the app that owns the decision.
- Be queried directly from a dashboard client component.

## Commands
```
pnpm --filter @hifi/db migrate        # create and apply a migration locally
pnpm --filter @hifi/db migrate:deploy # apply pending migrations (CI, prod)
pnpm --filter @hifi/db studio
```
