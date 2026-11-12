# Inspire AI: Application bundle

Full-stack Databricks App (Node backend, React frontend, Inspire agent notebooks).

People who install Inspire do not need this README: they download `inspire_installer.py` from the latest release, import it into a workspace folder and run it.

## v1.5.2: exec notes

- **Agent:** `dbx_inspire_ai_agent` `__AGENT_VERSION__ = v1.5.3`
- **Discovery Type:** widget `03_discovery_type` = Standard Discovery (default) / AI Enhanced Discovery; legacy Standard / Deep are mapped; an unknown value is refused with 400
- **Strategic Context:** widget `10_strategic_context` (inline JSON or `/` path, at most 900000 bytes), edited on Launch under Strategy (optional): your own level names (default Pillar, Goal, Objective, Priority), a priority level, KPIs, key results and sponsors, typed or pasted as a list or table
- **Feedback:** `POST /api/inspire/feedback` and `GET /api/inspire/feedback` on `__inspire_feedback` (created by the agent); every value is a bound parameter
- **Tracking:** the 10 v1.3.0 `__inspire_usecases` columns are nullable; older sessions render as before
- **Review:** totals across every run of the Inspire Database (`GET /api/inspire/portfolio`), the figures of each run, and a Latest Run label on the newest run of each named business that has two or more runs; strategy filter at any depth (with a Not aligned bucket) and a business-priority filter; strategy coverage with gaps; data foundations and build order; data access summary (Deep lists the tables read, Standard reads no data); per use case strategy evidence, KPIs with baselines, key results, measures, benefits, data evidence and feedback controls. Monitor shows the run's discovery type and strategy
- **Quality:** widget `05_use_cases_quality` = Good / High / Ultra High (legacy labels mapped in `inspireJobParams.js`)
- **Genie:** `13_generate_genie_code_for` only; persistent per-notebook jobs; pass `dbx_inspire_ai_child_run=1` if you trigger those jobs yourself
- **Tracking:** `__inspire_usecases` quality/elite/selection_flags columns are nullable; below-bar flags are valid results
- **PDF:** WeasyPrint >= 70.0
- **Tests:** `npm test`

## Local development

```bash
cd app
cp .env.example .env   # fill in DATABRICKS_HOST, token, warehouse, etc.
npm run install:all
npm run dev            # backend :8080 + Vite (see terminal for URL)
```

## Build a release

Every build ships as a GitHub Release with the same 4 files: `inspire_installer.py`, `manifest.json` (version, size and sha256 of every file), `inspire-app.zip` (the App with its agent notebooks and the install steps in `installer/inspire_setup.py`) and `inspire-assets.tar` (the agent assets folder with its `manifest.json`).

```bash
cd app
python3 installer/release.py build --assets <agent assets folder> --out dist/release
python3 installer/release.py check --base https://github.com/amralieg/inspire/releases/latest/download
```

`build` packs the App with `scripts/package-for-workspace.sh` (or takes `--app-zip`), checks every asset against its manifest, and writes exactly the 4 release files. `check` downloads every file through the given links, checks each sha256, confirms the release carries no other file name, and exits non-zero on any mismatch.

## Install a local build (optional)

```bash
cd app
INSPIRE_ASSETS_DIR=<agent assets folder> INSPIRE_WAREHOUSE_ID=<warehouse id> INSPIRE_CATALOG=<catalog> npm run deploy
```

Builds a release, imports the installer, `manifest.json`, `inspire-app.zip` and `inspire-assets.tar` into `/Workspace/Users/<you>/inspire-install`, and runs the installer there once as a serverless job, offline from those files.

See [deployment.md](deployment.md) for details.
