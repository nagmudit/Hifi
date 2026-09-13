# @hifi/github

GitHub App authentication, bare mirrors, worktrees, branches, and pull requests. Implemented in M2.

## Owns
- Minting installation tokens per job. They last an hour and are never cached across jobs.
- The bare mirror per repo on the tenant volume, and the disposable worktree per job.
- Branch safety: the check that refuses to push to the default branch or any protected branch.

## Must never
- Create or accept a personal access token.
- Push to the default branch, whatever the agent asked for. This is enforced in code; branch protection on the customer side is the second, independent layer.
- Open a pull request against any repository other than the one bound to the channel.
- Modify workflow files, repository settings, or branch protection.
