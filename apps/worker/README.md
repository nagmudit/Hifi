# @hifi/worker

Runs on Fly Machines, one machine and one volume per tenant. Consumes jobs and executes agent runs.

## Owns
- The job pipeline and every state transition.
- The per-job model proxy that holds the unsealed customer key, meters tokens, and enforces the spend cap mid-run.
- Workspace lifecycle: a bare mirror that persists, a worktree that never does. Teardown happens in a `finally`.

## Must never
- Share a machine or a volume between tenants.
- Put a customer credential into an environment repo-owned processes inherit. Install scripts, test runs, and the dev server all execute untrusted code.
- Report success when the test suite is red.
- Push to a protected branch, or open a pull request against a repository other than the bound one.
- Leave a worktree behind.
