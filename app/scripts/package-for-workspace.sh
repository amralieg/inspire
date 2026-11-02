#!/usr/bin/env bash
# Build frontend (optional) and create InspireAI-workspace.zip for `npm run deploy` / deploy:inspire.
set -euo pipefail

CALLER_DIR="$(pwd)"
APP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_ROOT"

OUT="${ARTIFACT_ZIP:-$APP_ROOT/dist/InspireAI-workspace.zip}"
case "$OUT" in
  /*) ;;
  *) OUT="$CALLER_DIR/$OUT" ;;
esac
mkdir -p "$(dirname "$OUT")"
OUT="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"

SKIP_BUILD="${SKIP_BUILD:-0}"
if [[ "$SKIP_BUILD" != "1" ]]; then
  echo "==> Installing frontend and backend build dependencies on this machine"
  (cd frontend && npm ci --no-audit --no-fund)
  (cd backend && npm ci --ignore-scripts --no-audit --no-fund)
  echo "==> Building frontend (set SKIP_BUILD=1 to skip)"
  (cd frontend && npm run build)
fi

echo "==> Bundling agent and demo notebooks for Databricks App runtime"
node "$APP_ROOT/scripts/bundle-agent-notebook.mjs"
node "$APP_ROOT/scripts/bundle-demo-notebook.mjs"
cmp -s "$APP_ROOT/dbx_generate_demo_data.py" "$APP_ROOT/backend/dbx_generate_demo_data.py" || cp -f "$APP_ROOT/dbx_generate_demo_data.py" "$APP_ROOT/backend/dbx_generate_demo_data.py"

echo "==> Bundling the backend into backend/build/server.js"
node "$APP_ROOT/scripts/bundle-backend.mjs"

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/inspire_app_stage.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
app_files() {
  node -p "require('$APP_ROOT/backend/lib/appPaths.js').$1.join('\n')"
}
stage() {
  if [[ -z "$1" ]]; then
    return 0
  fi
  mkdir -p "$STAGE/$(dirname "$1")"
  cp -R "$APP_ROOT/$1" "$STAGE/$1"
}
APP_FILES="$(app_files APP_FILES)"
APP_FILES_WHEN_PRESENT="$(app_files APP_FILES_WHEN_PRESENT)"
while IFS= read -r item; do
  stage "$item"
done < <(printf '%s\n' "$APP_FILES")
while IFS= read -r item; do
  if [[ -n "$item" && -e "$APP_ROOT/$item" ]]; then
    stage "$item"
  fi
done < <(printf '%s\n' "$APP_FILES_WHEN_PRESENT")
if [[ -d installer ]]; then
  while IFS= read -r file; do
    mkdir -p "$STAGE/$(dirname "$file")"
    cp "$APP_ROOT/$file" "$STAGE/$file"
  done < <(find installer -type f ! -path '*/test/*' ! -path '*/__pycache__/*' ! -name '.DS_Store')
fi
find "$STAGE" -name '.DS_Store' -delete

rm -f "$OUT"
echo "==> Zipping to $OUT"
(cd "$STAGE" && zip -r -X -q "$OUT" .)

echo "==> Checking the zip installs and runs with no internet and fits the 10MB workspace import limit"
if ! node "$APP_ROOT/scripts/offline-gate.js" "$OUT"; then
  rm -f "$OUT"
  echo "==> Removed $OUT because it failed the check above"
  exit 1
fi
echo "==> Done: $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes)"
