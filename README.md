# Maritime

A Web3 equity platform with tokenised stock holdings, on-chain trading, and fiat on/off ramps.

## Packages

| Package | Description | Stack |
|---------|-------------|-------|
| [`Cairo/`](Cairo/) | Web frontend | Next.js 16, React 19, Tailwind CSS 4, wagmi/viem |
| [`Cairo-backend/`](Cairo-backend/) | API server | Express 5, TypeScript, ethers.js 6 |
| [`cairo-erc20/`](cairo-erc20/) | Smart contracts | Solidity 0.8.28, Hardhat 3, OpenZeppelin 5 |

## Branch model

```
feature/* → dev → beta → main
```

Merges go through PRs. Deployments are automatic on `dev`, `beta`, and `main` after CI passes.

## CI/CD

See [`docs/cicd/README.md`](docs/cicd/README.md) for the full pipeline documentation.

Quick summary:
- **CI** — lint, build, tests, secret scanning, SAST, container scanning — runs on every push
- **Docker** — multi-arch (amd64 + arm64) images pushed to ghcr.io on deployment branches
- **Deploy** — Vercel (frontend), Railway (backend), Hardhat (contracts — manual)

## Local development (Docker)

```bash
cp Cairo/.env.example         Cairo/.env.local
cp Cairo-backend/.env.example Cairo-backend/.env.local
cp .env.example               .env
docker compose up --build
```

- Frontend: http://localhost:3000
- Backend:  http://localhost:3001

## Secrets

See [`docs/cicd/SECRETS.md`](docs/cicd/SECRETS.md).

## Migration

See [`docs/cicd/MIGRATION.md`](docs/cicd/MIGRATION.md) for moving to Render, Fly.io, AWS, GCP, Azure, or self-hosted Docker.
