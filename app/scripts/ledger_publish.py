#!/usr/bin/env python3
"""Publish the Inspire requirements ledger into app/docs/requirements/ledger.md.

The coordinator keeps the working copy outside the repo. This script reads that copy and the scope file,
sanitizes every row, adds a Release column and a hand-off section, and writes the public ledger. The output
is deterministic: the same inputs always give the same bytes (no timestamps, no host or user names).

    INSPIRE_LEDGER_PRIVATE_NAMES=<private-names-file> python3 app/scripts/ledger_publish.py --ledger <working-copy> --scope <scope-file>
    python3 app/scripts/ledger_publish.py --check    # exits 1 when app/docs/requirements/ledger.md or the root CLAUDE.md leaks

The leak patterns below are the single source for both the publisher and the leak gate test
(app/agent/tests/unit/ledger_leak_gate_test.py), so a pattern cannot drift between them.
"""
import argparse
import os
import pathlib
import re
import sys

APP = pathlib.Path(__file__).resolve().parent.parent  # app/
REPO = APP.parent  # the repo root, where CLAUDE.md sits (Amr asked for it there)
OUT = APP / "docs" / "requirements" / "ledger.md"
PUBLIC_DOC_HOSTS = ("docs.databricks.com", "learn.microsoft.com/azure/databricks", "cloud.google.com")

# ---- leak patterns (shared with the gate) -------------------------------------------------------------------------
LONG_NUMBER = re.compile(r"\d{12,}")
# D-208 (REQ-208): the retired label "Money at stake" reads "Value at stake" in every published quote, case kept.
RETIRED_STAKE = re.compile(r"money(?=\s+at\s+stake)", re.IGNORECASE)
UUID_LIKE = re.compile(r"\b[0-9a-f]{8}-(?:[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{4}-[0-9a-f]{4}-\.\.\.|\.\.\.)")
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
HOME_PATH = re.compile(r"(?:/Users/|/home/|/private/tmp/|/tmp/|~/)[^\s,;)\]\"'`|]*")
WORKSPACE_HOST = re.compile(r"[\w.-]*(?:azuredatabricks\.net|cloud\.databricks\.com|gcp\.databricks\.com|databricksapps\.com|\badb-\d+)[\w./-]*")
URL = re.compile(r"https?://[^\s,;)\]\"'`|]+")
TOKEN = re.compile(
    r"dapi[0-9a-f]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}"
    r"|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}"
    r"|(?<![\w/.-])(?=[A-Za-z0-9+/]*\d)(?=[A-Za-z0-9+/]*[A-Z])(?=[A-Za-z0-9+/]*[a-z])[A-Za-z0-9+/]{40,}={0,2}(?![\w/.-])"
)
# Customer and company names never live in the repo, not even in this pattern: the coordinator keeps them in a private file outside
# the repo (one name or regex per line) and points INSPIRE_LEDGER_PRIVATE_NAMES at it. With no file, the pattern matches nothing and
# the gate still checks every other kind; noCompanyNames.test.js guards the repo files themselves.
def private_names(path):
    try:
        names = [line.strip() for line in pathlib.Path(path).read_text(encoding="utf-8").splitlines() if line.strip() and not line.startswith("#")]
    except (OSError, TypeError):
        names = []
    return re.compile(r"(?i)\b(?:" + "|".join(names) + r")\w*") if names else re.compile(r"(?!)")


CUSTOMER = private_names(os.environ.get("INSPIRE_LEDGER_PRIVATE_NAMES"))
# Test workspace names: a scratch App or catalog name must never reach the public ledger.
SCRATCH_APP = re.compile(r"\binspire-(?:kinds|customer|cust|walk|e2e|rc\d|happy|fwa|fraud|amr|bakehouse|v\d)[a-z0-9-]*")
SCRATCH_WORKSPACE = re.compile(r"\bmy-(?:uae|adp|gcp|aws)\b")
SCRATCH_CATALOG = re.compile(r"\badb_fe_uae_\d+\b|\b(?:home_)?amr_ali\b|\binspire_kinds_rc\d+\b|\binspire_\d{2}\b")
PROFANITY = re.compile(r"(?i)\b(shit|fuck|damn|idiot|stupid|bullshit|crap|wtf|retard|moron)\w*")

LEAK_KINDS = (
    ("12+ digit number", LONG_NUMBER),
    ("uuid-like id", UUID_LIKE),
    ("email address", EMAIL),
    ("home path", HOME_PATH),
    ("workspace host", WORKSPACE_HOST),
    ("token-like string", TOKEN),
    ("customer name", CUSTOMER),
    ("scratch App name", SCRATCH_APP),
    ("scratch workspace name", SCRATCH_WORKSPACE),
    ("scratch catalog name", SCRATCH_CATALOG),
    ("profanity", PROFANITY),
)

# Verbatim quoted asks that carry profanity or an insult. Each is rewritten and marked (paraphrased).
PARAPHRASE = (
    ("design is shit, remove", "design is poor (paraphrased), remove"),
    ("I do not want to see this shit again fix it", "I do not want to see this again, fix it (paraphrased)"),
    ("No Idiot, I will install", "No, I will install (paraphrased)"),
    ("you stupid I was sleeping why do not you grant", "I was sleeping, why did you not grant (paraphrased)"),
    ("first page useless", "first page does not help (paraphrased)"),
    ('"what is this shit"', '"what is this" (paraphrased)'),
)

HANDOFF_STATES_OK = ("DONE",)
RELEASE_RC2 = "RC2"
RELEASE_HANDOFF = "HANDOFF"
RELEASE_NONE = "not in RC2 scope"
AREAS = (
    ("Build wizard and first-run flow", r"wizard|step|first run|review & build|who uses"),
    ("Data filters and labels", r"filter|label|reask|row group"),
    ("Metrics, measure and value at stake", r"stake|measure|metric|mvp-d|total"),
    ("Access, grants and permissions", r"grant|permission|principal|access|service principal|sourceaccess"),
    ("Apps, pages and layout", r"\bapp\b|page|card|tour|help|button|layout|overlap|1280|1440|dark"),
    ("Build runs and Genie agent", r"build|job|genie|run\b|runs\b|agent"),
    ("Gates, tests and release", r"gate|suite|pytest|\brc\b|rc\.|install|release|test|ci\b|pre-release"),
)


def sanitize(text):
    """Return (clean text, counts of every substitution). Order matters: specific rules run before general ones."""
    counts = {}

    def swap(pattern, repl, label, source):
        n = len(pattern.findall(source))
        if n:
            counts[label] = counts.get(label, 0) + n
        return pattern.sub(repl, source)

    for old, new in PARAPHRASE:
        if old in text:
            counts["paraphrased ask"] = counts.get("paraphrased ask", 0) + text.count(old)
            text = text.replace(old, new)
    text = swap(RETIRED_STAKE, lambda m: "Value" if m.group(0)[0].isupper() else "value", "retired label (D-208)", text)
    text = swap(CUSTOMER, "a customer", "customer name", text)
    text = swap(SCRATCH_APP, "the scratch App", "scratch App name", text)
    text = swap(SCRATCH_WORKSPACE, "the scratch workspace", "scratch workspace name", text)
    text = swap(SCRATCH_CATALOG, "the scratch catalog", "scratch catalog name", text)
    text = swap(EMAIL, "<email>", "email address", text)
    text = _swap_paths(text, counts)
    text = swap(URL, _url_repl, "URL", text)
    text = swap(WORKSPACE_HOST, "<workspace host removed>", "workspace host", text)
    text = swap(TOKEN, "<token>", "token-like string", text)
    text = swap(UUID_LIKE, "<id>", "uuid-like id", text)
    text = swap(LONG_NUMBER, "<id>", "12+ digit number", text)
    return text, counts


def _swap_paths(text, counts):
    def repl(match):
        value = match.group(0)
        counts["home path"] = counts.get("home path", 0) + 1
        return "a scratch worktree" if value.startswith("/private/tmp/") else "the coordinator's notes"

    return HOME_PATH.sub(repl, text)


def _url_repl(match):
    url = match.group(0)
    host_path = url.split("://", 1)[1]
    if any(host_path.startswith(public) for public in PUBLIC_DOC_HOSTS):
        return url
    return "<url removed>"


def find_leaks(text):
    """Return a list of (kind, matched text) for every leak in text. Public docs URLs are not leaks."""
    hits = []
    for kind, pattern in LEAK_KINDS:
        for m in pattern.finditer(text):
            hits.append((kind, m.group(0)))
    for m in URL.finditer(text):
        if not any(m.group(0).split("://", 1)[1].startswith(p) for p in PUBLIC_DOC_HOSTS):
            hits.append(("non-public URL", m.group(0)))
    return hits


def parse_row(line):
    """Map a ledger row onto (req, asked, ask, state, lane, evidence, acceptance).

    The working copy was written by hand in two layouts. Seven cells map straight across. Six cells carry the state
    and the lane in one cell (the first word is the state). Four and five cells are older rows: the cells that exist
    keep their order, and missing fields stay empty. Nothing is dropped; the raw remainder goes to evidence.
    """
    cells = line[2:-2].split(" | ")
    req, asked, ask = cells[0], cells[1], cells[2]
    if len(cells) == 7:
        return req, asked, ask, cells[3], cells[4], cells[5], cells[6]
    if len(cells) == 6:
        parts = cells[3].split(" ", 1)
        return req, asked, ask, parts[0], (parts[1] if len(parts) > 1 else ""), cells[4], cells[5]
    if len(cells) == 5:
        return req, asked, ask, cells[3], "", cells[4], ""
    state = cells[3].split(" ", 1)[0] if len(cells) > 3 else ""
    return req, asked, ask, state, "", " | ".join(cells[3:]), ""


def area_of(ask, lane):
    text = f"{ask} {lane}".lower()
    for name, pattern in AREAS:
        if re.search(pattern, text):
            return name
    return "Other"


def release_for(req_id, rc2, handoff):
    if req_id in rc2:
        return RELEASE_RC2
    if req_id in handoff:
        return RELEASE_HANDOFF
    return RELEASE_NONE


def read_scope(path):
    rc2, handoff = set(), set()
    for line in pathlib.Path(path).read_text(encoding="utf-8").splitlines():
        if line.startswith("RC2:"):
            rc2 |= set(re.findall(r"REQ-\d+", line))
        elif line.startswith("HANDOFF:"):
            handoff |= set(re.findall(r"REQ-\d+", line))
    overlap = rc2 & handoff
    if overlap:
        raise SystemExit(f"scope file lists {sorted(overlap)} as both RC2 and HANDOFF")
    return rc2, handoff


def build(ledger_text, rc2, handoff):
    """Return (markdown, counts). Pure function: same input, same output."""
    counts, rows = {}, []
    for line in ledger_text.splitlines():
        if not re.match(r"^\| (REQ|D)-", line):
            continue
        parts = parse_row(line)
        clean = []
        for value in parts:
            value_clean, found = sanitize(value)
            clean.append(value_clean)
            for key, n in found.items():
                counts[key] = counts.get(key, 0) + n
        req = clean[0]
        rows.append((req, clean, release_for(req, rc2, handoff)))
    leftover = find_leaks("\n".join(" ".join(c) for _, c, _ in rows))
    if leftover:
        raise SystemExit(f"sanitizer left leaks behind: {leftover[:5]}")

    out = []
    out.append("# Inspire requirements ledger\n")
    out.append(
        "Single source of truth for every Inspire ask. The coordinator keeps the working copy outside the repo. "
        "This file is published from it by `app/scripts/ledger_publish.py`, which sanitizes every row. "
        "Do not edit this file by hand: change the working copy and re-run the publisher.\n"
    )
    out.append("## How the ledger works\n")
    out.append("- Every ask becomes a REQ row before any work starts. A duplicate ask links to the existing REQ.")
    out.append("- A REQ is DONE only when its code is on the integration branch (SHA), its tests are green, and it was walked live on an installed build.")
    out.append("- A release candidate is cut only when every in-scope REQ is DONE.")
    out.append("- Every builder brief names the REQ ids it owns and reports per REQ.")
    out.append("- States: OPEN (not started), BUILDING (lane and worktree), LOCAL (on a branch, tests green, not on the integration branch), DEV (on the integration branch, not live-walked), DONE (live-walked in an rc), BLOCKED (named blocker), OUT, SUPERSEDED.")
    out.append("- Release column: RC2 = in v1.5.3-rc.2 scope; HANDOFF = left for the next person; not in RC2 scope = DONE, SUPERSEDED or OUT, state kept as recorded.\n")

    handoff_rows = [r for r in rows if r[2] == RELEASE_HANDOFF or (r[2] == RELEASE_RC2 and not r[1][3].upper().startswith("DONE"))]
    out.append("## Hand-off\n")
    out.append(
        "Rows to pick up. HANDOFF rows were not in the v1.5.3-rc.2 scope. RC2 rows listed here are in scope and not DONE yet. "
        "Grouped by area, using the ask text and lane (keyword match, so a row can sit in a neighbouring area).\n"
    )
    if not handoff_rows:
        out.append("None.\n")
    for area_name, _ in AREAS + (("Other", ""),):
        members = [r for r in handoff_rows if area_of(r[1][2], r[1][4]) == area_name]
        if not members:
            continue
        out.append(f"### {area_name} ({len(members)})\n")
        for req, c, release in members:
            out.append(f"- {req} | {release} | {c[3] or 'no state'} | {c[2][:160]}")
        out.append("")
    out.append(f"Hand-off totals: {len(handoff_rows)} rows ({sum(1 for r in handoff_rows if r[2] == RELEASE_HANDOFF)} HANDOFF, "
               f"{sum(1 for r in handoff_rows if r[2] == RELEASE_RC2)} RC2 not DONE).\n")

    out.append("## Ledger\n")
    out.append("Rows from the working copy, in the order they were recorded. The second block is the coordinator's later section, "
               "which records builder and tester findings. In that block the Asked column holds the source and time that were recorded.\n")
    header = "| REQ | Asked (UTC) | Ask | State | Lane / branch | Evidence | Live acceptance check | Release |\n|---|---|---|---|---|---|---|---|"
    out.append(header)
    for req, c, release in rows:
        out.append("| " + " | ".join(x.replace("|", "/") for x in c[:7]) + f" | {release} |")
    out.append("")
    return "\n".join(out), counts


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ledger", help="path to the coordinator's working copy of the ledger")
    ap.add_argument("--scope", help="path to the scope file that lists RC2 and HANDOFF ids")
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--check", action="store_true", help="scan app/docs/requirements/ledger.md and the root CLAUDE.md for leaks and exit 1 on any")
    args = ap.parse_args(argv)

    if args.check:
        bad = []
        for rel, p in (("app/docs/requirements/ledger.md", OUT), ("CLAUDE.md", REPO / "CLAUDE.md")):
            for kind, value in find_leaks(p.read_text(encoding="utf-8")):
                bad.append(f"{rel}: {kind}: {value}")
        for line in bad:
            print(line)
        return 1 if bad else 0

    if not args.ledger or not args.scope:
        ap.error("--ledger and --scope are required unless --check is given")
    if CUSTOMER.pattern == "(?!)":
        # Without the private names file every customer name would reach the public ledger unmasked.
        ap.error("set INSPIRE_LEDGER_PRIVATE_NAMES to the coordinator's private names file before publishing")
    rc2, handoff = read_scope(args.scope)
    text = pathlib.Path(args.ledger).read_text(encoding="utf-8")
    markdown, counts = build(text, rc2, handoff)
    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(markdown, encoding="utf-8")
    for key in sorted(counts):
        print(f"masked {counts[key]:>4} x {key}")
    print(f"wrote {out} ({len(markdown)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
