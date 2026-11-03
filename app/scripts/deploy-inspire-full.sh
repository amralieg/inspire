#!/usr/bin/env bash
# Install a local build: build a release, import inspire_installer.py, manifest.json, inspire-app.zip and inspire-assets.tar into
# /Workspace/Users/<you>/inspire-install, then run the installer there once as a serverless job, offline from those files.
#
# Prereqs: Databricks CLI, .env with DATABRICKS_HOST + DATABRICKS_TOKEN (or DATABRICKS_CONFIG_PROFILE with valid auth).
# Needs: INSPIRE_ASSETS_DIR (the agent assets folder with its manifest.json), INSPIRE_WAREHOUSE_ID, INSPIRE_CATALOG.
# Optional: INSPIRE_APP_NAME (default inspire-ai).
#
# Usage: npm run deploy   (alias for deploy:inspire)
set -euo pipefail

APP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INSTALLER_ROOT="$(cd "$APP_ROOT/.." && pwd)"
cd "$APP_ROOT"

if [[ -f "$APP_ROOT/.env" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$APP_ROOT/.env"
  set +a
elif [[ -f "$INSTALLER_ROOT/.env" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$INSTALLER_ROOT/.env"
  set +a
fi

if [[ -n "${DATABRICKS_CONFIG_PROFILE:-}" ]]; then
  DB=( databricks -p "$DATABRICKS_CONFIG_PROFILE" )
else
  DB=( databricks )
fi

if [[ -z "${DATABRICKS_CONFIG_PROFILE:-}" && ( -z "${DATABRICKS_HOST:-}" || -z "${DATABRICKS_TOKEN:-}" ) ]]; then
  echo "Set DATABRICKS_HOST + DATABRICKS_TOKEN in .env, or set DATABRICKS_CONFIG_PROFILE."
  exit 1
fi
: "${INSPIRE_ASSETS_DIR:?Set INSPIRE_ASSETS_DIR to the agent assets folder that holds manifest.json}"
: "${INSPIRE_WAREHOUSE_ID:?Set INSPIRE_WAREHOUSE_ID to the SQL warehouse id the installer uses}"
: "${INSPIRE_CATALOG:?Set INSPIRE_CATALOG to the catalog that holds the _inspire schema}"

RELEASE_DIR="$APP_ROOT/dist/release"
echo "==> 1) Build the release into $RELEASE_DIR"
rm -rf "$RELEASE_DIR"
python3 "$APP_ROOT/installer/release.py" build --assets "$INSPIRE_ASSETS_DIR" --out "$RELEASE_DIR"

USER_EMAIL="$( "${DB[@]}" current-user me -o json | python3 -c "import json,sys; print(json.load(sys.stdin)['userName'])")"
FOLDER="/Workspace/Users/${USER_EMAIL}/inspire-install"
SETTINGS="$(mktemp)"
python3 -c "import json, os, sys; json.dump({k: v for k, v in {'warehouse_id': os.environ['INSPIRE_WAREHOUSE_ID'], 'catalog': os.environ['INSPIRE_CATALOG'], 'app_name': os.environ.get('INSPIRE_APP_NAME', '')}.items() if v != ''}, open(sys.argv[1], 'w'))" "$SETTINGS"
OFFLINE_INSTALLER="$(mktemp)"
python3 -c "import sys; text = open(sys.argv[1], encoding='utf-8').read(); text.count('INTERNET_BLOCKED = False') == 1 or sys.exit('INTERNET_BLOCKED = False is not in the installer exactly once'); open(sys.argv[2], 'w', encoding='utf-8').write(text.replace('INTERNET_BLOCKED = False', 'INTERNET_BLOCKED = True'))" "$RELEASE_DIR/inspire_installer.py" "$OFFLINE_INSTALLER"

echo "==> 2) Import the installer (INTERNET_BLOCKED = True, so it installs this build), manifest.json, inspire-app.zip and inspire-assets.tar into $FOLDER"
"${DB[@]}" workspace delete "$FOLDER" --recursive || true
"${DB[@]}" workspace mkdirs "$FOLDER"
"${DB[@]}" workspace import "$FOLDER/inspire_installer" --file "$OFFLINE_INSTALLER" --format SOURCE --language PYTHON --overwrite
rm -f "$OFFLINE_INSTALLER"
"${DB[@]}" workspace import "$FOLDER/inspire_installer_test.json" --file "$SETTINGS" --format RAW --overwrite
rm -f "$SETTINGS"
for name in manifest.json inspire-app.zip inspire-assets.tar; do
  "${DB[@]}" workspace import "$FOLDER/$name" --file "$RELEASE_DIR/$name" --format RAW --overwrite
done

echo "==> 3) Run the installer once as a serverless job"
SUBMIT_JSON="$(mktemp)"
python3 -c "import json, sys; json.dump({'run_name': 'inspire-installer', 'tasks': [{'task_key': 'installer', 'notebook_task': {'notebook_path': sys.argv[2]}, 'environment_key': 'default', 'max_retries': 0, 'disable_auto_optimization': True}], 'environments': [{'environment_key': 'default', 'spec': {'client': '2'}}]}, open(sys.argv[1], 'w'))" "$SUBMIT_JSON" "$FOLDER/inspire_installer"
"${DB[@]}" jobs submit --json "@${SUBMIT_JSON}" --timeout 45m
rm -f "$SUBMIT_JSON"

echo ""
echo "==> Done. When the run succeeds: Compute, Apps, ${INSPIRE_APP_NAME:-inspire-ai}."
