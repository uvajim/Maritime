# ─────────────────────────────────────────────────────────────────────────────
# Cairo-backend — Express TypeScript API
# Multi-stage build · linux/amd64 & linux/arm64
#
# Stages:
#   deps    — install all dependencies (includes dev for TypeScript compilation)
#   builder — compile TypeScript → dist/
#   runner  — minimal production image with only compiled JS + prod deps
#
# Build args:
#   NODE_VERSION  (default: 22)
#   BUILD_ENV     (default: production) — dev | beta | main | production
#
# Runtime env (inject via -e or secrets manager — NEVER bake into image):
#   PORT, CHAIN_ID, RPC_URL, OVERSEER_ADDRESS, EQUITY_VAULT_ADDRESS,
#   MDT_ADDRESS, BACKEND_SIGNER_PRIVATE_KEY, OPERATOR_PRIVATE_KEY,
#   ADMIN_API_KEY, BRIDGE_API_KEY, APCA_API_KEY_ID, APCA_API_SECRET_KEY,
#   PLAID_CLIENT_ID, PLAID_SECRET, AIRWALLEX_CLIENT_ID, AIRWALLEX_API_KEY,
#   ... (see Cairo-backend/.env.example for full list)
# ─────────────────────────────────────────────────────────────────────────────

ARG NODE_VERSION=22
ARG BUILD_ENV=production

# ── Stage 1: install all deps (cached) ───────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS deps

RUN corepack enable

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --prefer-offline

# ── Stage 2: compile TypeScript ───────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Compile TypeScript to dist/ using the project's tsconfig.json.
RUN npm run build

# ── Stage 3: production image ─────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS runner

ARG BUILD_ENV
LABEL org.opencontainers.image.title="maritime-cairo-backend"
LABEL org.opencontainers.image.description="Maritime Cairo-backend — Express API"
LABEL org.opencontainers.image.source="https://github.com/uvajim/Maritime"

WORKDIR /app

ENV NODE_ENV=production

# Non-root user.
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 expressjs

# Install production dependencies only (re-run npm ci --omit=dev in the runner).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --prefer-offline

# Copy compiled output.
COPY --from=builder --chown=expressjs:nodejs /app/dist ./dist

# Copy data files (banking users, etc.) if present.
COPY --from=builder --chown=expressjs:nodejs /app/data ./data

USER expressjs

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "dist/index.js"]
