-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('free', 'starter', 'pro', 'enterprise');

-- CreateEnum
CREATE TYPE "ModelPreference" AS ENUM ('cheapest', 'balanced', 'best');

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('owner', 'member');

-- CreateEnum
CREATE TYPE "CredentialKind" AS ENUM ('github_app_installation', 'model_provider', 'vercel');

-- CreateEnum
CREATE TYPE "CredentialStatus" AS ENUM ('active', 'invalid', 'revoked');

-- CreateEnum
CREATE TYPE "PackageManager" AS ENUM ('npm', 'pnpm', 'yarn', 'bun', 'unknown');

-- CreateEnum
CREATE TYPE "PreflightStatus" AS ENUM ('unknown', 'ok', 'failed');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('queued', 'claimed', 'preparing', 'planning', 'editing', 'testing', 'capturing', 'pushing', 'waiting_input', 'reporting', 'succeeded', 'failed', 'cancelled', 'timed_out');

-- CreateEnum
CREATE TYPE "PreviewStatus" AS ENUM ('not_configured', 'pending', 'ready', 'failed', 'timed_out');

-- CreateEnum
CREATE TYPE "FailureCode" AS ENUM ('quota_exceeded', 'spend_cap_exceeded', 'concurrency_exceeded', 'no_channel_binding', 'tenant_suspended', 'credential_missing', 'credential_invalid', 'repo_preflight_failed', 'checkout_failed', 'install_failed', 'agent_error', 'agent_timeout', 'tests_failed', 'screenshot_failed', 'protected_branch', 'push_failed', 'github_error', 'clarification_timeout', 'cancelled_by_user', 'wall_clock_timeout', 'internal_error');

-- CreateEnum
CREATE TYPE "CostTier" AS ENUM ('cheap', 'mid', 'frontier');

-- CreateEnum
CREATE TYPE "JobEventType" AS ENUM ('status_change', 'agent_message', 'tool_call', 'command', 'notice', 'warning', 'error');

-- CreateEnum
CREATE TYPE "WebhookSource" AS ENUM ('github', 'stripe', 'discord');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "discordGuildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "iconUrl" TEXT,
    "plan" "Plan" NOT NULL DEFAULT 'free',
    "modelPreference" "ModelPreference" NOT NULL DEFAULT 'balanced',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "jobQuotaMonthly" INTEGER NOT NULL DEFAULT 25,
    "jobsUsedThisPeriod" INTEGER NOT NULL DEFAULT 0,
    "maxConcurrentJobs" INTEGER NOT NULL DEFAULT 1,
    "periodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "periodEnd" TIMESTAMP(3),
    "spendCapMicroUsd" BIGINT NOT NULL DEFAULT 2000000,
    "spendThisPeriodMicroUsd" BIGINT NOT NULL DEFAULT 0,
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "suspendedReason" TEXT,
    "suspendedAt" TIMESTAMP(3),
    "flyMachineId" TEXT,
    "flyVolumeId" TEXT,
    "flyRegion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "globalName" TEXT,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Credential" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "CredentialKind" NOT NULL,
    "status" "CredentialStatus" NOT NULL DEFAULT 'active',
    "externalId" TEXT NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "lastValidatedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Repo" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "githubRepoId" BIGINT NOT NULL,
    "fullName" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "isPrivate" BOOLEAN NOT NULL DEFAULT true,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "credentialId" TEXT,
    "mirrorPath" TEXT,
    "lastFetchedAt" TIMESTAMP(3),
    "packageManager" "PackageManager" NOT NULL DEFAULT 'unknown',
    "installCommand" TEXT,
    "testCommand" TEXT,
    "devCommand" TEXT,
    "buildCommand" TEXT,
    "framework" TEXT,
    "lockfileHash" TEXT,
    "detectionAt" TIMESTAMP(3),
    "preflightStatus" "PreflightStatus" NOT NULL DEFAULT 'unknown',
    "preflightMessage" TEXT,
    "preflightAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Repo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelBinding" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "discordChannelId" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "defaultSubPath" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "repoId" TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "cancelledByUserId" TEXT,
    "discordChannelId" TEXT NOT NULL,
    "discordMessageId" TEXT NOT NULL,
    "discordThreadId" TEXT,
    "discordStatusMessageId" TEXT,
    "prompt" TEXT NOT NULL,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "status" "JobStatus" NOT NULL DEFAULT 'queued',
    "statusDetail" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "signals" JSONB,
    "modelSelection" JSONB,
    "visionModel" TEXT,
    "clarifyingQuestion" TEXT,
    "waitingSince" TIMESTAMP(3),
    "branchName" TEXT,
    "headSha" TEXT,
    "prNumber" INTEGER,
    "prUrl" TEXT,
    "prMergedAt" TIMESTAMP(3),
    "prClosedAt" TIMESTAMP(3),
    "previewStatus" "PreviewStatus" NOT NULL DEFAULT 'not_configured',
    "previewUrl" TEXT,
    "previewAt" TIMESTAMP(3),
    "testSummary" JSONB,
    "screenshotKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "diffStat" JSONB,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "tokensCacheRead" INTEGER NOT NULL DEFAULT 0,
    "costMicroUsd" INTEGER NOT NULL DEFAULT 0,
    "bullJobId" TEXT,
    "flyMachineId" TEXT,
    "deadlineAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "failureCode" "FailureCode",
    "failureMessage" TEXT,
    "meteredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobEvent" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" "JobEventType" NOT NULL,
    "fromStatus" "JobStatus",
    "toStatus" "JobStatus",
    "message" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelEntry" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "vision" BOOLEAN NOT NULL DEFAULT false,
    "toolUseQuality" INTEGER NOT NULL DEFAULT 3,
    "contextWindow" INTEGER NOT NULL,
    "maxOutput" INTEGER,
    "costTier" "CostTier" NOT NULL,
    "inputMicroUsdPerMTok" INTEGER NOT NULL,
    "outputMicroUsdPerMTok" INTEGER NOT NULL,
    "cacheReadMicroUsdPerMTok" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "source" "WebhookSource" NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "eventType" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_discordGuildId_key" ON "Tenant"("discordGuildId");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_stripeCustomerId_key" ON "Tenant"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_stripeSubscriptionId_key" ON "Tenant"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "Tenant_suspended_idx" ON "Tenant"("suspended");

-- CreateIndex
CREATE UNIQUE INDEX "User_discordUserId_key" ON "User"("discordUserId");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_tenantId_userId_key" ON "Membership"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "Credential_tenantId_kind_status_idx" ON "Credential"("tenantId", "kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Credential_tenantId_kind_externalId_key" ON "Credential"("tenantId", "kind", "externalId");

-- CreateIndex
CREATE INDEX "Repo_tenantId_fullName_idx" ON "Repo"("tenantId", "fullName");

-- CreateIndex
CREATE UNIQUE INDEX "Repo_tenantId_githubRepoId_key" ON "Repo"("tenantId", "githubRepoId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelBinding_discordChannelId_key" ON "ChannelBinding"("discordChannelId");

-- CreateIndex
CREATE INDEX "ChannelBinding_tenantId_idx" ON "ChannelBinding"("tenantId");

-- CreateIndex
CREATE INDEX "ChannelBinding_repoId_idx" ON "ChannelBinding"("repoId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_discordMessageId_key" ON "Job"("discordMessageId");

-- CreateIndex
CREATE INDEX "Job_tenantId_createdAt_idx" ON "Job"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "Job_tenantId_status_idx" ON "Job"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Job_status_deadlineAt_idx" ON "Job"("status", "deadlineAt");

-- CreateIndex
CREATE INDEX "Job_repoId_headSha_idx" ON "Job"("repoId", "headSha");

-- CreateIndex
CREATE INDEX "Job_discordThreadId_idx" ON "Job"("discordThreadId");

-- CreateIndex
CREATE INDEX "JobEvent_jobId_createdAt_idx" ON "JobEvent"("jobId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobEvent_jobId_seq_key" ON "JobEvent"("jobId", "seq");

-- CreateIndex
CREATE INDEX "ModelEntry_enabled_costTier_idx" ON "ModelEntry"("enabled", "costTier");

-- CreateIndex
CREATE UNIQUE INDEX "ModelEntry_provider_modelId_key" ON "ModelEntry"("provider", "modelId");

-- CreateIndex
CREATE INDEX "WebhookEvent_receivedAt_idx" ON "WebhookEvent"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_source_deliveryId_key" ON "WebhookEvent"("source", "deliveryId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Repo" ADD CONSTRAINT "Repo_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Repo" ADD CONSTRAINT "Repo_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "Credential"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelBinding" ADD CONSTRAINT "ChannelBinding_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelBinding" ADD CONSTRAINT "ChannelBinding_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelBinding" ADD CONSTRAINT "ChannelBinding_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobEvent" ADD CONSTRAINT "JobEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
