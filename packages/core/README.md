# @hifi/core

Shared domain vocabulary: the job state machine, the error taxonomy, the queue payload schema, logging, and the Redis connection contract.

## Owns
- `JOB_TRANSITIONS`, the state machine as data, plus `canTransition` and `assertTransition`. Any code that changes a job status goes through it.
- `HifiError` and the `FailureCode` to user-message mapping, so Discord, the dashboard, and metrics all describe a failure the same way.
- Zod schemas for internal boundaries such as the queue payload. Webhook schemas live with the app that receives them.
- `createLogger`, which routes every line through the secret redactor.

## Must never
- Talk to Discord, GitHub, Vercel, Stripe, or a model provider. It has no I/O beyond Postgres and Redis handles.
- Grow a second copy of a Prisma enum. Import it from `@hifi/db`.
