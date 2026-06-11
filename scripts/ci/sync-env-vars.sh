#!/usr/bin/env bash
# Pushes environment variables/secrets into Vercel or Railway, driven by a
# manifest of variable *names* (no values are ever committed to the repo).
#
# For each name "FOO" in the manifest, this script looks up "FOO__<ENV>"
# (e.g. "FOO__DEV") in the supplied secrets/vars JSON dumps and, if present,
# pushes it to the target provider for the given environment.
#
# Required env vars per provider:
#   vercel  : VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID
#   railway : RAILWAY_TOKEN
#
# Usage:
#   sync-env-vars.sh <vercel|railway> <dev|beta|main> <manifest.json> <secrets.json> <vars.json>
#
# manifest.json shape: { "vars": ["NAME1", "NAME2", ...] }
# secrets.json / vars.json: flat JSON objects, e.g. the output of
# `${{ toJSON(secrets) }}` / `${{ toJSON(vars) }}` from the calling workflow.

set -euo pipefail

PROVIDER="${1:?provider (vercel|railway) required}"
ENVIRONMENT="${2:?environment (dev|beta|main) required}"
MANIFEST="${3:?path to manifest.json required}"
SECRETS_JSON="${4:?path to secrets.json required}"
VARS_JSON="${5:?path to vars.json required}"

ENV_UPPER="$(echo "$ENVIRONMENT" | tr '[:lower:]' '[:upper:]')"

if ! command -v jq >/dev/null 2>&1; then
  echo "::error::jq is required" >&2
  exit 1
fi

case "$PROVIDER" in
  vercel)
    : "${VERCEL_TOKEN:?VERCEL_TOKEN must be set}"
    : "${VERCEL_PROJECT_ID:?VERCEL_PROJECT_ID must be set}"
    ;;
  railway)
    : "${RAILWAY_TOKEN:?RAILWAY_TOKEN must be set}"
    ;;
  *)
    echo "::error::Unknown provider '$PROVIDER' (expected vercel or railway)" >&2
    exit 1
    ;;
esac

mapfile -t NAMES < <(jq -r '.vars[]' "$MANIFEST")

synced=0
skipped=0

for name in "${NAMES[@]}"; do
  key="${name}__${ENV_UPPER}"

  value="$(jq -r --arg k "$key" '.[$k] // empty' "$SECRETS_JSON")"
  if [ -z "$value" ]; then
    value="$(jq -r --arg k "$key" '.[$k] // empty' "$VARS_JSON")"
  fi

  if [ -z "$value" ]; then
    echo "skip $name (no $key configured)"
    skipped=$((skipped + 1))
    continue
  fi

  case "$PROVIDER" in
    vercel)
      # Remove any existing value first so `env add` doesn't fail/duplicate.
      vercel env rm "$name" production --yes --token="$VERCEL_TOKEN" >/dev/null 2>&1 || true
      printf '%s' "$value" | vercel env add "$name" production --token="$VERCEL_TOKEN" >/dev/null
      ;;
    railway)
      railway variables --set "${name}=${value}" --skip-deploys >/dev/null
      ;;
  esac

  echo "synced $name -> $PROVIDER ($ENVIRONMENT)"
  synced=$((synced + 1))
done

echo "Done: $synced synced, $skipped skipped (no value configured)."
