#!/usr/bin/env bash
# Git hygiene checks for CI.
#
# Fails the build if the repo contains things that should never be committed:
#   - real .env files (anything matching .env / .env.local / .env.*.local /
#     .env.<environment>.local), private key / certificate files
#   - unresolved merge-conflict markers in tracked text files
#   - files larger than the configured size limit (default 5MB), which are
#     usually accidental binary/build-artifact commits
#
# Intentionally-committed example/template env files are allowlisted because
# they contain placeholders only, not secrets:
#   - **/.env.example
#   - Cairo/.env.development, Cairo/.env.production (public Next.js config)
#
# Usage: scripts/ci/check-git-hygiene.sh

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

MAX_FILE_SIZE_BYTES="${MAX_FILE_SIZE_BYTES:-5242880}" # 5MB
status=0

echo "== Checking for committed secret-bearing files =="

# Allowlist: example/template files and known-public Next.js env files.
is_allowlisted_env_file() {
  case "$1" in
    */.env.example|.env.example) return 0 ;;
    Cairo/.env.development|Cairo/.env.production) return 0 ;;
    *) return 1 ;;
  esac
}

while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    *.env|*.env.local|*.env.*.local|.env|.env.local)
      if is_allowlisted_env_file "$f"; then continue; fi
      echo "::error::Tracked env file with potential secrets: $f"
      status=1
      ;;
    *.env.*)
      if is_allowlisted_env_file "$f"; then continue; fi
      echo "::error::Tracked env file with potential secrets: $f"
      status=1
      ;;
    *.pem|*.key|*.p12|*.pfx|*id_rsa*|*id_ed25519*)
      echo "::error::Tracked private key / certificate file: $f"
      status=1
      ;;
  esac
done < <(git ls-files)

echo "== Checking for unresolved merge-conflict markers =="

while IFS= read -r f; do
  [ -z "$f" ] && continue
  # Skip binary files
  if git check-attr -a -- "$f" | grep -q "binary: set"; then continue; fi
  if grep -Iq -E '^(<<<<<<<|=======|>>>>>>>)( |$)' -- "$f" 2>/dev/null; then
    echo "::error::Merge-conflict marker found in: $f"
    status=1
  fi
done < <(git ls-files)

echo "== Checking for oversized tracked files (> ${MAX_FILE_SIZE_BYTES} bytes) =="

while IFS= read -r f; do
  [ -z "$f" ] && continue
  [ -f "$f" ] || continue
  size=$(wc -c < "$f" | tr -d ' ')
  if [ "$size" -gt "$MAX_FILE_SIZE_BYTES" ]; then
    echo "::error::File exceeds ${MAX_FILE_SIZE_BYTES} bytes ($size bytes): $f"
    status=1
  fi
done < <(git ls-files)

if [ "$status" -ne 0 ]; then
  echo "Git hygiene check FAILED."
  exit 1
fi

echo "Git hygiene check passed."
