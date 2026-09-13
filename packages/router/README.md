# @hifi/router

Model selection. Rules only in v1, nothing learned. Implemented in M3.

## Owns
- `selectModel` and `selectVisionModel`, driven by task signals and the tenant preference.
- The rule that vision capability is read from the `ModelEntry` table and never inferred from a model name.

## Must never
- Hard-code a model string anywhere outside the registry.
- Silently fall back to a more expensive tier. An escalation is a decision, and it gets logged with its reason.

Training data for a learned router is collected from M2 onward: signals, selection, tokens, cost, test outcome, and whether the pull request was later merged or closed.
