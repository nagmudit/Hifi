# @hifi/api

Fastify control plane: webhooks, the dashboard backend, Stripe, and onboarding callbacks.

## Owns
- `/healthz` for liveness and `/readyz` for dependency readiness.
- From M4: GitHub, Stripe, and Discord webhook endpoints, each verifying its signature against the raw request body.

## Must never
- Hold the master secret key. The API seals credentials with the public key and cannot read them back.
- Do agent work. It enqueues; workers execute.
- Accept an unsigned webhook.
