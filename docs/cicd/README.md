# Maritime — CI/CD Documentation

## Quick start

```
.github/workflows/ci.yml       → Lint, test, security scans (every push/PR)
.github/workflows/docker.yml   → Multi-arch Docker builds (deployment branches)
.github/workflows/deploy.yml   → Deploy to Vercel + Railway (deployment branches + manual)
.gitea/workflows/ci.yml        → Gitea-equivalent CI
.gitea/workflows/deploy.yml    → Gitea-equivalent deployment
```

---

## Branch model

```
feature/*  ──PR──► dev ──PR──► beta ──PR──► main
                    │            │            │
                    ▼            ▼            ▼
                 auto-deploy  auto-deploy  auto-deploy
                 (dev env)    (beta env)   (main env)
```

- **feature branches** → CI runs; no deployment
- **dev** → deploys to dev environment automatically after CI passes
- **beta** → deploys to beta environment automatically after CI passes
- **main** → deploys to production after CI passes + approval gates

---

## Pipeline overview

### CI (`ci.yml`) — runs on every push and PR

| Check | Tool | Fails on |
|-------|------|---------|
| Secret scanning | Gitleaks | Any exposed credential |
| Dependency audit | npm audit | moderate+ severity |
| License check | license-checker | GPL/AGPL/LGPL/SSPL |
| JS/TS SAST | CodeQL (GitHub) / Semgrep (Gitea) | High/Critical findings |
| Solidity SAST | Slither | HIGH severity |
| Solidity lint | solhint | Error-level rules |
| Frontend build | next build | Build failure |
| Frontend type-check | tsc --noEmit | TS errors (advisory) |
| Backend type-check | tsc --noEmit | TS errors |
| Backend build | tsc | Compile errors |
| Contract compile | hardhat compile | Compile errors |
| Contract tests | hardhat test | Test failures |
| Container scan | Trivy | CRITICAL/HIGH CVEs (unfixed) |
| OSSF Scorecard | scorecard-action | Advisory (main branch only) |

### Docker (`docker.yml`) — runs on deployment branches

- Multi-arch build: `linux/amd64` + `linux/arm64`
- Images tagged: `<env>`, `<sha>`, `latest` (main only), `<semver>` (tags)
- Supply-chain: cosign image signing on main
- Registry: `ghcr.io/uvajim/maritime-<service>`

### Deploy (`deploy.yml`) — runs on deployment branches or manual dispatch

1. **Guard** — validates the branch is whitelisted; rejects all others
2. **sync-env** — pushes secrets/vars from GitHub Environments into Vercel and Railway
3. **deploy-cairo** — builds and deploys to Vercel
4. **deploy-backend** — deploys to Railway
5. **deploy-contracts** — manual only; deploys Hardhat contracts to the correct network
6. **smoke-test** — hits `/health` endpoints after deploy

---

## Secrets setup

See [SECRETS.md](./SECRETS.md) for the complete list of secrets and variables
required per environment.

---

## Branch protection

See [BRANCH_PROTECTION.md](./BRANCH_PROTECTION.md) for GitHub and Gitea
branch protection rule configuration.

---

## Migrating providers

See [MIGRATION.md](./MIGRATION.md) for step-by-step migration guides to:
Render, Fly.io, AWS (S3/ECS/App Runner), GCP (Cloud Run), Azure, self-hosted Docker.

---

## Gitea vs GitHub differences

See [GITEA_DIFFERENCES.md](./GITEA_DIFFERENCES.md) for the feature compatibility
matrix and Gitea-specific workarounds.

---

## Adding tests

Both Cairo and Cairo-backend have no test suites yet. The CI pipeline includes
a **configurable placeholder** that prints a notice instead of failing.

To add tests to Cairo (frontend):
```bash
cd Cairo
npm install --save-dev vitest @vitejs/plugin-react @testing-library/react @testing-library/jest-dom jsdom
```

Add to `Cairo/package.json`:
```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest"
}
```

To add tests to Cairo-backend:
```bash
cd Cairo-backend
npm install --save-dev jest @types/jest ts-jest supertest @types/supertest
```

Once a `test` script exists and does not output `no test specified`, the CI
pipeline will automatically run it.

---

## Local Docker development

```bash
# Copy env files
cp Cairo/.env.example Cairo/.env.local
cp Cairo-backend/.env.example Cairo-backend/.env.local

# Start all services
docker compose up --build

# Start with PostgreSQL
docker compose --profile full up --build

# Stop
docker compose down
```

Services:
- `http://localhost:3000` — Cairo frontend
- `http://localhost:3001` — Cairo-backend
- `localhost:6379`        — Redis
- `localhost:5432`        — PostgreSQL (--profile full)
