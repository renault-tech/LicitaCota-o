FROM node:22-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/

RUN pnpm install --frozen-lockfile

COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

RUN pnpm -F @licitapreco/shared build 2>/dev/null || true
RUN pnpm -F api exec prisma generate --schema=src/prisma/schema.prisma
RUN pnpm -F api build

# ─── runner ────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/

RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/apps/api/src/prisma/schema.prisma ./apps/api/src/prisma/schema.prisma
COPY --from=builder /app/apps/api/src/prisma/migrations ./apps/api/src/prisma/migrations

ENV NODE_ENV=production
EXPOSE 3001

CMD ["sh", "-c", "apps/api/node_modules/.bin/prisma db push --schema=apps/api/src/prisma/schema.prisma --skip-generate --accept-data-loss && node apps/api/dist/prisma/seed.js && node apps/api/dist/server.js"]
