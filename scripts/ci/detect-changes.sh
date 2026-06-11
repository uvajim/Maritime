#!/usr/bin/env bash
# Detects which monorepo packages changed vs a base ref and emits GitHub
# Actions / Gitea Actions step outputs (`name=value` written to $GITHUB_OUTPUT).
#
# Outputs: frontend, backend, contracts, ci  -> "true" | "false"
#   - frontend  : Cairo/**
#   - backend   : Cairo-backend/**
#   - contracts : cairo-erc20/**
#   - ci        : .github/**, scripts/ci/** (pipeline itself changed —
#                  treated as "run everything" so pipeline changes are tested)
#
# On workflow_dispatch (no base ref available / full run requested), or if
# FORCE_ALL=true, all outputs are "true".
#
# Usage: scripts/ci/detect-changes.sh <base-ref> <head-ref>

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

BASE_REF="${1:-}"
HEAD_REF="${2:-HEAD}"
FORCE_ALL="${FORCE_ALL:-false}"

emit() {
  local name="$1" value="$2"
  echo "$name=$value"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "$name=$value" >> "$GITHUB_OUTPUT"
  fi
}

if [ "$FORCE_ALL" = "true" ] || [ -z "$BASE_REF" ]; then
  echo "No base ref / FORCE_ALL set — marking all packages as changed."
  emit frontend true
  emit backend true
  emit contracts true
  emit ci true
  exit 0
fi

# Make sure the base ref is fetchable for diffing in shallow CI checkouts.
git fetch --no-tags --depth=1 origin "$BASE_REF" >/dev/null 2>&1 || true

if ! git rev-parse --verify "$BASE_REF" >/dev/null 2>&1; then
  echo "Base ref '$BASE_REF' not found locally — falling back to 'all changed'."
  emit frontend true
  emit backend true
  emit contracts true
  emit ci true
  exit 0
fi

CHANGED_FILES="$(git diff --name-only "$BASE_REF" "$HEAD_REF")"
echo "Changed files vs $BASE_REF:"
echo "$CHANGED_FILES"

has_change() {
  local pattern="$1"
  echo "$CHANGED_FILES" | grep -qE "$pattern"
}

frontend=false; backend=false; contracts=false; ci=false
has_change '^Cairo/'        && frontend=true
has_change '^Cairo-backend/' && backend=true
has_change '^cairo-erc20/'  && contracts=true
has_change '^(\.github/|scripts/ci/)' && ci=true

# If the pipeline itself changed, run everything so the new pipeline is
# exercised against every package.
if [ "$ci" = "true" ]; then
  frontend=true
  backend=true
  contracts=true
fi

emit frontend "$frontend"
emit backend "$backend"
emit contracts "$contracts"
emit ci "$ci"
