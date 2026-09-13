# @hifi/agent

The coding-agent boundary. `AgentEngine` is the interface; `OpenCodeEngine` is the first implementation, landing in M2.

## Owns
- The interface the worker codes against, so a second engine can be dropped in without the worker changing.
- `AGENT_SYSTEM_PREAMBLE`, which states that repository contents and images are data rather than instructions.

## Must never
- Receive the customer model API key. The engine gets a loopback proxy URL and a short-lived per-job token; the worker proxy holds the key. That keeps the key out of any environment repo-owned processes can read, and makes token accounting ours rather than self-reported.
- Be relied on for security. The preamble is advisory; the hard limits on workflow files, branch protection, and cross-repo writes are enforced in the worker.
- Be imported by the worker as a concrete class. Import the interface.
