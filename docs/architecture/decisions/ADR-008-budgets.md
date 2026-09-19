# ADR-008: Customer-configurable budgets, enforced by the proxy

**Status:** accepted - **Date:** 2026-09-20

The product direction is decided by the product owner: customers set their own spending limits in HiFi, so an agent using their key cannot keep consuming tokens. The enforcement design below constrains the M2 proxy, which is why it is recorded now rather than when the dashboard is built.

## Context

Customers bring their own model key (`ADR-006`), so every token an agent spends is the customer's money, not ours. An agent that loops, re-reads a large repository every turn, or keeps retrying a failing test can spend far more than the change is worth, and nothing about the customer's provider account stops it quickly enough.

Some of this already exists in design. `Tenant.spendCapMicroUsd` and `spendThisPeriodMicroUsd` are in the schema, `FailureCode.spend_cap_exceeded` exists, the job has a wall-clock limit and a turn cap, and control S-9 names the proxy as the enforcement point. None of it is configurable by the customer, none of it is enforced, and a monthly cap alone does not stop one runaway job from spending the whole month in an afternoon.

## Decision

**Budgets exist at three levels, and the tightest one wins.**

| Level | Stops | Default | Configurable from |
|---|---|---|---|
| Per job | one runaway agent run | a conservative ceiling | M2 by environment, M5 in the dashboard |
| Per period, per tenant | the whole workspace, daily and monthly | set at sign-up | M5 |
| Per user or per channel | one person or one busy channel exhausting the shared budget | off | M6 |

**Every budget can be expressed in dollars or in tokens.** Dollars are what customers think in, but a dollar budget needs a known price, and `ADR-006` says prices are never invented. Where a model's price is unknown, the budget is enforced in tokens and the dashboard says so.

**The proxy enforces budgets mid-run, not at job start.** Checking only before a job starts cannot stop the job that is currently overspending. The proxy sees every request and every response, so it is the one place that can stop an agent between one model call and the next.

**Spend is counted atomically, shared across concurrent jobs.** Two jobs that each check "is there budget left?" and then spend will jointly overshoot. The running totals live in Redis and are updated with atomic increments, per tenant, per period, and per job.

**Overshoot is bounded, not zero, and the bound is stated.** A request's cost is only known once its response arrives, so a budget can be exceeded by at most the requests already in flight. Before forwarding, the proxy caps each request's maximum output tokens to what the remaining budget can pay for. That keeps the worst-case overshoot to roughly one request's input per running job.

**What happens at each threshold.**

| Threshold | Behaviour |
|---|---|
| 50% and 80% of a period budget | notify: in the surface the job came from, and by email once email exists |
| 100% of a job budget | the proxy refuses further calls; the job fails and reports how far it got and what it spent |
| 100% of a period budget | the running job stops as above, and new jobs are refused at request time with a message pointing at the budget settings |

**A new job is refused up front** when the remaining period budget cannot cover a minimal run, rather than started and then killed a few seconds in.

**The customer's own provider limit stays in place as the second layer.** HiFi's budget is the primary control and the provider account limit is the backstop, in the same two-layer pattern as branch protection.

## Rationale

The proxy was introduced in `ADR-002` for key isolation and honest metering. Budget enforcement is the payoff of that decision, and it can live nowhere else: the agent cannot be trusted to stop itself, and the worker only sees the job from the outside.

Three levels because each failure has a different shape. A runaway job is fast and local, a busy team is slow and aggregate, and one heavy user is a fairness problem rather than a cost problem.

## Alternatives

**Monthly tenant cap only, as the brief specified.** One bad job can still consume a month of budget before anything intervenes.

**Rely on the provider account's limits.** Coarse, slow to take effect, sometimes only an alert rather than a stop, and shared across everything else the customer uses that key for.

**Check budgets only at job start.** Simple, and useless against the case that actually costs money.

## Consequences

**M2 builds the per-job token ceiling into the proxy from the start,** read from `M2_JOB_TOKEN_CEILING`. It is nearly free once the proxy is counting tokens, and it protects the development OpenAI key immediately.

**The proxy clamps output tokens on every request.** That changes requests in flight, so it must be tested against both wire protocols, and a model that refuses a clamped request must fail cleanly rather than loop.

**Schema additions land with the milestones that use them:** a per-job budget and a daily cap on `Tenant`, and a `Budget` model for per-user and per-channel limits. `Tenant.spendCapMicroUsd` currently defaults to two dollars, which is a placeholder, not a considered default.

**A job stopped by a budget reports honestly** what it changed, what it spent, and that it did not finish. It never opens a pull request for a half-finished change.

**`FailureCode.spend_cap_exceeded` covers the period cap.** A separate code for the per-job budget will probably be clearer in reports, and should be added when the per-job budget is implemented rather than now.

## Related

`ADR-002` for the proxy, `ADR-006` for pricing and token fallbacks, `docs/architecture/security-model.md` control S-9, requirements R-46 and R-80 onward.
