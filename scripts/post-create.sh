#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd -- "$script_dir/.." && pwd)"

cd -- "$project_root"

run_optional() {
  local label="$1"
  shift

  echo "Setting up optional integration: $label"
  if "$@"; then
    echo "Optional integration ready: $label"
  else
    local status=$?
    echo "WARNING: Optional integration failed ($label, exit $status). Required project setup will remain available." >&2
  fi
}

echo "Preparing container environment."
setup-env.sh

echo "Restoring locked project dependencies."
npm ci

echo "Linking and validating repository Agent Skills."
scripts/setup-agent-skills.sh

echo "Installing the Playwright Chromium runtime and system dependencies."
npx playwright install --with-deps chromium

# MCP integrations are accelerators, not prerequisites for building or testing
# the application. Keep their failures visible without blocking Codespace setup.
run_optional "remote MCP servers" install-mcps.sh
run_optional "local shadcn MCP server" scripts/setup-local-mcps.sh

echo "Product Graph Editor container setup complete."
