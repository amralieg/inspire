#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PY=${INSPIRE_RC_PYTHON:-python3}
setting() { "$PY" "$ROOT/rc_settings.py" get "$1"; }
REPO_DIR=$(setting repo_dir)
REPO=amralieg/inspire
W40=$(setting work)
RC1=$W40
BRANCH=$(setting branch)
APP=$(setting scratch_app)
CATALOG=$(setting catalog)
LATEST=$(setting latest_tag)
LABEL=${LABEL:-online}
COMPARE_TO=${COMPARE_TO:-$(setting compare_to)}
PROBE=$(setting probe)
CACHE=$(setting assets_cache)
PROTECTED=$(setting protected_apps)

ts() { date -u +%H:%M:%SZ; }
step() { echo; echo "[$(ts)] ==== $*"; }
ok() { echo "[$(ts)] OK   $*"; }
fail() { echo "[$(ts)] FAIL $*" >&2; exit 1; }
STARTED=$(date +%s)
trap 'rc=$?; [ $rc -ne 0 ] && echo "[$(ts)] STOPPED with exit $rc after $(( $(date +%s) - STARTED )) s" >&2' EXIT

[ $# -ge 2 ] || fail "usage: $0 <sha> <tag> [--dry-run | --prestage-assets | --publish-only] [--tag-links]"
[ $# -le 4 ] || fail "too many arguments"
SHA_IN=$1; TAG=$2; MODE=${3:-full}
case "$MODE" in full|--dry-run|--prestage-assets|--publish-only) ;; *) fail "unknown flag $MODE";; esac
# --tag-links writes the release setting into the install, which tests the tag links rather than the customer path; explicit only
LINKS=""
case "${4:-}" in
  "") ;;
  --tag-links) LINKS=--tag-links ;;
  *) fail "unknown flag $4" ;;
esac
[ -z "$LINKS" ] || [ "$MODE" = full ] || fail "--tag-links only applies to a full run"
[[ "$TAG" =~ ^v[0-9]\.[0-9]\.[0-9]-rc\.[0-9]$ ]] || fail "$TAG is not vN.N.N-rc.N with single digits; this script only makes pre-releases"
for p in $PROTECTED; do [ "$APP" != "$p" ] || fail "$APP is protected"; done

SUFFIX=$([ "$MODE" = --dry-run ] && echo "-dry" || echo "")
KEY="${TAG}${SUFFIX}"
WORK_A="${KEY}-a"; WORK_B="${KEY}-b"
OUT=$([ "$MODE" = --dry-run ] && echo "$RC1/${TAG}-dry_out" || echo "$RC1/${TAG}_out")
SCRATCH=$RC1/$KEY
REPORT=$RC1/${KEY}_report.json

step "1. resolve $SHA_IN on origin/$BRANCH"
git -C "$REPO_DIR" fetch -q origin $BRANCH dev
SHA=$(git -C "$REPO_DIR" rev-parse --verify "${SHA_IN}^{commit}") || fail "$SHA_IN is not a commit"
DEV=$(git -C "$REPO_DIR" rev-parse origin/$BRANCH)
git -C "$REPO_DIR" merge-base --is-ancestor "$SHA" "$DEV" || fail "$SHA is not on origin/$BRANCH ($DEV)"
ok "sha $SHA on origin/$BRANCH (head $DEV$([ "$SHA" = "$DEV" ] && echo ", the head" || echo ", NOT the head"))"

step "2. build the assets from the notebook pins at ${SHA:0:7} (repo app/agent/release/build_assets.py, cache $CACHE)"
rm -rf "$SCRATCH"; mkdir -p "$SCRATCH/src" "$SCRATCH/assets"
git -C "$REPO_DIR" archive --format=tar "$SHA" | tar -x -C "$SCRATCH/src"
[ -f "$PROBE" ] || fail "no saved serverless probe at $PROBE"
if [ -z "${INSPIRE_ASSETS_PYPI:-}" ]; then
  INDEX=$(pip3 config get global.index-url 2>/dev/null || true)
  export INSPIRE_ASSETS_PYPI=${INDEX%/simple*}
  [ -n "$INSPIRE_ASSETS_PYPI" ] || unset INSPIRE_ASSETS_PYPI
fi
echo "    PyPI JSON from ${INSPIRE_ASSETS_PYPI:-https://pypi.org}"
"$PY" "$SCRATCH/src/app/agent/release/build_assets.py" --out "$SCRATCH/assets_out" --probe "$PROBE" --cache "$CACHE" \
  > "$SCRATCH/build_assets.log" 2>&1 || { tail -20 "$SCRATCH/build_assets.log"; fail "build_assets.py failed"; }
tail -2 "$SCRATCH/build_assets.log"
tar -x -C "$SCRATCH/assets" -f "$SCRATCH/assets_out/inspire-assets.tar"
ok "assets: $(find "$SCRATCH/assets" -type f | wc -l | tr -d ' ') files extracted to $SCRATCH/assets"

gh_env() {
  local token; token=$(gh auth token --user amralieg 2>/dev/null) || fail "gh holds no token for amralieg"
  [ -n "$token" ] || fail "gh holds no token for amralieg"
  local who; who=$(GH_TOKEN=$token gh api user --jq .login) || fail "the amralieg token is rejected"
  [ "$who" = amralieg ] || fail "the amralieg token signs in as $who"
  export GH_TOKEN=$token
}

latest_guard() {
  local loc; loc=$(curl -sS -o /dev/null -w '%{redirect_url}' "https://github.com/$REPO/releases/latest")
  [ "${loc##*/}" = "$LATEST" ] && [ "$LATEST" != "$TAG" ] || fail "/releases/latest points at $loc, not $LATEST"
  local st; st=$(gh release view "$TAG" --repo "$REPO" --json isPrerelease,isLatest 2>/dev/null || echo none)
  [ "$st" = none ] || { echo "$st" | grep -q '"isPrerelease":true' && echo "$st" | grep -q '"isLatest":false'; } || fail "$TAG is $st"
  ok "latest is ${loc##*/}; $TAG is $([ "$st" = none ] && echo 'not published' || echo "$st")"
}
draft_id() { gh api "repos/$REPO/releases?per_page=100" --jq ".[] | select(.tag_name==\"$TAG\" and .draft) | .id" | head -1; }
draft_asset() { gh api "repos/$REPO/releases/$1" --jq ".assets[] | select(.name==\"$2\") | \"\(.id) \(.digest) \(.state)\""; }
upload_asset() {
  local name; name=$(basename "$2")
  printf 'header = "Authorization: Bearer %s"\n' "$GH_TOKEN" | curl -f -S --progress-bar -K - -X POST \
    -H "Content-Type: application/octet-stream" -H "Accept: application/vnd.github+json" -T "$2" \
    -o "$SCRATCH/upload_$name.json" "https://uploads.github.com/repos/$REPO/releases/$1/assets?name=$name" \
    2> "$SCRATCH/upload_$name.progress" || { tr '\r' '\n' < "$SCRATCH/upload_$name.progress" | tail -3; fail "upload of $name failed"; }
}
verify_asset_download() {
  local id=$1 want=$2 got
  gh api "repos/$REPO/releases/assets/$id" -H "Accept: application/octet-stream" > "$SCRATCH/verify_download.bin"
  got="sha256:$(shasum -a 256 "$SCRATCH/verify_download.bin" | cut -d' ' -f1)"
  rm -f "$SCRATCH/verify_download.bin"
  [ "$got" = "$want" ] || fail "downloaded asset $id is $got, the build is $want"
  ok "asset $id downloaded back: $got matches the build"
}

if [ "$MODE" = --prestage-assets ]; then
  step "P. stage inspire-assets.tar into a draft pre-release $TAG (not public, no tag, never latest)"
  gh_env
  gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1 && [ -z "$(draft_id)" ] && fail "$TAG already exists as a published release"
  ID=$(draft_id)
  if [ -z "$ID" ]; then
    ID=$(gh api -X POST "repos/$REPO/releases" -f tag_name="$TAG" -f target_commitish="$SHA" -f name="Inspire $TAG (release candidate)" \
      -f body="Release candidate $TAG, staging." -F draft=true -F prerelease=true -f make_latest=false --jq .id)
  fi
  [ -n "$ID" ] || fail "no draft for $TAG after create"
  gh api "repos/$REPO/git/ref/tags/$TAG" >/dev/null 2>&1 && fail "tag $TAG exists on $REPO; a draft must not have one"
  TAR="$SCRATCH/assets_out/inspire-assets.tar"
  WANT="sha256:$(shasum -a 256 "$TAR" | cut -d' ' -f1)"
  read -r AID HAVE STATE <<< "$(draft_asset "$ID" inspire-assets.tar)" || true
  for EXTRA in $(gh api "repos/$REPO/releases/$ID" --jq '.assets[] | select(.name!="inspire-assets.tar") | .id'); do
    gh api -X DELETE "repos/$REPO/releases/assets/$EXTRA" && echo "    removed draft asset $EXTRA, a staging draft holds only the tar"
  done
  if [ -n "${AID:-}" ] && { [ "$HAVE" != "$WANT" ] || [ "$STATE" != uploaded ]; }; then
    gh api -X DELETE "repos/$REPO/releases/assets/$AID"
    echo "    removed stale draft tar $AID ($HAVE, $STATE)"; AID=""
  fi
  if [ -z "${AID:-}" ]; then
    echo "    uploading $(wc -c < "$TAR" | tr -d ' ') bytes; progress in $SCRATCH/upload_inspire-assets.tar.progress"
    upload_asset "$ID" "$TAR"
    read -r AID HAVE STATE <<< "$(draft_asset "$ID" inspire-assets.tar)"
  fi
  [ "$HAVE" = "$WANT" ] && [ "$STATE" = uploaded ] || fail "draft asset digest $HAVE ($STATE), build $WANT"
  verify_asset_download "$AID" "$WANT"
  ok "draft $ID holds inspire-assets.tar $WANT; run without a flag once the last fix is on dev"
  exit 0
fi

step "3. release build A and B from ${SHA:0:7} (rc_release.py --dry-run: build, leak scan, compare with $COMPARE_TO)"
for W in "$WORK_A" "$WORK_B"; do
  "$PY" "$ROOT/rc_release.py" "$TAG" "$REPO_DIR" "$REPO_DIR" --assets "$SCRATCH/assets" --app-sha "$SHA" --agent-sha "$SHA" \
    --target "$SHA" --work "$W" --dry-run --compare-to "$COMPARE_TO" > "$SCRATCH/release_$W.log" 2>&1 \
    || { tail -25 "$SCRATCH/release_$W.log"; fail "rc_release build $W failed"; }
  { grep -E 'leak scan|equal v|holds|"version"' "$SCRATCH/release_$W.log" || true; } | sed 's/^/    /'
  ok "build $W in $W40/$W/release"
done

step "4. determinism (A vs B), the built files vs $COMPARE_TO, and the out folder"
rm -rf "$OUT"; mkdir -p "$OUT"
cp "$W40/$WORK_A/release/"* "$OUT/"
"$PY" - "$W40/$WORK_A/release" "$W40/$WORK_B/release" "$OUT" "$COMPARE_TO" "$REPO" "$REPORT" "$SCRATCH/assets_out/inspire-assets.tar" <<'PYEOF'
import hashlib, json, pathlib, sys, urllib.request, zipfile
a, b, out = map(pathlib.Path, sys.argv[1:4]); prior, repo, report, assets_tar = sys.argv[4], sys.argv[5], pathlib.Path(sys.argv[6]), pathlib.Path(sys.argv[7])
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
names = sorted(p.name for p in out.iterdir())
want = ["inspire-app.zip", "inspire-assets.tar", "inspire_installer.py", "manifest.json"]
hard = []
if names != want:
    hard.append(f"out folder holds {names}, a release holds exactly {want}")
man = json.loads((out / "manifest.json").read_text())
parts = sum(len(e.get("parts") or []) for e in man["files"])
print(f"    out {out}: {len(names)} files, {parts} .partNN parts")
rows = {}
for n in names:
    sa, sb = sha(a / n), sha(b / n)
    rows[n] = {"size": (out / n).stat().st_size, "sha256": sa, "deterministic": sa == sb}
    print(f"    {'SAME' if sa == sb else 'DIFF'}  {n:22} {rows[n]['size']:>11,} bytes  A {sa[:16]}  B {sb[:16]}")
if sha(assets_tar) != rows["inspire-assets.tar"]["sha256"]:
    hard.append("release.py rebuilt a different inspire-assets.tar than build_assets.py wrote")
else:
    print("    SAME  inspire-assets.tar from build_assets.py == the one release.py rebuilt")
for n in ("inspire_installer.py", "inspire-assets.tar"):
    if not rows[n]["deterministic"]:
        hard.append(f"{n} differs between two builds")
za, zb = zipfile.ZipFile(a / "inspire-app.zip"), zipfile.ZipFile(b / "inspire-app.zip")
ca = {i.filename: hashlib.sha256(za.read(i)).hexdigest() for i in za.infolist()}
cb = {i.filename: hashlib.sha256(zb.read(i)).hexdigest() for i in zb.infolist()}
order = [i.filename for i in za.infolist()] == [i.filename for i in zb.infolist()]
meta = sorted(i.filename for i, j in zip(za.infolist(), zb.infolist()) if i.filename == j.filename and (i.date_time, i.external_attr) != (j.date_time, j.external_attr))
content = sorted(n for n in set(ca) | set(cb) if ca.get(n) != cb.get(n))
print(f"    inspire-app.zip: {len(ca)} members; contents differ in {len(content)}; member order same {order}; date/mode differ in {len(meta)}"
      + (f", e.g. {meta[:4]}" if meta else ""))
if content:
    hard.append(f"inspire-app.zip contents differ between builds: {content[:6]}")
ma, mb = json.loads((a / "manifest.json").read_text()), json.loads((b / "manifest.json").read_text())
for m in (ma, mb):
    for e in m["files"]:
        if e["name"] == "inspire-app.zip":
            e.pop("sha256"); e.pop("size")
if ma != mb:
    hard.append("manifest.json differs beyond the inspire-app.zip sha256/size")
zip_meta_only = not rows["inspire-app.zip"]["deterministic"] and not content
if zip_meta_only:
    print("    WARN  inspire-app.zip bytes differ only in zip entry metadata (timestamps), so manifest.json differs only in its sha256")
old = json.loads(urllib.request.urlopen(f"https://github.com/{repo}/releases/download/{prior}/manifest.json", timeout=60).read())
oldf = {old["installer"]["name"]: old["installer"], **{e["name"]: e for e in old["files"]}}
newf = {man["installer"]["name"]: man["installer"], **{e["name"]: e for e in man["files"]}}
print(f"    vs {prior}: version {old['version']} -> {man['version']}")
changes = []
for n in sorted(set(oldf) | set(newf)):
    o, x = oldf.get(n), newf.get(n)
    if not o or not x:
        changes.append(f"{n}: {'added' if x else 'removed'}"); continue
    tag = "same sha256" if o["sha256"] == x["sha256"] else ("size %+d bytes" % (x["size"] - o["size"]) if o["size"] != x["size"] else "same size, new sha256")
    print(f"      {n:22} {o['size']:>11,} -> {x['size']:>11,}  {tag}")
oc = {c["path"]: c for c in next(e for e in old["files"] if e["name"] == "inspire-app.zip")["contents"]}
nc = {c["path"]: c for c in next(e for e in man["files"] if e["name"] == "inspire-app.zip")["contents"]}
for p in sorted(set(oc) | set(nc)):
    o, x = oc.get(p), nc.get(p)
    if not o or not x:
        changes.append(f"zip {p}: {'added' if x else 'removed'}")
    elif o["sha256"] != x["sha256"]:
        changes.append(f"zip {p}: {o['size']:,} -> {x['size']:,} bytes ({x['size'] - o['size']:+,})")
print(f"      inspire-app.zip members: {len(oc)} -> {len(nc)}; changed/added/removed: {len(changes)}")
for c in changes[:30]:
    print(f"        {c}")
report.write_text(json.dumps({"files": rows, "parts": parts, "zip_metadata_only_diff": zip_meta_only, "vs": prior, "changes": changes,
                              "hard": hard}, indent=1))
for h in hard:
    print(f"    HARD  {h}")
sys.exit(2 if hard else 0)
PYEOF
ok "determinism and comparison report: $REPORT"

step "5. pre-flight for publish and install (read-only)"
gh_env
latest_guard
ok "gh token for amralieg present and accepted (used only by this process)"
STATE=$(gh release view "$TAG" --repo "$REPO" --json isPrerelease,isLatest,isDraft 2>/dev/null || echo none)
DRAFT=$(draft_id)
if [ "$STATE" != none ] && [ -z "$DRAFT" ]; then
  [ "$MODE" = --dry-run ] && echo "    NOTE $TAG already exists on $REPO: $STATE (a real run reuses it only if it is a non-latest pre-release)" \
    || { echo "$STATE" | grep -q '"isPrerelease":true' && echo "$STATE" | grep -q '"isLatest":false' || fail "$TAG exists and is not a non-latest pre-release"; }
fi
ok "release $TAG: $([ -n "$DRAFT" ] && echo "staged draft $DRAFT" || ([ "$STATE" = none ] && echo "does not exist yet" || echo "$STATE"))"
[ ! -e "$W40/${TAG}-${LABEL}_install.json" ] || fail "$W40/${TAG}-${LABEL}_install.json exists: rc_install refuses a second install under label $LABEL; set LABEL"
ok "no earlier install state for ${TAG}-${LABEL}"
BUSY_RC=0
"$PY" - "$APP" "$ROOT" <<'PYEOF' || BUSY_RC=$?
import sys
sys.path.insert(0, sys.argv[2])
import rc_install
w = rc_install.client()
try:
    app = w.apps.get(sys.argv[1])
    print(f"    App {app.name}: {app.url}, compute {app.compute_status.state if app.compute_status else None}, sp {app.service_principal_client_id}")
except Exception as exc:
    if "not" not in str(exc).lower():
        raise
    print(f"    App {sys.argv[1]} does not exist yet; the installer creates it")
busy = rc_install.busy_protected_runs(w, sys.argv[1])
sys.exit(3 if busy else 0)
PYEOF
if [ "$BUSY_RC" = 0 ]; then
  ok "no active job run started by the $APP service principal (or the protected one rc_install watches)"
elif [ "$BUSY_RC" = 3 ] && [ "$MODE" = --publish-only ]; then
  echo "    NOTE active runs by the watched service principals; --publish-only publishes and installs nothing"
else
  fail "the active-run check exited $BUSY_RC (3 means active job runs by the $APP service principal or the protected one; the install would restart the App under them)"
fi

if [ "$MODE" = --dry-run ]; then
  step "dry run done in $(( $(date +%s) - STARTED )) s: nothing published, nothing installed; out $OUT"
  exit 0
fi

step "6. publish $TAG as a pre-release on $REPO (target $SHA, never latest)"
latest_guard
if [ -n "$DRAFT" ]; then
  WANT="sha256:$(shasum -a 256 "$OUT/inspire-assets.tar" | cut -d' ' -f1)"
  for STALE in $(gh api "repos/$REPO/releases/$DRAFT" --jq ".assets[] | select(.name!=\"inspire-assets.tar\" or .digest!=\"$WANT\" or .state!=\"uploaded\") | .id"); do
    gh api -X DELETE "repos/$REPO/releases/assets/$STALE"
    echo "    removed draft asset $STALE: it is not the tar this build made, so rc_release uploads the build's file"
  done
  read -r AID HAVE STATE <<< "$(draft_asset "$DRAFT" inspire-assets.tar)" || true
  [ -n "${AID:-}" ] && echo "    reusing the prestaged inspire-assets.tar $AID: $HAVE equals the build" \
    || echo "    no prestaged tar with the build's sha256; rc_release uploads it from this computer"
  NOTES=$("$PY" -c "import json,sys; sys.path.insert(0,'$ROOT'); import rc_release as r; print(r.notes_of(json.load(open('$W40/$WORK_A/sources.json'))))")
  gh release edit "$TAG" --repo "$REPO" --draft=false --prerelease --latest=false --target "$SHA" --notes "$NOTES" >/dev/null
  ok "draft $DRAFT published as pre-release $TAG at $SHA; inspire-assets.tar already uploaded"
fi
"$PY" "$ROOT/rc_release.py" "$TAG" "$REPO_DIR" "$REPO_DIR" --skip-build --work "$WORK_A" --target "$SHA" 2>&1 | tee "$SCRATCH/publish.log"
[ "${PIPESTATUS[0]}" -eq 0 ] || fail "publish or release check failed"
"$PY" -c 'import sys; sys.path.insert(0, sys.argv[1]); import rc_release; sys.exit(0 if rc_release.check_verdict(open(sys.argv[2], encoding="utf-8").read()) else 1)' "$ROOT" "$SCRATCH/publish.log" \
  || fail "the release check did not report every check OK with 0 failures, see $SCRATCH/publish.log"
TARGET=$(gh api "repos/$REPO/git/ref/tags/$TAG" --jq .object.sha)
[ "$TARGET" = "$SHA" ] || fail "tag $TAG points at $TARGET, not $SHA"
ok "published, every file downloaded back through the tag links with the manifest sha256, tag at $SHA"
latest_guard
if [ "$MODE" = --publish-only ]; then
  step "publish-only done in $(( $(date +%s) - STARTED )) s: $TAG published as a pre-release at $SHA, nothing installed; out $OUT"
  exit 0
fi
"$PY" "$ROOT/isolation.py" snapshot "$W40/${TAG}_iso_before.json" || fail "isolation snapshot before install failed"

# the customer path is the default: the installer downloads its own stamped tag from the release, as a customer's does
step "7. install into $APP through rc_install.py, $([ -n "$LINKS" ] && echo 'with the tag links setting (explicit --tag-links)' || echo 'the customer path: online, no tag links')"
"$PY" "$ROOT/rc_install.py" "$TAG" all --app "$APP" --label "$LABEL" --work "$WORK_A" --online $LINKS --catalog "$CATALOG" \
  > "$SCRATCH/install.log" 2>&1 || { tail -30 "$SCRATCH/install.log"; fail "rc_install failed"; }
{ grep -E '^\[' "$SCRATCH/install.log" || true; } | head -8 | sed 's/^/    /'

step "8. verify the install"
"$PY" "$ROOT/isolation.py" snapshot "$W40/${TAG}_iso_after.json" && "$PY" "$ROOT/isolation.py" diff "$W40/${TAG}_iso_before.json" "$W40/${TAG}_iso_after.json" || fail "the install changed something a watched App uses"
"$PY" - "$W40/${TAG}-${LABEL}_verify.json" "$OUT/manifest.json" <<'PYEOF'
import json, sys
v, version = json.load(open(sys.argv[1])), json.load(open(sys.argv[2]))["version"]
n = v["assets_landed"].split(" of ")
checks = {"installer run SUCCESS": v["result"] == "SUCCESS", "GET /api/defaults HTTP 200": v["defaults_status"] == 200,
          "envSkipsSetupWizard true": v["envSkipsSetupWizard"] is True, f"agentVersion {version}": v["agentVersion_defaults"] == version,
          "deployed server.js == build": v.get("deployed_server_equals_build") is True,
          "landing assets == build": v.get("landing_assets_match_build") is True,
          "every asset landed": n[0] == n[1].split()[0], "no installer errors": not v["installer_lines"]["errors"]}
for name, good in checks.items():
    print(f"    {'OK  ' if good else 'FAIL'} {name}")
print(f"    App {v['app']}: {v['url']}  ({v['seconds']} s install)")
sys.exit(0 if all(checks.values()) else 4)
PYEOF
step "done in $(( $(date +%s) - STARTED )) s: $TAG published as a pre-release, installed on $APP, wizard skipped"
