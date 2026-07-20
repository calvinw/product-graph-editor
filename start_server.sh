#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is required but was not found in PATH." >&2
  exit 1
fi

dependencies_changed=false

if [[ ! -d node_modules ]]; then
  dependencies_changed=true
elif [[ -f package-lock.json ]] && \
  { [[ ! -f node_modules/.package-lock.json ]] || \
    [[ package.json -nt node_modules/.package-lock.json ]] || \
    [[ package-lock.json -nt node_modules/.package-lock.json ]]; }; then
  dependencies_changed=true
elif ! npm ls --depth=0 >/dev/null 2>&1; then
  dependencies_changed=true
elif ! node --input-type=module -e "await import('vite')" >/dev/null 2>&1; then
  # npm can report a healthy top-level tree even when a nested optional
  # dependency (such as Rollup's platform-specific binary) is missing.
  dependencies_changed=true
fi

if [[ "$dependencies_changed" == true ]]; then
  echo "Installing dependencies..."
  if [[ -f package-lock.json ]]; then
    npm ci --include=dev
  else
    npm install --include=dev
  fi
fi

exec npm run dev -- "$@"
