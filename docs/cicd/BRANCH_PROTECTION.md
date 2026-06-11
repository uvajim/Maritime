# Maritime — Branch Protection & Deployment Gates

This document describes the branch protection rules required to enforce:
1. No direct pushes to `dev`, `beta`, or `main`
2. All CI checks must pass before merging
3. Deployments only run from approved branches

---

## Branch Flow

```
feature/* ──► dev ──► beta ──► main
```

- Feature branches merge into `dev` via PR
- `dev` merges into `beta` via PR (or automated promotion)
- `beta` merges into `main` via PR (production promotion)

---

## GitHub — Branch Protection Rules

Set in: **Settings → Branches → Branch protection rules → Add rule**

### `dev` branch

| Setting | Value |
|---------|-------|
| Require a pull request before merging | ✅ |
| Require approvals | 1 |
| Dismiss stale PR approvals when new commits are pushed | ✅ |
| Require status checks to pass | ✅ |
| Required status checks | `✅ CI gate` (from ci.yml) |
| Require branches to be up to date before merging | ✅ |
| Do not allow bypassing the above settings | ✅ |
| Restrict who can push to matching branches | Maintainers only |
| Allow force pushes | ❌ |
| Allow deletions | ❌ |

### `beta` branch

| Setting | Value |
|---------|-------|
| Require a pull request before merging | ✅ |
| Require approvals | 1–2 |
| Required status checks | `✅ CI gate` |
| Require linear history | ✅ (recommended — makes rollback simpler) |
| Do not allow bypassing | ✅ |
| Restrict pushers | Senior engineers / release team |
| Allow force pushes | ❌ |
| Allow deletions | ❌ |

### `main` branch

| Setting | Value |
|---------|-------|
| Require a pull request before merging | ✅ |
| Require approvals | 2 |
| Dismiss stale approvals | ✅ |
| Require review from Code Owners | ✅ (add a CODEOWNERS file) |
| Required status checks | `✅ CI gate` |
| Require linear history | ✅ |
| Require signed commits | ✅ (recommended) |
| Do not allow bypassing | ✅ |
| Restrict who can push | Release managers only |
| Allow force pushes | ❌ |
| Allow deletions | ❌ |

### Setting up required status checks

The `ci-gate` job in `.github/workflows/ci.yml` is the aggregator that must pass.
To reference it in GitHub branch protection:

1. Push a commit to the branch at least once so the workflow runs.
2. In the branch protection rule → **Status checks** → search for `CI gate`.
3. Select it and save.

---

## GitHub — Environment Protection Rules

Set in: **Settings → Environments**

### `dev` environment
- No required reviewers (auto-deploys from `dev` branch)
- Deployment branch: `dev` only

### `beta` environment
- Required reviewers: 1 maintainer
- Wait timer: optional (5 minutes recommended)
- Deployment branches: `beta` only

### `main` environment
- Required reviewers: 2 maintainers
- Wait timer: 10 minutes
- Deployment branches: `main` only

> The `deploy.yml` workflow references `environment: ${{ ... }}` which activates
> the environment's approval gate before any deployment step runs.

---

## Gitea — Branch Protection Rules

Set in: **Repository → Settings → Branches → Protected Branches**

Gitea branch protection (v1.18+) supports:

| Setting | Gitea equivalent |
|---------|-----------------|
| Require pull request | Enable "Require pull request" |
| Required approvals | "Required approvals: N" |
| Status check requirement | "Required status checks" — enter the job name |
| Restrict push | "Whitelisted users/teams" for pushers |
| Block force push | "Block force push" checkbox |

### Gitea required status checks

In Gitea, enter the **exact job name** as it appears in the Actions log:

| Branch | Required check |
|--------|---------------|
| `dev` | `✅ CI gate` |
| `beta` | `✅ CI gate` |
| `main` | `✅ CI gate` |

> **Gitea limitation:** As of v1.22, Gitea does not have an "Environment protection" concept
> equivalent to GitHub's environment approval gates. The workaround is:
> 1. Use branch protection to require PR approval for `main` and `beta`.
> 2. Use the `guard` job in deploy.yml which hard-fails if the branch is not whitelisted.
> 3. For `main` deployments that require explicit human approval, add a manual
>    `workflow_dispatch` requirement: disable auto-deploy on push for `main` and require
>    a team member to trigger it manually via the Gitea Actions UI.

### Gitea environment secrets (v1.22+)

Gitea 1.22 added environment-scoped secrets. Set them at:
**Repository → Settings → Actions → Secrets** and choose the environment scope.

For older Gitea versions, prefix secrets with the environment name:
- `DEV_RAILWAY_TOKEN`, `BETA_RAILWAY_TOKEN`, `MAIN_RAILWAY_TOKEN`
- Then in the workflow: `${{ secrets[format('{0}_RAILWAY_TOKEN', upper(env.ENVIRONMENT))] }}`

---

## CODEOWNERS (recommended for main)

Create `.github/CODEOWNERS` (GitHub) or `CODEOWNERS` (Gitea):

```
# Default owners for all files
*                   @uvajim

# Frontend
Cairo/              @uvajim @frontend-team

# Backend
Cairo-backend/      @uvajim @backend-team

# Smart contracts — require explicit sign-off
cairo-erc20/        @uvajim @security-team
```

---

## Deployment Branch Whitelist

The `guard` job in `deploy.yml` enforces the whitelist in code:

```yaml
if   [[ "$REF" == "refs/heads/main"  ]]; then ENV=main
elif [[ "$REF" == "refs/heads/beta"  ]]; then ENV=beta
elif [[ "$REF" == "refs/heads/dev"   ]]; then ENV=dev
else exit 1   # All other branches are rejected
fi
```

Any branch not in this list cannot trigger a deployment even if it somehow
bypasses branch protection. The workflow simply exits with code 1.
