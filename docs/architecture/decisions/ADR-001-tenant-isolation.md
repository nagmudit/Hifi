# ADR-001: Tenant isolation is the machine boundary

**Status:** accepted - **Date:** 2026-09-13

## Context

A job clones a customer repository, installs its dependencies, runs its test suite, and starts its development server. All of that executes code we have never seen, next to a customer credential. Container-level isolation between jobs of different customers would put that untrusted execution one kernel escape away from another tenant's source code and keys.

## Decision

One Fly Machine and one attached volume per tenant. Mirrors, package caches, credentials, and job worktrees never share a machine across tenants. Within a tenant, jobs may share a machine.

## Rationale

Sharing within a tenant is acceptable because the code, the repositories, and the credentials all belong to the same customer. Sharing across tenants is not, because nothing in the job pipeline is a strong enough sandbox to make it safe.

## Alternatives

**Pooled workers with per-job containers.** Cheaper and far simpler to operate, but it makes container escape a cross-customer event rather than a single-customer one.

**Per-job machines.** Better isolation still, at the cost of losing the warm mirror and package cache that make a job take minutes instead of tens of minutes.

## Consequences

Accepted cost: a per-tenant machine and volume are allocated for every customer, including idle ones, and the fleet becomes an orchestration problem at a few hundred tenants. Fly volumes are pinned to one region and one machine, so a tenant's region is effectively fixed at creation.

The volume must be treated strictly as a disposable cache, with disk watermarks and garbage collection, because mirrors, worktrees, and package stores grow without bound. Losing a volume must cost one slow job and nothing more.

Revisit when idle-tenant cost or fleet management becomes the dominant operational burden. The likely evolution is a cold-tenant reaper that destroys the machine and volume after a period of inactivity and rebuilds on demand.

## Related

`apps/worker/fly.toml`, `deploy/Dockerfile.worker`, `docs/architecture/security-model.md` control S-1.
