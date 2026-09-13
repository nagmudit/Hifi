# @hifi/dashboard

Next.js App Router, deployed to Vercel. Onboarding, channel bindings, usage, and billing. Built in M5.

## Owns
- The five-step onboarding wizard, each step resumable and independently revocable.
- The job timeline view, rendered from `JobEvent`.

## Must never
- Hold the master secret key, or any unsealed credential.
- Query Postgres from the browser. It goes through the API.
