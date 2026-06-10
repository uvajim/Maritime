# Maritime — Deployment Guide

## Overview

| Service | Tool | dev | beta | main |
|---------|------|-----|------|------|
| Cairo (frontend) | Vercel | ✅ auto | ✅ auto | ✅ auto |
| Cairo-backend | Railway | ✅ auto | ✅ auto | ✅ auto |
| cairo-erc20 (contracts) | Hardhat | manual only | manual (Sepolia) | manual (Mainnet) |

Auto-deploys trigger when a push to a protected branch passes all CI checks.
Contract deployments are always manual via `workflow_dispatch`.

---

## First-Time Setup

### 1. Vercel (Cairo frontend)

```bash
# Install Vercel CLI
npm i -g vercel

# Link the Cairo project
cd Cairo
vercel link   # Select your org and project, or create a new one
```

After linking, note the following from `.vercel/project.json`:
- `orgId`  → set as `VERCEL_ORG_ID` variable in each GitHub Environment
- `projectId` → set as `VERCEL_PROJECT_ID` variable

Create a Vercel token at https://vercel.com/account/tokens and set it as the
`VERCEL_TOKEN` secret in each GitHub Environment.

**Per-environment Vercel projects (recommended):**
Create three Vercel projects — `maritime-cairo-dev`, `maritime-cairo-beta`,
`maritime-cairo` — and set separate `VERCEL_PROJECT_ID` values per GitHub
Environment. This isolates preview and production URLs.

### 2. Railway (Cairo-backend)

```bash
npm i -g @railway/cli
railway login
cd Cairo-backend
railway init   # Creates a new Railway project or links to existing
```

From the Railway dashboard:
- Note the **Project ID** → `RAILWAY_PROJECT_ID` variable
- Note the **Service ID** → `RAILWAY_SERVICE_ID` variable
- Create a Railway API token → `RAILWAY_TOKEN` secret

Railway automatically detects Node.js via `package.json` and runs the `start`
script (`node server.js`). The `deploy.yml` workflow runs `railway up` to push
the latest code.

**Nixpacks build override:** Railway uses Nixpacks by default. To use the
Dockerfile instead, set `RAILWAY_DOCKERFILE_PATH=Dockerfile` in the Railway
service settings.

### 3. Smart Contract Deployment

Contract deployment is intentionally manual. To deploy:

1. Trigger `workflow_dispatch` → Deploy workflow
2. Select the target environment and set `deploy_contracts: true`
3. The workflow runs Hardhat scripts against the appropriate network:
   - `dev` / `beta` → Sepolia
   - `main` → Mainnet

After deployment, update the contract addresses in GitHub Environment variables
(`OVERSEER_ADDRESS`, `EQUITY_VAULT_ADDRESS`, `MDT_ADDRESS`) so that the next
frontend/backend deploy picks up the new addresses.

---

## Environment URLs

| Environment | Frontend | Backend |
|-------------|----------|---------|
| dev | `https://dev.maritime.app` (or Vercel preview URL) | `https://dev-api.railway.app` |
| beta | `https://beta.maritime.app` | `https://beta-api.railway.app` |
| main | `https://maritime.app` | `https://api.maritime.app` |

Set `FRONTEND_URL` and `BACKEND_URL` in GitHub Environment variables for the
smoke-test job to health-check these endpoints after each deploy.

---

## Rollback

### Cairo (Vercel)
Go to the Vercel dashboard → Project → Deployments → select a previous
deployment → "Promote to Production".

Or via CLI:
```bash
vercel rollback [deployment-url]
```

### Cairo-backend (Railway)
Go to Railway dashboard → Service → Deployments → click a previous deployment
→ "Redeploy".

Or via CLI:
```bash
# List recent deployments
railway deployments list

# Rollback to a specific deployment
railway deployments rollback <deployment-id>
```

### Docker-based rollback
If you've switched to Docker-based deploys (see MIGRATION.md):
```bash
docker pull ghcr.io/uvajim/maritime-cairo-backend:<sha>
# Update your service to use the pinned sha tag
```

---

## Health Checks

Both services expose a `/health` endpoint:

| Service | Endpoint | Expected response |
|---------|----------|------------------|
| Cairo-backend | `GET /health` | `200 OK` with `{"status":"ok"}` |
| Cairo | `GET /` | `200 OK` |

The `smoke-test` job in `deploy.yml` hits these after each deploy.

> **TODO:** Add a `/health` route to Cairo-backend (`src/index.ts`) if it
> doesn't already exist:
> ```typescript
> app.get('/health', (_req, res) => res.json({ status: 'ok' }));
> ```

---

## Environment Variable Management

The `sync-env` job in `deploy.yml` automatically pushes environment variables
from GitHub Secrets/Variables into Vercel and Railway before each deploy.

This means:
- You manage all config in GitHub Environments (one source of truth)
- Vercel/Railway are kept in sync automatically
- No manual dashboard updates required after initial setup

To add a new variable:
1. Add it to the `sync-env` job's `upsert_vercel_env` or `railway_set` calls
2. Add the secret/variable to the appropriate GitHub Environments
3. The next deploy will push it automatically

---

## Promoting Environments

```
git checkout dev
# ... merge feature branches ...
git checkout beta
git merge dev         # Creates a PR, gets reviewed, CI passes, deploys to beta
git checkout main
git merge beta        # Creates a PR, gets reviewed + approved, deploys to main
```

All merges go through PRs to trigger the CI gate and branch protection rules.
