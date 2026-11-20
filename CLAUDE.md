# CLAUDE.md: how we work in the Inspire repo

Public file: process and engineering rules only, no secrets, workspace or customer names, personal paths. General rules (honesty, root cause, reporting, test load limits, semver) are in the global CLAUDE.md.

## Start here: the requirements ledger

Read `app/docs/requirements/ledger.md` before any work. Its hand-off section lists every open row by area. Every change names the REQ row it serves; every new ask becomes a REQ row before you start it.

## 0. What this repo is

- Root: `inspire_installer.py`, `README.md`, `LICENSE`, git dot files only.
- `app/`: the App (`backend`, `frontend`, `shared`, `scripts`).
- `app/agent/`: the agent (Serverless; reads Unity Catalog metadata, writes a use-case catalog). Notebook: `app/agent/agent/dbx_inspire_ai_agent.ipynb`; its bundled copy `app/dbx_inspire_ai_agent.ipynb` must be byte-identical.

## 1. Branches and releases

- `dev` is the integration branch; work lands by commit, not long-lived lane branches. Before each push: clean merge, leak gate, notebook parses and under the size limit, targeted tests pass.
- `main` moves only when the product owner accepts a release: fast-forward to the accepted `dev` commit, tag, mark latest. Never push to `main` otherwise.
- Outside contributors open pull requests from a fork into `dev`.
- Pre-releases are built from `dev` and proven before the owner sees them.
- Keep `rerere` off.

## 2. Requirements ledger (the single source of truth for what we owe)

`app/docs/requirements/ledger.md` is the single source of truth for every ask. 
1. **Every ask becomes a REQ row before work starts** (any instruction that changes behaviour, copy, a gate, a release or a deploy). Duplicates link to the existing REQ; a defect found in a run becomes a row with the evidence.
2. **Row fields:** id (`REQ-nnn`, or `D-...` for a coordinator decision), asked date (UTC), the ask in the owner's words, state, lane, evidence, live acceptance check.
3. **States:** OPEN, BUILDING, LOCAL (branch, tests green, not on `dev`), DEV (on `dev`, not live-walked), DONE, BLOCKED (named blocker), OUT, SUPERSEDED (kept with reason).
4. **DONE means all three:** code on `dev` (a SHA), tests green, and walked live on an installed build (build, URL, what was clicked in the evidence). A text-presence check is not a walk.
5. **An RC is cut only when every in-scope REQ is DONE;** otherwise the row moves to HANDOFF or blocks the cut.
6. **Every builder brief names the REQ ids it owns and asks for a report per REQ;** a report naming none cannot close one.
7. **The publisher produces the public file.** The coordinator keeps the working copy outside the repo and after every change runs:

   ```
   INSPIRE_LEDGER_PRIVATE_NAMES=<private names file> python3 app/scripts/ledger_publish.py --ledger <working copy> --scope <scope file>
   python3 app/scripts/ledger_publish.py --check
   ```

   It deterministically sanitizes every row (ids, hosts, URLs, emails, paths, customer and scratch names; insults rewritten and marked "(paraphrased)"). Never hand-edit the public ledger.
8. **Hand-off.** To take a row: add a lane line, set BUILDING with the owner, cite the REQ id in every commit and brief.
9. **One coordinator** per project; after a resume check for another live session on the same work first. Ledger status comes from its rows, lane reports and git, never memory.

## 3. How we test

Four local suites, each with a same-command CI job.

| Suite | Where | Command |
|---|---|---|
| python | `app/agent/tests` (one file per REQ or version) | `python -m pytest -q -p no:cacheprovider --timeout=600 <files>` from the repo root |
| backend | `app/backend/test` | from `app/`: `node --test backend/test/*.test.js` |
| shell | `app/agent/agent/app_shell/web` | there: `npm ci`, `npm run -s build`, `node --test --test-timeout=120000 'test/*.test.mjs'` |
| frontend | `app/frontend/test/ui` | from `app/frontend`: `npm ci`, `node --test --test-global-setup=test/ui/prebundle.mjs 'test/ui/*.test.mjs'` |

Installer changes also run `app/installer/test` (pytest).

- **Slot discipline.** At most three test files per local run, through the coordinator's slot wrapper; full suites run on CI.
- **Fail-pre, pass-post.** Each guard test has a must-fail case (planted bad input caught) and a must-keep case (good input passes). Prefer a test that runs the code path over a grep for a string.

### Notebook and generated files (after every merge and agent change)

- The notebook parses cell by cell with `ast.parse`, both copies are identical (`cmp`), each under 6,000,000 bytes.
- The bundle is current: `node scripts/bundle-agent-notebook.mjs` from `app/` leaves an empty diff.
- The embed script passes in check mode (from `app/agent`); write mode regenerates the embedded shell.
- `npm run build` in `app/frontend` passes after any UI change.
- After a merge, regenerate all of the above, commit it in the merge commit, run the suites the change touches, push only when clean. Never bypass a hook; never force-push `dev` or `main`.

### Live walks (the only proof that counts for DONE)

Run on a scratch App on an installed build, never a local server. Check: served asset hash matches the build; viewports 1440x900 and 1280x800; no console errors or 4xx/5xx; one screenshot per row named by REQ id; one RAG per row. Record build, URL, viewports and result in the evidence column.

## 4. Release flow

1. Build from `dev`; stamp the release tag into the installer.
2. Publish one pre-release (no intermediate RCs).
3. Install on a scratch workspace; live-walk every in-scope REQ.
4. Mark latest and move `main` only after the owner accepts; until then `main` and the latest link are untouched and `dev` is never reset or rewritten.
5. The release check downloads every file via the pre-release links, verifies each sha256 against `manifest.json`, and runs the installer from a fresh folder.
6. Release notes are very brief: two-sentence summary, one line per user-facing change, known issues, how to install. No essays, tables, suite counts, lane lists or walk logs. Never mention billing or usage tags.

## 5. Deploy and install

- Deploy the App only through the workspace installer. Never deploy a source folder, create the App from git, or run a local server for anyone to check (local servers are for automated tests only).
- Before an install, confirm no job of the App's service principal is running (the install restarts the App).
- After each install, prove the setup wizard is skipped (the defaults endpoint reports it) before showing the App, then open the installed App URL.
- Every release carries four files: installer, App zip (notebooks inside), assets tar, `manifest.json` (version, size, sha256 of each).
- The installer is pinned to its own release tag: only release-tag links, never "latest"; it refuses a manifest or local files from another version and never uses a partial download.
- Nothing installs packages at run time.
- User instruction: download the installer from the latest release, import it into a workspace folder, run it.

## 6. Engineering rules (Inspire-specific)

1. **User input wins.** Explicit user input (widget, configuration value, directive) outranks every heuristic, score and model opinion. A heuristic that overrides it is a critical bug; validators reject proposals that break it.
2. **User-named items are protected.** Domains, use cases and products the user lists appear verbatim; the pipeline may add, never remove, rename or substitute.
3. **Industry-agnostic code.** No customer, industry, business or workspace names in code, prompts, schemas, fixes or tests; read environment values from widgets, the metastore or the runtime; test with neutral fixtures.
4. **Prompts.** No industry example in a prompt rule; every prompt says the user's explicit input wins.
5. **Serverless.** Do not write to `/tmp` and expect it to survive a run.

## 7. Live monitoring of a run

See skill `inspire-live-monitoring`. Minimum: fresh session id per test job; green only when job state, log and outputs agree; a quiet log is not a hang (check life-cycle state and last emitting stage before killing); keep evidence on disk by run id.

## 8. Use-case quality audit

See skill `inspire-uc-audit`. Minimum: live log, portfolio shape, at least five per-item spot checks, a cross-run comparison; BLOCKED needs a named cause.

## 9. Reporting

- Public files address the practitioner, never a prospect. No personal details, customer names or account or workspace identifiers in the repo or commit messages.

## 10. Commits and history

- Commit messages start with `agent:`, `app:`, `docs:`, `test:`, `infra:`, `rules:`, `hotfix:` or `chore:` and name the REQ ids they own.
- After a commit that claims delivered work: push, then `git branch --contains <sha>` and `git ls-remote` on the branch.
- Never `git reset --hard` against a remote when local has unpushed commits. Never commit secrets, tokens, local paths or stale generated files.
