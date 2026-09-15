---
status: current
last_verified: 2026-09-15
applies_to: [.]
---

# Vision

## What HiFi is

A coding agent that lives where the conversation already happens. A team member describes a change in a Discord channel, attaches a screenshot if it helps, and a pull request arrives with tests run, the visual diff captured, and a preview link attached.

The product is not the agent. Plenty of things run a coding agent. The product is the loop around it: the request arriving where people already talk, the safety rails that make an unattended agent acceptable against a real repository, and the reporting that makes the result reviewable without leaving Discord.

## Who it is for

Small product teams who already run their work in Discord and already deploy previews from pull requests. The person making the request is often not the person who would otherwise write the change: a designer, a founder, a support lead who knows exactly what is wrong with a page.

## The one journey that matters

Everything in the repository exists to serve this sequence.

1. Someone tags the bot in a bound channel: "the pricing page header is cut off on mobile", with a screenshot.
2. The bot replies in a new thread within about three seconds, before any real work starts.
3. The task runs against a fresh working tree of the bound repository.
4. Tests covering the change are written and the repository suite is run.
5. If the change is visual, before and after screenshots are captured.
6. A branch is pushed and a pull request opened. Never a push to a protected branch.
7. The thread message is edited into a final report: pull request, preview, test results, screenshots, what changed, what it cost.

Step 7 edits the message posted at step 2. The thread carries one status message that changes, not a stream of updates.

## Business shape

Subscription with metered job usage. Customers bring their own model API key, so the marginal cost of a job is compute rather than inference. Plans differ by monthly job quota and maximum concurrent jobs.

That pricing model is why `docs/architecture/security-model.md` treats spend control as a correctness requirement rather than a nicety: a runaway agent loop spends the customer's money, not ours, which is a worse failure.

## What this is not

- Not a code review bot. It writes changes; humans still review the pull request.
- Not an autonomous merge pipeline. Branch protection with required reviews stays on, and HiFi never has permission to bypass it.
- Not a chat assistant. It answers with pull requests, and asks a clarifying question only when it genuinely cannot proceed.
