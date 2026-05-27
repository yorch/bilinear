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

COPY --from=builder /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3   CMD ["node", "-e", "require('http').get('http://127.0.0.1:3000/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]
CMD ["node", "server.js"]
