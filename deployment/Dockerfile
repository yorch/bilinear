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

COPY --from=deps /app/node_modules ./node_modules
# Remove heavy dev-only packages not needed by the ws server.
# The ws server only requires: ioredis, ws, jose, tsx (+ their transitive deps).
# TODO: replace this allowlist-based pruning with a purpose-built package.json
#       (e.g. `npm pack` / yarn workspaces) so new server deps don't get silently
#       excluded and cause runtime crashes.
RUN rm -rf \
    node_modules/@biomejs \
    node_modules/@playwright \
    node_modules/playwright-core \
    node_modules/@next \
    node_modules/next \
    node_modules/@vitest \
    node_modules/vitest \
    node_modules/@types \
    node_modules/typescript \
    node_modules/prisma \
    node_modules/@prisma \
    node_modules/@tailwindcss \
    node_modules/tailwindcss \
    node_modules/react \
    node_modules/react-dom \
    node_modules/@apollo \
    node_modules/graphql \
    node_modules/graphql-scalars \
    node_modules/graphql-tag \
    node_modules/@radix-ui \
    node_modules/mobx \
    node_modules/mobx-react-lite \
    node_modules/dexie \
    node_modules/sonner \
    node_modules/nodemailer \
    node_modules/pino \
    node_modules/pino-pretty
# Source files the ws server imports.
# Copy the entire server/lib directory — the ws server imports logger, jwt, and
# potentially other helpers from there, so copying only jwt.ts would cause
# runtime "Cannot find module" errors if any transitive import is added.
COPY --from=builder /app/src/server/ws ./src/server/ws
COPY --from=builder /app/src/server/lib ./src/server/lib
# tsx needs tsconfig.json for @/ path alias resolution
COPY package.json tsconfig.json ./

USER nodejs

EXPOSE 3001
ENV WS_PORT=3001

CMD ["node_modules/.bin/tsx", "src/server/ws/index.ts"]
