# Maritime — Provider Migration Guide

The CI/CD design is intentionally provider-agnostic. Each deployment target
is isolated to a few lines in `deploy.yml`. Switching providers requires
**no changes to CI logic** — only the deployment steps.

---

## Current targets

| Service | Current provider | Migration complexity |
|---------|-----------------|---------------------|
| Cairo (frontend) | Vercel | Low |
| Cairo-backend | Railway | Low |
| Container registry | ghcr.io | Low |

---

## Cairo frontend migrations

### → Render (Static Site)

```yaml
- name: Deploy to Render
  run: |
    curl -sX POST \
      -H "Authorization: Bearer ${{ secrets.RENDER_API_KEY }}" \
      -H "Content-Type: application/json" \
      "https://api.render.com/v1/services/${{ vars.RENDER_SERVICE_ID }}/deploys"
```

Set `RENDER_API_KEY` secret and `RENDER_SERVICE_ID` variable per environment.
In Render, create a **Static Site** pointing to the `Cairo` directory with
build command `npm run build` and publish dir `.next`.

### → Fly.io

```yaml
- name: Deploy to Fly.io
  run: |
    curl -L https://fly.io/install.sh | sh
    flyctl deploy --remote-only --app ${{ vars.FLY_APP_NAME }}
  env:
    FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

Create a `Cairo/fly.toml` pointing to the Dockerfile.

### → AWS (CloudFront + S3 or App Runner)

**Static export on S3:**
```yaml
- name: Build static export
  run: npm run build && npm run export  # Requires output: 'export' in next.config.ts
  working-directory: Cairo
- name: Sync to S3
  run: aws s3 sync Cairo/out/ s3://${{ vars.S3_BUCKET }} --delete
  env:
    AWS_ACCESS_KEY_ID:     ${{ secrets.AWS_ACCESS_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    AWS_DEFAULT_REGION:    ${{ vars.AWS_REGION }}
- name: Invalidate CloudFront
  run: aws cloudfront create-invalidation --distribution-id ${{ vars.CF_DISTRIBUTION_ID }} --paths "/*"
```

**App Runner (Docker):**
```yaml
- name: Deploy to App Runner
  run: |
    aws apprunner start-deployment --service-arn ${{ vars.APP_RUNNER_ARN }}
  env:
    AWS_ACCESS_KEY_ID:     ${{ secrets.AWS_ACCESS_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

### → GCP (Cloud Run)

```yaml
- name: Auth to GCP
  uses: google-github-actions/auth@v2
  with:
    credentials_json: ${{ secrets.GCP_SA_KEY }}
- name: Deploy to Cloud Run
  uses: google-github-actions/deploy-cloudrun@v2
  with:
    service: maritime-cairo
    image: ghcr.io/uvajim/maritime-cairo:${{ needs.guard.outputs.environment }}
    region: ${{ vars.GCP_REGION }}
    project_id: ${{ vars.GCP_PROJECT_ID }}
```

### → Azure (Static Web Apps)

```yaml
- name: Deploy to Azure Static Web Apps
  uses: Azure/static-web-apps-deploy@v1
  with:
    azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_TOKEN }}
    repo_token: ${{ secrets.GITHUB_TOKEN }}
    action: upload
    app_location: Cairo
    output_location: .next
```

### → Self-hosted Docker

```yaml
- name: Deploy via SSH
  run: |
    ssh ${{ vars.SSH_HOST }} "
      docker pull ghcr.io/uvajim/maritime-cairo:${{ needs.guard.outputs.environment }}
      docker stop maritime-cairo || true
      docker rm   maritime-cairo || true
      docker run -d --name maritime-cairo \
        -p 3000:3000 \
        --env-file /etc/maritime/cairo.env \
        --restart unless-stopped \
        ghcr.io/uvajim/maritime-cairo:${{ needs.guard.outputs.environment }}
    "
  env:
    SSH_PRIVATE_KEY: ${{ secrets.SSH_PRIVATE_KEY }}
```

---

## Cairo-backend migrations

### → Render (Web Service)

```yaml
- name: Deploy to Render
  run: |
    curl -sX POST \
      -H "Authorization: Bearer ${{ secrets.RENDER_API_KEY }}" \
      "https://api.render.com/v1/services/${{ vars.RENDER_SERVICE_ID }}/deploys"
```

### → Fly.io

```yaml
- name: Deploy to Fly.io
  run: |
    curl -L https://fly.io/install.sh | sh
    flyctl deploy --remote-only --app ${{ vars.FLY_BACKEND_APP }}
  env:
    FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

### → AWS ECS (Fargate)

```yaml
- name: Update ECS task definition
  run: |
    TASK_DEF=$(aws ecs describe-task-definition --task-definition maritime-backend --query taskDefinition)
    NEW_TASK=$(echo "$TASK_DEF" | jq '.containerDefinitions[0].image = "ghcr.io/uvajim/maritime-cairo-backend:${{ needs.guard.outputs.environment }}"')
    aws ecs register-task-definition --cli-input-json "$NEW_TASK"
    aws ecs update-service --cluster maritime --service cairo-backend --force-new-deployment
  env:
    AWS_ACCESS_KEY_ID:     ${{ secrets.AWS_ACCESS_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

### → GCP Cloud Run

```yaml
- uses: google-github-actions/auth@v2
  with:
    credentials_json: ${{ secrets.GCP_SA_KEY }}
- uses: google-github-actions/deploy-cloudrun@v2
  with:
    service: maritime-cairo-backend
    image: ghcr.io/uvajim/maritime-cairo-backend:${{ needs.guard.outputs.environment }}
    region: ${{ vars.GCP_REGION }}
    project_id: ${{ vars.GCP_PROJECT_ID }}
    env_vars: |
      CHAIN_ID=${{ vars.CHAIN_ID }}
      PORT=3001
    secrets: |
      RPC_URL=RPC_URL:latest
      OPERATOR_PRIVATE_KEY=OPERATOR_PRIVATE_KEY:latest
```

### → Azure Container Apps

```yaml
- name: Deploy to Azure Container Apps
  uses: azure/container-apps-deploy-action@v1
  with:
    acrName: ${{ vars.ACR_NAME }}
    containerAppName: maritime-cairo-backend
    resourceGroup: ${{ vars.RESOURCE_GROUP }}
    imageToDeploy: ghcr.io/uvajim/maritime-cairo-backend:${{ needs.guard.outputs.environment }}
```

### → Self-hosted Docker (with Watchtower auto-pull)

Deploy the image and let Watchtower update it:
```yaml
- name: Notify Watchtower
  run: |
    curl -H "Authorization: Bearer ${{ secrets.WATCHTOWER_TOKEN }}" \
      "https://${{ vars.WATCHTOWER_HOST }}/v1/update"
```

---

## Container Registry migrations

### → Docker Hub

In `docker.yml`, change:
```yaml
REGISTRY: docker.io
IMAGE_CAIRO: docker.io/${{ vars.DOCKERHUB_USERNAME }}/maritime-cairo
```
And replace:
```yaml
- uses: docker/login-action@v3
  with:
    registry: docker.io
    username: ${{ vars.DOCKERHUB_USERNAME }}
    password: ${{ secrets.DOCKERHUB_TOKEN }}
```

### → Gitea Container Registry

```yaml
REGISTRY: gitea.yourdomain.com
IMAGE_CAIRO: gitea.yourdomain.com/<owner>/maritime-cairo
```
```yaml
- uses: docker/login-action@v3
  with:
    registry: gitea.yourdomain.com
    username: ${{ gitea.actor }}
    password: ${{ secrets.GITEA_TOKEN }}
```

### → AWS ECR

```yaml
- name: Login to ECR
  uses: aws-actions/amazon-ecr-login@v2
  with:
    registry: ${{ vars.AWS_ACCOUNT_ID }}.dkr.ecr.${{ vars.AWS_REGION }}.amazonaws.com
```

---

## Zero-downtime migration checklist

1. Add the new provider's secrets/vars to the GitHub Environment
2. Uncomment or add the relevant deploy step in `deploy.yml` (next to the old one)
3. Deploy to `dev` first — both old and new targets will receive the deploy
4. Validate the new target with smoke tests
5. Update DNS / load balancer to point to the new provider
6. Remove the old provider's deploy step
7. Remove the old provider's secrets from the environment
