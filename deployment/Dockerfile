# syntax=docker/dockerfile:1

# ---- deps stage ----
FROM node:24-alpine AS deps
WORKDIR /app

COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn .yarn

RUN yarn install --immutable

# ---- builder stage ----
FROM node:24-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/.yarn ./.yarn
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

RUN yarn build

# ---- migrate stage ----
FROM node:24-alpine AS migrate
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY prisma ./prisma
COPY prisma.config.ts package.json ./

CMD ["node_modules/.bin/prisma", "migrate", "deploy"]

# ---- runner stage ----
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]

# ---- ws-runner stage ----
FROM node:24-alpine AS ws
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nodejs

# Include devDeps (tsx) needed to run TypeScript directly
COPY --from=deps /app/node_modules ./node_modules
# Source files the ws server imports
COPY --from=builder /app/src/server/ws ./src/server/ws
COPY --from=builder /app/src/server/lib/jwt.ts ./src/server/lib/jwt.ts
# tsx needs tsconfig.json for @/ path alias resolution
COPY package.json tsconfig.json ./

USER nodejs

EXPOSE 3001
ENV WS_PORT=3001

CMD ["node_modules/.bin/tsx", "src/server/ws/index.ts"]
