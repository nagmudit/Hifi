# syntax=docker/dockerfile:1
# Control-plane image. Builds the whole workspace once and runs one app,
# selected at build time with --build-arg APP=api|bot.
#   docker build -f deploy/Dockerfile --build-arg APP=api -t hifi-api .

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
# openssl is required by Prisma engines on slim images.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/bot/package.json apps/bot/
COPY apps/worker/package.json apps/worker/
COPY apps/dashboard/package.json apps/dashboard/
COPY packages/agent/package.json packages/agent/
COPY packages/core/package.json packages/core/
COPY packages/crypto/package.json packages/crypto/
COPY packages/db/package.json packages/db/
COPY packages/github/package.json packages/github/
COPY packages/router/package.json packages/router/
COPY packages/vercel/package.json packages/vercel/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
COPY apps/bot apps/bot
COPY apps/worker apps/worker
RUN pnpm --filter @hifi/db generate \
 && pnpm -r --filter "./packages/**" build \
 && pnpm --filter @hifi/api --filter @hifi/bot --filter @hifi/worker build

FROM base AS runtime
ARG APP=api
ENV APP=${APP} NODE_ENV=production
COPY --from=build /app /app
USER node
CMD ["sh", "-c", "node apps/${APP}/dist/index.js"]
