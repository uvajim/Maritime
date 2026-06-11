# Maritime — GitHub Actions vs Gitea Actions Differences

This project maintains two parallel workflow directories:
- `.github/workflows/` — GitHub Actions (primary CI/CD)
- `.gitea/workflows/`  — Gitea Actions (equivalent, with platform-specific workarounds)

---

## Feature Compatibility Matrix

| Feature | GitHub Actions | Gitea Actions | Workaround |
|---------|---------------|---------------|-----------|
| Workflow syntax (YAML) | ✅ | ✅ (v1.20+) | — |
| `on.push` / `on.pull_request` | ✅ | ✅ | — |
| `workflow_dispatch` | ✅ | ✅ (v1.20+) | — |
| `concurrency` | ✅ | ✅ (v1.21+) | — |
| Matrix strategy | ✅ | ✅ | — |
| `secrets.*` | ✅ | ✅ | — |
| `vars.*` (variables) | ✅ | ✅ (v1.22+) | Fallback: use secrets for vars on older Gitea |
| Environment-scoped secrets | ✅ | ✅ (v1.22+) | On older Gitea: prefix secrets with env name |
| GitHub Environment approval gates | ✅ | ❌ (not available) | Use branch protection + manual dispatch |
| `environment.url` in job | ✅ | ❌ (not rendered in UI) | Log the URL in a step instead |
| `GITHUB_TOKEN` auto-provisioned | ✅ | Use `GITEA_TOKEN` or `secrets.ACTIONS_TOKEN` |
| SARIF upload (`github/codeql-action/upload-sarif`) | ✅ | ❌ (no security tab) | Upload as artifact; use Trivy table output |
| CodeQL (`github/codeql-action`) | ✅ | ❌ (GitHub-specific) | Use Semgrep (`returntocorp/semgrep`) |
| OSSF Scorecard | ✅ | ❌ (GitHub-specific) | Skip or use manual Scorecard CLI |
| `actions/cache` with `type=gha` | ✅ | ✅ (v1.21+) with `gitea-cache` | May need cache backend configuration |
| `gitleaks/gitleaks-action` (Docker action) | ✅ | ✅ if runner has Docker | Or use `gitleaks` CLI directly |
| Container registry (ghcr.io) | ✅ | Use Gitea Packages registry instead |
| Cosign keyless signing (OIDC) | ✅ | ❌ (no OIDC token) | Use cosign with a key file instead |
| `secrets.GITHUB_TOKEN` for ghcr.io | ✅ | N/A — use `GITEA_TOKEN` for Gitea registry |
| `github.repository_owner` | ✅ | ✅ | — |
| Job `needs` and output passing | ✅ | ✅ | — |

---

## Gitea Runner Setup

Gitea Actions requires the [act_runner](https://gitea.com/gitea/act_runner) to be installed.

```bash
# Download the latest act_runner binary
curl -L https://gitea.com/gitea/act_runner/releases/latest/download/act_runner-linux-amd64 \
  -o act_runner

chmod +x act_runner

# Register the runner with your Gitea instance
./act_runner register \
  --instance https://your-gitea.example.com \
  --token    <runner-registration-token> \
  --name     maritime-runner \
  --labels   ubuntu-latest:docker://node:22-bookworm-slim

# Start the runner
./act_runner daemon
```

For Docker-based actions (Trivy, Gitleaks, Semgrep), ensure Docker is available
on the runner host.

---

## Gitea Container Registry

Gitea 1.19+ includes a built-in OCI-compatible container registry at:
`gitea.yourdomain.com/<owner>/<image>`

To use it, in `.gitea/workflows/docker.yml`:

```yaml
REGISTRY: gitea.yourdomain.com
IMAGE_CAIRO: gitea.yourdomain.com/${{ github.repository_owner }}/maritime-cairo

# Login:
- uses: docker/login-action@v3
  with:
    registry: gitea.yourdomain.com
    username: ${{ github.actor }}
    password: ${{ secrets.GITEA_TOKEN }}
```

---

## Gitea Environment Secrets (pre-v1.22 workaround)

If your Gitea version doesn't support environment-scoped secrets, prefix
secret names with the environment:

```yaml
# In workflow:
env:
  RAILWAY_TOKEN: ${{ secrets[format('{0}_RAILWAY_TOKEN', needs.guard.outputs.environment)] }}
```

Set secrets: `DEV_RAILWAY_TOKEN`, `BETA_RAILWAY_TOKEN`, `MAIN_RAILWAY_TOKEN`.

---

## Gitea Deployment Approval Gate Workaround

GitHub's Environment protection rules allow requiring human approval before
a deployment proceeds. Gitea does not have this as of v1.22.

**Recommended workaround for `main` environment:**

1. **Disable auto-deploy on push for `main`** by removing `main` from the
   `push.branches` trigger in `.gitea/workflows/deploy.yml`:

   ```yaml
   on:
     push:
       branches:
         - dev
         - beta
         # main intentionally excluded — requires manual dispatch
     workflow_dispatch: ...
   ```

2. Require a maintainer to manually trigger the deployment via
   **Repository → Actions → Deploy (Gitea) → Run workflow**.

3. Enforce branch protection on `main` to require PR approval before merge,
   which acts as the pre-deploy review gate.

---

## Syncing workflows between GitHub and Gitea

If you use both platforms (e.g., Gitea as primary with a GitHub mirror):

1. Push to Gitea → `.gitea/workflows/` runs
2. GitHub mirror → `.github/workflows/` runs

This is intentional: both directories are kept in sync with platform-appropriate
implementations. The core logic is identical; only the tool-specific steps differ.
