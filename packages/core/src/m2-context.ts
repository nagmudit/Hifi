import { db, type Repo, type Tenant, type User } from "@hifi/db";

/**
 * M2 shim. Deleted at M4.
 *
 * Until multi-tenancy exists there is no sign-up, no install flow, and no
 * channel binding UI, so the single tenant, repository, and binding are
 * conjured from environment variables. The rows are real, so the pipeline
 * exercises the real schema rather than a special case; only their origin is
 * temporary.
 *
 * It lives in core because both the bot and the worker need it and core is the
 * one package allowed to touch Postgres without owning policy.
 */

export interface M2ContextInput {
  discordGuildId: string;
  discordChannelId: string;
  repoFullName: string;
  /** Filled in by the worker once GitHub has been asked. */
  githubRepoId?: bigint;
  defaultBranch?: string;
}

export interface M2Context {
  tenant: Tenant;
  repo: Repo;
}

export async function ensureM2Context(input: M2ContextInput): Promise<M2Context> {
  const prisma = db();

  const tenant = await prisma.tenant.upsert({
    where: { discordGuildId: input.discordGuildId },
    update: {},
    create: {
      discordGuildId: input.discordGuildId,
      name: "M2 development tenant",
      maxConcurrentJobs: 1,
      jobQuotaMonthly: 1000,
    },
  });

  const existing = await prisma.repo.findFirst({
    where: { tenantId: tenant.id, fullName: input.repoFullName },
  });

  const repo = existing
    ? await prisma.repo.update({
        where: { id: existing.id },
        data: {
          ...(input.githubRepoId ? { githubRepoId: input.githubRepoId } : {}),
          ...(input.defaultBranch ? { defaultBranch: input.defaultBranch } : {}),
        },
      })
    : await prisma.repo.create({
        data: {
          tenantId: tenant.id,
          fullName: input.repoFullName,
          githubRepoId: input.githubRepoId ?? BigInt(0),
          defaultBranch: input.defaultBranch ?? "main",
        },
      });

  await prisma.channelBinding.upsert({
    where: { discordChannelId: input.discordChannelId },
    update: { repoId: repo.id },
    create: {
      tenantId: tenant.id,
      discordChannelId: input.discordChannelId,
      repoId: repo.id,
    },
  });

  return { tenant, repo };
}

export async function upsertDiscordUser(input: {
  discordUserId: string;
  username: string;
  tenantId: string;
}): Promise<User> {
  const prisma = db();
  const user = await prisma.user.upsert({
    where: { discordUserId: input.discordUserId },
    update: { username: input.username },
    create: { discordUserId: input.discordUserId, username: input.username },
  });

  await prisma.membership.upsert({
    where: { tenantId_userId: { tenantId: input.tenantId, userId: user.id } },
    update: {},
    create: { tenantId: input.tenantId, userId: user.id, role: "member" },
  });

  return user;
}
