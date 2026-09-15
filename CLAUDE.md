@AGENTS.md

# Claude Code

Follow `AGENTS.md`. Additionally:

- Use plan mode for anything touching the job state machine, the credential path, or more than one package.
- Prefer Grep and Glob over shell `find` and `grep`.
- Heredocs through the Bash tool are unreliable in this environment: content with apostrophes or backticks breaks the shell wrapper. Write files with the Write tool, or write a script file and run that.
- Update the active execution plan in `docs/plans/active/` before reporting completion.
