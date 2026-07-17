#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

if [[ ! -d node_modules ]]; then
  echo "Installing dependencies..."
  npm install
fi

exec npm run dev -- "$@"
