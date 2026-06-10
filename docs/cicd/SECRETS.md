# Maritime — Secrets & Variables Reference

All sensitive values are stored as **GitHub/Gitea Secrets** or **Environment Variables** scoped to a specific GitHub Environment (`dev`, `beta`, `main`). No real secret ever appears in the repository.

---

## Secret Scoping

| Scope | GitHub path | Gitea path |
|-------|-------------|------------|
| Repository (shared) | Settings → Secrets and variables → Actions → Secrets | Settings → Actions → Secrets |
| Environment-scoped | Settings → Environments → `<env>` → Secrets | Settings → Actions → Secrets (prefix with `DEV_`, `BETA_`, `MAIN_` if env secrets are unsupported) |
| Variable (non-secret) | Settings → Environments → `<env>` → Variables | Settings → Actions → Variables |

---

## GitHub Environments

Create three environments in **Settings → Environments**:

| Environment | Protection rules |
|-------------|-----------------|
| `dev`   | None (auto-deploy from `dev` branch) |
| `beta`  | Required reviewers: 1 maintainer (optional) |
| `main`  | Required reviewers: 2 maintainers; timer: 10 min wait |

---

## Per-Environment Variables (`vars.*`)

These are non-secret configuration values set per GitHub Environment.

| Variable | `dev` | `beta` | `main` |
|----------|-------|--------|--------|
| `CHAIN_ID` | `11155111` | `11155111` | `1` |
| `NODE_ENV` | `development` | `production` | `production` |
| `BACKEND_PORT` | `3001` | `3001` | `3001` |
| `BACKEND_URL` | `https://dev-api.maritime.app` | `https://beta-api.maritime.app` | `https://api.maritime.app` |
| `FRONTEND_URL` | `https://dev.maritime.app` | `https://beta.maritime.app` | `https://maritime.app` |
| `VERCEL_ORG_ID` | _org ID_ | _same_ | _same_ |
| `VERCEL_PROJECT_ID` | _project ID (dev)_ | _project ID (beta)_ | _project ID (main)_ |
| `RAILWAY_PROJECT_ID` | _Railway project ID (dev)_ | _(beta)_ | _(main)_ |
| `RAILWAY_SERVICE_ID` | _Railway service ID (dev)_ | _(beta)_ | _(main)_ |
| `OVERSEER_ADDRESS` | _Sepolia address_ | _Sepolia address_ | _Mainnet address_ |
| `EQUITY_VAULT_ADDRESS` | _Sepolia address_ | _Sepolia address_ | _Mainnet address_ |
| `MDT_ADDRESS` | _Sepolia address_ | _Sepolia address_ | _Mainnet address_ |
| `FIREBASE_AUTH_DOMAIN` | `dev-project.firebaseapp.com` | `beta-project.firebaseapp.com` | `project.firebaseapp.com` |
| `FIREBASE_PROJECT_ID` | `maritime-dev` | `maritime-beta` | `maritime-prod` |
| `ALPACA_PAPER` | `true` | `true` | `false` |
| `PLAID_ENV` | `sandbox` | `sandbox` | `production` |
| `AIRWALLEX_ENV` | `demo` | `demo` | `production` |
| `OFFER_TTL` | `120` | `120` | `120` |

---

## Per-Environment Secrets (`secrets.*`)

These are sensitive values set per GitHub Environment. **Never share secrets across environments.**

| Secret | Where to get it | Notes |
|--------|----------------|-------|
| `VERCEL_TOKEN` | Vercel → Account → Tokens | One token per environment is safest |
| `RAILWAY_TOKEN` | Railway → Account → API tokens | Scope to project if possible |
| `WALLETCONNECT_PROJECT_ID` | cloud.reown.com → Projects | |
| `FIREBASE_API_KEY` | Firebase console → Project settings | |
| `RPC_URL` | Infura / Alchemy / Ankr | Sepolia for dev/beta, mainnet for main |
| `BACKEND_SIGNER_PRIVATE_KEY` | Generated wallet (EIP-712 signing only) | **Never used to send txns** |
| `OPERATOR_PRIVATE_KEY` | Generated wallet (must hold MINTER_ROLE) | Separate key per environment |
| `DEPLOYER_PRIVATE_KEY` | Hardhat deployer wallet | |
| `USER_PRIVATE_KEY` | Interaction scripts only | |
| `VAULT_PRIVATE_KEY` | Vault pre-approval wallet | |
| `ADMIN_API_KEY` | Generate with `openssl rand -hex 32` | |
| `BRIDGE_API_KEY` | dashboard.bridge.xyz | |
| `APCA_API_KEY_ID` | app.alpaca.markets → API Keys | Paper keys for dev/beta |
| `APCA_API_SECRET_KEY` | app.alpaca.markets → API Keys | |
| `PLAID_CLIENT_ID` | dashboard.plaid.com | |
| `PLAID_SECRET` | dashboard.plaid.com → Team Settings | Sandbox secret for dev/beta |
| `AIRWALLEX_CLIENT_ID` | airwallex.com → Settings → API Keys | |
| `AIRWALLEX_API_KEY` | airwallex.com → Settings → API Keys | |
| `AIRWALLEX_WEBHOOK_SECRET` | airwallex.com → Webhooks | |
| `SEPOLIA_RPC_URL` | Infura / Alchemy | Contracts CI only |
| `MAINNET_RPC_URL` | Infura / Alchemy | main env only |
| `ETHERSCAN_API_KEY` | etherscan.io/myapikey | For contract verification |

---

## Repository-Level Secrets (non-environment-scoped)

These are shared across all environments:

| Secret | Purpose |
|--------|---------|
| `GITLEAKS_LICENSE` | Gitleaks action on private org repos (optional for public repos) |

---

## Rotating Secrets

1. Generate a new value from the relevant provider dashboard.
2. Update in **Settings → Environments → `<env>` → Secrets**.
3. Re-run the deploy workflow to push the new value into the provider (Vercel/Railway).
4. Revoke the old secret from the provider dashboard.

---

## Key Isolation Guarantees

- `BACKEND_SIGNER_PRIVATE_KEY` — signs EIP-712 offers only; never sends on-chain transactions
- `OPERATOR_PRIVATE_KEY` — sends mint/burn/compliance txns only; separate key per environment
- `DEPLOYER_PRIVATE_KEY` — deploys contracts only; should be funded only at deploy time
- No private key appears in `NEXT_PUBLIC_*` variables (browser-visible)
