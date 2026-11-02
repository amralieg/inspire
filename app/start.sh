#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
BUNDLE="backend/build/server.js"

if [ ! -f "$BUNDLE" ]; then
  echo "Inspire cannot start: $BUNDLE is missing from this App folder. Install Inspire again from its release, or build the App zip with app/scripts/package-for-workspace.sh."
  exit 1
fi

NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "Inspire cannot start: this App environment has no node command."
  exit 1
fi

echo "Inspire AI starting from $(pwd) with node $("$NODE" --version) on port ${PORT:-8080}"
export NODE_ENV=production
exec "$NODE" "$BUNDLE"
