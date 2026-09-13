# @hifi/vercel

Preview deployment resolution. Implemented in M3.

## Owns
- Correlating a GitHub `deployment_status` webhook back to a job, by repository and head SHA, which is all the webhook gives us that we control.
- Coping with a monorepo that produces several previews for one commit, rather than assuming exactly one.

## Must never
- Poll Vercel. The webhook is the signal.
- Block a job. The job ends when the pull request is open; the preview URL is edited into the Discord message later, or never.
- Require a Vercel credential for the default path. A token is optional and only buys build logs on failure.
