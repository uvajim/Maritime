# ─────────────────────────────────────────────────────────────────────────────
# Cairo — Next.js frontend
# Multi-stage build · linux/amd64 & linux/arm64
#
# Stages:
#   deps    — install production + dev dependencies
#   builder — compile Next.js (standalone output)
#   runner  — minimal production image
#
# Build args:
#   NODE_VERSION  (default: 22)  — Node.js LTS version
#   BUILD_ENV     (default: production) — dev | beta | main | production
#
# Usage:
#   docker build -t maritime-cairo .
#   docker run -p 3000:3000 \
#     -e NEXT_PUBLIC_BACKEND_URL=https://api.example.com \
#     maritime-cairo
# ─────────────────────────────────────────────────────────────────────────────

ARG NODE_VERSION=22
ARG BUILD_ENV=production

# ── Stage 1: dependency installation ─────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS deps

# Enable corepack for reproducible installs.
RUN corepack enable

WORKDIR /app

# Copy lock files first — layer is cached until dependencies change.
COPY package.json package-lock.json ./

# Install all dependencies (dev needed for build).
RUN npm ci --prefer-offline

# ── Stage 2: build ────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS builder

ARG BUILD_ENV

WORKDIR /app

# Copy node_modules from deps stage.
COPY --from=deps /app/node_modules ./node_modules

# Copy source.
COPY . .

# Produce a standalone Next.js build (smallest possible output).
# NEXT_TELEMETRY_DISABLED prevents network calls during build.
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Dummy env values for build-time placeholders.
# Real values are injected at runtime via -e flags or a secrets manager.
ENV NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=build-placeholder
ENV NEXT_PUBLIC_CHAIN_ID=1
ENV NEXT_PUBLIC_BACKEND_URL=https://api.example.com

RUN npm run build

# ── Stage 3: production runner ────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS runner

ARG BUILD_ENV
LABEL org.opencontainers.image.title="maritime-cairo"
LABEL org.opencontainers.image.description="Maritime Cairo — Next.js frontend"
LABEL org.opencontainers.image.source="https://github.com/uvajim/Maritime"

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Create a non-root user.
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Copy the standalone build and static assets.
# next.config.ts must have `output: 'standalone'` for this to work.
# If not configured yet, fall back to copying the full .next directory.
COPY --from=builder --chown=nextjs:nodejs /app/public        ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static  ./.next/static

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/ || exit 1

# Next.js standalone server entry point.
CMD ["node", "server.js"]
